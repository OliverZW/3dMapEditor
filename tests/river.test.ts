import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/core/document';
import { deriveHeights, sampleHeight, validateRiver } from '../src/core/terrain';
import { riverConfluence, riverWaterMeshes } from '../src/core/river-water';
import { EditorSession } from '../src/application/editor-session';
import { encodeProject, decodeProject } from '../src/io/project';
import { prepareResize } from '../src/core/map-resize';
import { vegetationFilter } from '../src/core/vegetation';
import type { Point, River } from '../src/core/types';

const bounds = { width: 512, depth: 512 };
function river(id: number, points: [number, number][], waterLevel = 24, width = 24): River {
  return {
    id,
    name: `河流 ${id}`,
    points: points.map(([x, z]) => ({ x, z })),
    width,
    depth: 6,
    waterLevel,
    interpolation: 'linear',
  };
}
function sessionWith(rivers: River[]) {
  const session = new EditorSession(),
    doc = createDocument(513, 512, 512);
  doc.rivers = structuredClone(rivers);
  doc.nextId = Math.max(0, ...rivers.map((r) => r.id)) + 1;
  session.replace(doc);
  return session;
}
function area(positions: number[]) {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9)
    sum +=
      Math.abs(
        (positions[i + 3] - positions[i]) * (positions[i + 8] - positions[i + 2]) -
          (positions[i + 6] - positions[i]) * (positions[i + 5] - positions[i + 2]),
      ) / 2;
  return sum;
}
function coverage(positions: number[], p: Point) {
  let count = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const signs = [0, 1, 2].map((j) => {
      const a = i + j * 3,
        b = i + ((j + 1) % 3) * 3;
      return (
        (positions[b] - positions[a]) * (p.z - positions[a + 2]) -
        (positions[b + 2] - positions[a + 2]) * (p.x - positions[a])
      );
    });
    if (signs.every((v) => v > 1e-7) || signs.every((v) => v < -1e-7)) count++;
  }
  return count;
}
describe('河流名称与原子提交', () => {
  it('改名裁去空白，允许中文重名；空名称和同名不增加历史，撤销重做可恢复', () => {
    const s = sessionWith([
      river(1, [
        [-100, 0],
        [100, 0],
      ]),
      river(2, [
        [-100, 80],
        [100, 80],
      ]),
    ]);
    const terrainRevision = s.terrainRevision;
    s.renameRiver(1, '  长江  ');
    expect(s.terrainRevision).toBe(terrainRevision);
    s.renameRiver(2, '长江');
    expect(s.doc.rivers.map((r) => r.name)).toEqual(['长江', '长江']);
    s.renameRiver(2, '  ');
    expect(s.error).toContain('不能为空');
    s.renameRiver(2, '长江');
    s.undo();
    expect(s.doc.rivers[1].name).toBe('河流 2');
    s.redo();
    expect(decodeProject(encodeProject(s.doc)).rivers).toEqual(s.doc.rivers);
  });
  it('新建保留自定义名称，预览取消和名称无效不改正式数据', () => {
    const s = sessionWith([]);
    s.startRiver();
    expect(s.riverPreview!.name).toBe('河流 1');
    s.riverPreview!.points = [
      { x: -100, z: 0 },
      { x: 100, z: 0 },
    ];
    s.riverPreview!.name = ' ';
    s.commitRiver();
    expect(s.doc.rivers).toHaveLength(0);
    expect(s.history.canUndo).toBe(false);
    s.riverPreview!.name = '  汉水  ';
    s.commitRiver();
    expect(s.doc.rivers[0].name).toBe('汉水');
    s.startRiver(1);
    s.riverPreview!.name = '取消的名称';
    s.cancelPreview();
    expect(s.doc.rivers[0].name).toBe('汉水');
    s.undo();
    expect(s.doc.rivers).toHaveLength(0);
    s.redo();
    expect(s.doc.rivers[0].name).toBe('汉水');
  });
  it('候选水位传递至整个连通组，一次撤销恢复所有原值及名称', () => {
    const original = [
      river(
        1,
        [
          [-200, 0],
          [200, 0],
        ],
        30,
      ),
      river(
        2,
        [
          [0, -150],
          [0, 150],
        ],
        40,
      ),
      river(
        3,
        [
          [-200, 100],
          [200, 100],
        ],
        50,
      ),
      river(
        4,
        [
          [-200, -200],
          [-100, -200],
        ],
        60,
      ),
    ];
    const s = sessionWith(original);
    s.startRiver(1);
    s.riverPreview!.waterLevel = 28;
    s.riverPreview!.name = '主河';
    expect(s.riverConfluencePreview.map((r) => r.id).sort()).toEqual([1, 2, 3]);
    expect(s.doc.rivers).toEqual(original);
    s.commitRiver();
    expect(s.error).toBe('');
    expect(s.doc.rivers.map((r) => r.waterLevel)).toEqual([28, 28, 28, 60]);
    s.undo();
    expect(s.doc.rivers).toEqual(original);
    expect(s.history.canUndo).toBe(false);
    s.redo();
    expect(s.doc.rivers[0].name).toBe('主河');
  });
  it('联动导致其他河床越界时拒绝，取消和失败均保留全部正式数据', () => {
    const original = [
      river(
        1,
        [
          [-200, 0],
          [200, 0],
        ],
        30,
      ),
      {
        ...river(
          2,
          [
            [0, -200],
            [0, 200],
          ],
          50,
        ),
        depth: 40,
      },
    ];
    const s = sessionWith(original);
    s.startRiver(1);
    s.riverPreview!.waterLevel = 24;
    expect(s.riverPreviewError).toContain('河流 2');
    s.commitRiver();
    expect(s.doc.rivers).toEqual(original);
    expect(s.history.canUndo).toBe(false);
    expect(s.riverPreview).not.toBeNull();
    s.cancelPreview();
    expect(s.doc.rivers).toEqual(original);
  });
});
describe('真实河带交汇', () => {
  const main = river(1, [
    [-200, 0],
    [200, 0],
  ]);
  it.each([
    [
      '十字',
      [
        [0, -200],
        [0, 200],
      ],
    ],
    [
      'T 形',
      [
        [0, -200],
        [0, 0],
      ],
    ],
    [
      '斜交',
      [
        [-150, -150],
        [150, 150],
      ],
    ],
    [
      '端点接入',
      [
        [200, 0],
        [200, 100],
      ],
    ],
    [
      '河岸接触',
      [
        [-180, 24],
        [180, 24],
      ],
    ],
    [
      '宽河重叠',
      [
        [-180, 20],
        [180, 20],
      ],
    ],
  ] as [string, [number, number][]][])('%s可交汇，长线段中部不会漏检', (_label, points) => {
    const candidate = river(2, points);
    expect(validateRiver(createDocument(513, 512, 512), candidate)).toBeNull();
    expect(
      riverConfluence([main], candidate, bounds)
        .map((r) => r.id)
        .sort(),
    ).toEqual([1, 2]);
  });
  it('河床影响区靠近但水面未接触时不联动；移动候选替换旧位置', () => {
    const near = river(2, [
      [-200, 30],
      [200, 30],
    ]);
    expect(riverConfluence([main], near, bounds).map((r) => r.id)).toEqual([2]);
    const old = river(2, [
      [0, -200],
      [0, 200],
    ]);
    expect(riverConfluence([main, old], near, bounds).map((r) => r.id)).toEqual([2]);
  });
  it('自身交叉、非法数字、越界、过窄及非法水位仍阻止提交', () => {
    const doc = createDocument(513, 512, 512);
    expect(
      validateRiver(
        doc,
        river(1, [
          [-100, -100],
          [100, 100],
          [-100, 100],
          [100, -100],
        ]),
      ),
    ).toContain('自交');
    expect(
      validateRiver(
        doc,
        river(1, [
          [NaN, 0],
          [100, 0],
        ]),
      ),
    ).toContain('有限');
    expect(
      validateRiver(
        doc,
        river(1, [
          [-250, 0],
          [250, 0],
        ]),
      ),
    ).toContain('边界');
    expect(validateRiver(doc, { ...main, width: 0.5 })).toContain('河宽');
    expect(validateRiver(doc, { ...main, waterLevel: 3 })).toContain('高度范围');
  });
});
describe('共享水面与派生结果', () => {
  const main = river(1, [
      [-200, 0],
      [200, 0],
    ]),
    branch = river(2, [
      [0, -200],
      [0, 200],
    ]);
  it('十字水面面积等于并集，交汇没有重复面或孔洞，UV有限且输入顺序不影响结果', () => {
    const meshes = riverWaterMeshes([main, branch], bounds);
    expect(meshes.reduce((sum, mesh) => sum + area(mesh.positions), 0)).toBeCloseTo(
      400 * 24 * 2 - 24 * 24,
      5,
    );
    const positions = meshes.flatMap((mesh) => mesh.positions);
    for (let x = -10.2; x < 11; x += 2.31)
      for (let z = -10.7; z < 11; z += 2.17) expect(coverage(positions, { x, z })).toBe(1);
    expect(meshes).toEqual(riverWaterMeshes([branch, main], bounds));
    for (const mesh of meshes) {
      expect(mesh.uvs.every(Number.isFinite)).toBe(true);
      expect(mesh.shoreDistances).toHaveLength(mesh.positions.length / 3);
    }
  });
  it('完全重合和部分重合只保留一层，删除后剩余河流恢复完整水面', () => {
    const duplicate = { ...main, id: 2 };
    const full = riverWaterMeshes([main, duplicate], bounds);
    expect(area(full[0].positions)).toBeCloseTo(9600, 5);
    expect(full[1].positions).toHaveLength(0);
    expect(full[0].shoreDistances.some((distance) => distance < 1e-7)).toBe(true);
    const partial = river(
      2,
      [
        [-100, 0],
        [200, 0],
      ],
      24,
      40,
    );
    expect(
      riverWaterMeshes([main, partial], bounds).reduce((sum, m) => sum + area(m.positions), 0),
    ).toBeCloseTo(14400, 5);
    expect(area(riverWaterMeshes([branch], bounds)[0].positions)).toBeCloseTo(9600, 5);
  });
  it('内部河岸不发亮，真正外露的岸边保留效果', () => {
    const meshes = riverWaterMeshes([main, branch], bounds);
    let interior = 0,
      shore = 0;
    for (const mesh of meshes)
      for (let i = 0; i < mesh.shoreDistances.length; i++) {
        const x = mesh.positions[i * 3],
          z = mesh.positions[i * 3 + 2];
        if (Math.abs(x) < 5 && Math.abs(z) <= 12) {
          expect(mesh.shoreDistances[i]).toBeGreaterThan(0.5);
          interior++;
        }
        if (Math.abs(x) > 50 && Math.abs(Math.abs(z) - 12) < 1e-7) {
          expect(mesh.shoreDistances[i]).toBeCloseTo(0);
          shore++;
        }
      }
    expect(interior).toBeGreaterThan(0);
    expect(shore).toBeGreaterThan(0);
  });
  it('三条斜交／T形河道的并集与原河带覆盖一致，公共河岸不产生内亮边', () => {
    const diagonal = river(3, [
      [-150, -150],
      [150, 150],
    ]);
    const meshes = riverWaterMeshes([main, branch, diagonal], bounds);
    const union = meshes.flatMap((mesh) => mesh.positions);
    const raw = [main, branch, diagonal].map((r) => riverWaterMeshes([r], bounds)[0].positions);
    for (let i = 0; i < 200; i++) {
      const p = { x: ((i * 73.173) % 400) - 200, z: ((i * 31.927) % 400) - 200 };
      expect(coverage(union, p)).toBe(raw.some((positions) => coverage(positions, p) > 0) ? 1 : 0);
    }
    const adjacent = river(2, [
      [-200, 24],
      [200, 24],
    ]);
    const touching = riverWaterMeshes([main, adjacent], bounds);
    expect(touching.reduce((sum, m) => sum + area(m.positions), 0)).toBeCloseTo(400 * 48, 5);
    let checked = 0;
    for (const mesh of touching)
      for (let i = 0; i < mesh.shoreDistances.length; i++)
        if (Math.abs(mesh.positions[i * 3 + 2] - 12) < 1e-7) {
          expect(mesh.shoreDistances[i]).toBeGreaterThan(0.99);
          checked++;
        }
    expect(checked).toBeGreaterThan(0);
  });
  it('交汇河床按较低值合成，不改变基础高度；尺寸裁切与工程往返可继续编辑', () => {
    const s = sessionWith([main, { ...branch, depth: 12 }]),
      base = s.doc.heights.slice();
    expect(sampleHeight(s.doc, s.heights, 0, 0)).toBe(12);
    expect(s.doc.heights).toEqual(base);
    const result = prepareResize(s.doc, 256, 256).document;
    const meshes = riverWaterMeshes(result.rivers, result.settings);
    for (const mesh of meshes)
      for (let i = 0; i < mesh.positions.length; i += 3) {
        expect(Math.abs(mesh.positions[i])).toBeLessThanOrEqual(128 + 1e-7);
        expect(Math.abs(mesh.positions[i + 2])).toBeLessThanOrEqual(128 + 1e-7);
      }
    expect(decodeProject(encodeProject(result)).rivers).toEqual(result.rivers);
    s.change('删除交汇支流', (doc) => {
      doc.rivers = [main];
    });
    expect(sampleHeight(s.doc, s.heights, 0, 0)).toBe(18);
    s.undo();
    expect(sampleHeight(s.doc, s.heights, 0, 0)).toBe(12);
    expect(s.doc.heights).toEqual(base);
    expect(deriveHeights(s.doc)).toEqual(s.heights);
  });
  it('交汇处植被避让可随删除水域恢复，不删除原始记录', () => {
    const s = sessionWith([main, branch]);
    const tree = {
      id: s.doc.nextId++,
      layerId: s.doc.treeLayers!.find((layer) => layer.assetId === 'tree-pine')!.id,
      assetId: 'tree-pine',
      x: 0,
      z: 0,
      yaw: 0,
      scale: 1,
    };
    s.doc.trees.push(tree);
    expect(vegetationFilter(s.doc, s.heights)(tree, 45)).toBe(false);
    s.change('删除水域', (doc) => {
      doc.rivers = [];
    });
    expect(vegetationFilter(s.doc, s.heights)(tree, 45)).toBe(true);
    expect(s.doc.trees).toEqual([tree]);
  });
});
