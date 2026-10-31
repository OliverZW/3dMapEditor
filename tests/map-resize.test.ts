import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createDocument, validateDocument } from '../src/core/document';
import { coveringGrid } from '../src/core/grid-coverage';
import { cellOnMap, hexIndex, hexWorld, worldHex, indexHex, paintTerritory } from '../src/core/hex';
import { containsPoint, clipPolygon } from '../src/core/map-bounds';
import { prepareResize } from '../src/core/map-resize';
import { History, snapshot } from '../src/core/history';
import { sampleHeight, deriveHeights } from '../src/core/terrain';
import { riverMesh } from '../src/core/river-mesh';
import { encodeProject, decodeProject } from '../src/io/project';
import { EditorSession } from '../src/application/editor-session';
import type { MapDocument, River } from '../src/core/types';
function site(doc: MapDocument, x: number, z: number) {
  const id = doc.nextId++,
    center = worldHex(doc.grid, { x, z });
  doc.sites.push({
    id,
    kind: 'city',
    name: '城池 ' + id,
    assetId: 'city-jade',
    center,
    yaw: 0,
    scale: 1,
    factionId: null,
  });
  doc.owners[hexIndex(doc.grid, center)] = id;
  return doc.sites.at(-1)!;
}
describe('完整网格与边界', () => {
  it('矩形地面四角均有逻辑格，大地图容量有效，外部填充槽不可绘制', () => {
    const doc = createDocument(513, 3000, 1536);
    for (const x of [-1500, 1500])
      for (const z of [-768, 768]) {
        const cell = worldHex(doc.grid, { x, z });
        expect(hexIndex(doc.grid, cell)).toBeGreaterThanOrEqual(0);
        expect(cellOnMap(doc, cell)).toBe(true);
      }
    const large = coveringGrid({ width: 16384, depth: 16384 });
    expect(large.columns * large.rows).toBeLessThanOrEqual(1048576);
    expect(() => coveringGrid({ width: 16384, depth: 16384 }, { ...large, radius: 0.01 })).toThrow(
      '预算',
    );
    const center = site(doc, 0, 0);
    const outside = indexHex(doc.grid, 0);
    expect(cellOnMap(doc, outside)).toBe(false);
    paintTerritory(doc, center.id, [outside], false);
    expect(doc.owners[0]).toBe(0);
    const polygon = clipPolygon(doc.settings, [
      { x: 1490, z: 760 },
      { x: 1520, z: 760 },
      { x: 1500, z: 800 },
    ]);
    expect(polygon.every((point) => containsPoint(doc.settings, point))).toBe(true);
    expect(
      clipPolygon(doc.settings, [
        { x: 1500, z: 800 },
        { x: 1500, z: 820 },
        { x: 1510, z: 810 },
      ]),
    ).toHaveLength(0);
  });
  it('边缘半格可绘制，但越出地面的格心不能放置据点', () => {
    const session = new EditorSession();
    session.newMap(513);
    session.beginSite('city');
    let point = { x: 1024, z: 0 };
    for (let z = -100; z < 100; z++) {
      const candidate = { x: 1024, z };
      if (
        !containsPoint(
          session.doc.settings,
          hexWorld(session.doc.grid, worldHex(session.doc.grid, candidate)),
        )
      ) {
        point = candidate;
        break;
      }
    }
    session.pointerDown(point, false);
    expect(session.siteCandidateValid).toBe(false);
    session.commitSite();
    expect(session.error).toContain('越界');
    expect(session.doc.sites).toHaveLength(0);
  });
  it('扩大和非方形缩小保留既有格心世界位置及归属', () => {
    const doc = createDocument(),
      city = site(doc, 100, 80);
    const position = hexWorld(doc.grid, city.center);
    paintTerritory(doc, city.id, [{ q: city.center.q + 1, r: city.center.r }], false);
    const next = prepareResize(doc, 3072, 1536).document,
      moved = next.sites[0];
    const actual = hexWorld(next.grid, moved.center);
    expect(actual.x).toBeCloseTo(position.x, 8);
    expect(actual.z).toBeCloseTo(position.z, 8);
    expect(next.owners[hexIndex(next.grid, moved.center)]).toBe(city.id);
    expect(next.owners.filter((id) => id === city.id)).toHaveLength(2);
  });
});
describe('尺寸候选与河流裁剪', () => {
  it('世界位置重采样基础高度、权重和草密度，扩大区域不生成草', () => {
    const doc = createDocument(),
      n = doc.settings.samples;
    for (let i = 0; i < doc.heights.length; i++) {
      doc.heights[i] = 64 + ((i % n) / (n - 1) - 0.5) * 20;
      doc.surface[i * 4] = 0;
      doc.surface[i * 4 + 1] = 255;
    }
    doc.grass.push({
      id: doc.nextId++,
      assetId: 'grass-reed',
      density: new Float32Array(n * n).fill(2),
      seed: 321,
      version: 1,
      minScale: 0.8,
      maxScale: 1.2,
      maxSlope: 30,
      wind: 1,
    });
    const next = prepareResize(doc, 4096, 3072).document;
    expect(sampleHeight(next, next.heights, 100, 50)).toBeCloseTo(
      sampleHeight(doc, doc.heights, 100, 50),
      4,
    );
    expect(next.heights[0]).toBe(doc.heights[0]);
    expect(next.surface[1]).toBe(255);
    expect(next.grass[0].density[0]).toBe(0);
    expect(next.grass[0].density[Math.floor((n * n) / 2)]).toBeCloseTo(2, 6);
    expect(next.grass[0].seed).toBe(321);
    expect(doc.settings.width).toBe(2048);
  });
  it('裁除越界树与据点，释放其全部辖区，保留势力记录', () => {
    const doc = createDocument(),
      keep = site(doc, 0, 0),
      remove = site(doc, 800, 0);
    const keepCell = worldHex(doc.grid, { x: 0, z: 100 });
    doc.owners[hexIndex(doc.grid, keepCell)] = remove.id;
    doc.factions.push({ id: doc.nextId++, name: '青州', color: '#6895a3' });
    keep.factionId = doc.factions[0].id;
    doc.trees.push({ id: doc.nextId++, assetId: 'tree-pine', x: 800, z: 0, yaw: 0, scale: 1 });
    const result = prepareResize(doc, 512, 512);
    expect(result.report.removedSites).toBe(1);
    expect(result.report.removedTrees).toBe(1);
    expect(result.document.sites.map((item) => item.id)).toEqual([keep.id]);
    expect(result.document.owners.some((id) => id === remove.id)).toBe(false);
    expect(result.document.factions).toEqual(doc.factions);
    validateDocument(result.document);
  });
  it('一条河多次跨界分段，保留宽深水位，水面不越界且可继续编辑', () => {
    const doc = createDocument();
    const river: River = {
      id: doc.nextId++,
      name: '曲河',
      width: 16,
      depth: 6,
      waterLevel: 24,
      interpolation: 'linear',
      points: [
        { x: -800, z: -200 },
        { x: 0, z: -200 },
        { x: 800, z: -200 },
        { x: 800, z: 200 },
        { x: 0, z: 200 },
        { x: -800, z: 200 },
      ],
    };
    doc.rivers.push(river);
    const result = prepareResize(doc, 512, 512);
    expect(result.report.clippedRivers).toBe(1);
    expect(result.report.addedRiverSegments).toBe(1);
    expect(result.document.rivers).toHaveLength(2);
    const [first, second] = result.document.rivers;
    expect(first.id).toBe(river.id);
    expect(second.id).not.toBe(river.id);
    expect(first.points[0]).toEqual({ x: -256, z: -200 });
    expect(first.points.at(-1)).toEqual({ x: 256, z: -200 });
    for (const segment of result.document.rivers) {
      expect(segment.interpolation).toBe('linear');
      expect(segment.width).toBe(16);
      expect(segment.depth).toBe(6);
      expect(segment.waterLevel).toBe(24);
      const mesh = riverMesh(segment, result.document.settings);
      expect(mesh.positions.length).toBeGreaterThan(0);
      for (let i = 0; i < mesh.positions.length; i += 3)
        expect(
          containsPoint(result.document.settings, {
            x: mesh.positions[i],
            z: mesh.positions[i + 2],
          }),
        ).toBe(true);
    }
    const heights = deriveHeights(result.document);
    expect(sampleHeight(result.document, heights, 0, -200)).toBeLessThan(32);
    expect(decodeProject(encodeProject(result.document)).rivers).toEqual(result.document.rivers);
  });
  it('候选失败与取消不改原图，预览过期不提交，提示显隐不进入工程历史', () => {
    const session = new EditorSession();
    session.newMap(513);
    session.setTool('overview');
    const before = snapshot(session.doc);
    expect(() => prepareResize(session.doc, 0, 512)).toThrow('整数米');
    session.previewResize(1024, 512);
    expect(session.doc.settings.width).toBe(2048);
    session.cancelResize();
    expect(session.doc.settings).toEqual(before.settings);
    expect(session.doc.grid).toEqual(before.grid);
    expect(session.doc.heights.every((value, index) => value === before.heights[index])).toBe(true);
    expect(session.doc.surface.every((value, index) => value === before.surface[index])).toBe(true);
    expect(session.doc.owners.every((value, index) => value === before.owners[index])).toBe(true);
    expect(session.dirty).toBe(false);
    session.previewResize(1024, 512);
    session.change('修改名称', (doc) => {
      doc.name = '新的山河';
    });
    session.commitResize();
    expect(session.doc.settings.width).toBe(2048);
    session.showInputHints = false;
    session.newMap(513);
    expect(session.showInputHints).toBe(false);
    expect(session.history.canUndo).toBe(false);
  });
  it('扩大后河宽不足时拒绝候选，不静默加宽河流', () => {
    const doc = createDocument();
    doc.rivers.push({
      id: doc.nextId++,
      name: '细河',
      width: 8,
      depth: 4,
      waterLevel: 24,
      points: [
        { x: -100, z: 0 },
        { x: 100, z: 0 },
      ],
    });
    expect(() => prepareResize(doc, 16384, 16384)).toThrow('河宽');
    expect(doc.rivers[0].width).toBe(8);
  });
});
describe('结构历史与版本迁移', () => {
  it('一次撤销重做恢复尺寸、变长网格、地形、草和河段，设置快照独立', () => {
    const doc = createDocument(),
      city = site(doc, 0, 0),
      before = snapshot(doc),
      history = new History();
    const next = prepareResize(doc, 3072, 1024).document;
    expect(next.owners.length).not.toBe(before.owners.length);
    history.commit(before, next, '调整尺寸');
    Object.assign(doc, next);
    history.undo(doc);
    expect(doc.settings).toEqual(before.settings);
    expect(doc.grid).toEqual(before.grid);
    expect(doc.owners).toEqual(before.owners);
    expect(doc.heights).toEqual(before.heights);
    expect(doc.sites[0].id).toBe(city.id);
    history.redo(doc);
    expect(doc.settings).toEqual(next.settings);
    expect(doc.owners).toEqual(next.owners);
    doc.settings.width = 1000;
    expect(before.settings.width).toBe(2048);
  });
  it('超出历史预算时拒绝提交，不产生不可撤销的尺寸变更', () => {
    const doc = createDocument(),
      density = new Float32Array(doc.heights.length);
    for (let i = 0; i < 65; i++)
      doc.grass.push({
        id: doc.nextId++,
        assetId: 'grass-reed',
        density,
        seed: i,
        version: 1,
        minScale: 1,
        maxScale: 1,
        maxSlope: 30,
        wind: 1,
      });
    const after = { ...doc, settings: { ...doc.settings, width: 3072 } },
      history = new History();
    expect(() => history.commit(doc, after, '尺寸')).toThrow('内存预算');
    expect(history.canUndo).toBe(false);
  });
  it('损坏的 v1 不通过补齐网格掩盖数组错误，字符串版本不作为兼容版本', () => {
    const files = unzipSync(encodeProject(createDocument()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.formatVersion = 1;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    files['logic/owners.u32'] = new Uint8Array(4);
    expect(() => decodeProject(zipSync(files))).toThrow('长度');
    manifest.formatVersion = '1';
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    expect(() => decodeProject(zipSync(files))).toThrow('版本');
  });
  it('v1 局部网格迁移到 v3 全覆盖，保持据点世界位置和归属', () => {
    const doc = createDocument();
    doc.grid = {
      columns: 64,
      rows: 48,
      radius: 12,
      originX: -Math.sqrt(3) * 12 * 31.75,
      originZ: -18 * 23.5,
    };
    doc.owners = new Uint32Array(64 * 48);
    const city = site(doc, 0, 0),
      position = hexWorld(doc.grid, city.center);
    const files = unzipSync(encodeProject(doc)),
      manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.formatVersion = 1;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    let migrated = false;
    const result = decodeProject(zipSync(files), () => {
      migrated = true;
    });
    expect(migrated).toBe(true);
    expect(result.formatVersion).toBe(3);
    const p = hexWorld(result.grid, result.sites[0].center);
    expect(p.x).toBeCloseTo(position.x, 8);
    expect(p.z).toBeCloseTo(position.z, 8);
    expect(result.owners[hexIndex(result.grid, result.sites[0].center)]).toBe(city.id);
    expect(cellOnMap(result, worldHex(result.grid, { x: 1024, z: 1024 }))).toBe(true);
    expect(decodeProject(encodeProject(result)).formatVersion).toBe(3);
  });
});
