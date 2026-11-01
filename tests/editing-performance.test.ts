import { describe, it, expect, vi } from 'vitest';
import { createDocument, validateDocument } from '../src/core/document';
import { createDemo } from '../src/core/demo';
import { deriveHeights, applyTerrainBrush } from '../src/core/terrain';
import { DEFAULT_BRUSH } from '../src/core/types';
import { History, snapshot } from '../src/core/history';
import type { HistoryArray } from '../src/core/history';
import { GrassPlacementTasks } from '../src/application/grass-placement-tasks';
import type { GrassRequest, GrassReply } from '../src/application/grass-placement-contract';

const exact = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]));

describe('局部最终高度与完整派生一致', () => {
  for (const samples of [513, 1025])
    for (const mode of ['raise', 'lower', 'flatten', 'smooth'] as const)
      it(`${samples}² ${mode}：重叠河床、边缘、连续修改完全一致且复用独立缓冲`, () => {
        const doc = createDocument(samples, 512, 256);
        for (let i = 0; i < doc.heights.length; i++)
          doc.heights[i] = 32 + Math.sin((i % samples) * 0.04) * 5;
        doc.rivers = [
          {
            id: 1,
            name: 'A',
            width: 32,
            depth: 8,
            waterLevel: 29,
            interpolation: 'linear',
            clipped: true,
            points: [
              { x: -256, z: -40 },
              { x: 256, z: 40 },
            ],
          },
          {
            id: 2,
            name: 'B',
            width: 24,
            depth: 11,
            waterLevel: 29,
            interpolation: 'linear',
            clipped: true,
            points: [
              { x: -40, z: -128 },
              { x: 40, z: 128 },
            ],
          },
        ];
        const heights = deriveHeights(doc);
        for (const point of [
          { x: 0, z: 0 },
          { x: 22, z: 8 },
          { x: -250, z: -120 },
          { x: 250, z: 120 },
        ]) {
          const brush = { ...DEFAULT_BRUSH, radius: 17.3, terrainMode: mode, height: 48 };
          applyTerrainBrush(doc, point, brush);
          const raw = doc.heights.slice();
          expect(
            deriveHeights(doc, heights, {
              minX: point.x - brush.radius,
              maxX: point.x + brush.radius,
              minZ: point.z - brush.radius,
              maxZ: point.z + brush.radius,
            }),
          ).toBe(heights);
          expect(exact(heights, deriveHeights(doc))).toBe(true);
          expect(exact(raw, doc.heights)).toBe(true);
        }
      });
  it('拒绝原始高度别名、不匹配缓冲和无效局部范围', () => {
    const doc = createDocument(513);
    const b = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
    expect(() => deriveHeights(doc, doc.heights, b)).toThrow();
    expect(() => deriveHeights(doc, new Float32Array(1), b)).toThrow();
    expect(() => deriveHeights(doc, undefined, b)).toThrow();
    expect(() =>
      deriveHeights(doc, new Float32Array(doc.heights.length), { ...b, minX: Infinity }),
    ).toThrow();
  });
});

describe('笔刷历史扫描范围', () => {
  for (const field of ['heights', 'surface', 'owners', 'grass', 'trees'] as const)
    it(`${field} 定向扫描与全量历史的撤销重做一致`, () => {
      const before = createDemo(),
        after = snapshot(before);
      if (field === 'heights') after.heights[50] += 3;
      if (field === 'surface') {
        after.surface[0] = 200;
        after.surface[1] = 55;
      }
      if (field === 'owners') after.owners[3] = after.sites[0].id;
      if (field === 'grass') after.grass[0].density[40] = 2;
      if (field === 'trees') after.trees.push({ ...after.trees[0], id: after.nextId++ });
      const full = new History(),
        scoped = new History();
      const arrays: HistoryArray[] = field === 'trees' ? [] : [field];
      expect(full.commit(before, after, '编辑')).toBe(true);
      expect(scoped.commit(before, after, '编辑', arrays)).toBe(true);
      const a = snapshot(after),
        b = snapshot(after);
      const compare = () => {
        expect(
          exact(a.heights, b.heights) && exact(a.surface, b.surface) && exact(a.owners, b.owners),
        ).toBe(true);
        expect(a.trees).toEqual(b.trees);
        expect(a.nextId).toBe(b.nextId);
        a.grass.forEach((layer, i) => expect(exact(layer.density, b.grass[i].density)).toBe(true));
      };
      full.undo(a);
      scoped.undo(b);
      compare();
      full.redo(a);
      scoped.redo(b);
      compare();
    });
});

function fakeWorker() {
  const posted: GrassRequest[] = [];
  const worker = {
    onmessage: null as Worker['onmessage'],
    onerror: null as Worker['onerror'],
    postMessage: vi.fn(
      (value: unknown, transfers?: Transferable[] | StructuredSerializeOptions) => {
        posted.push(
          structuredClone(value, {
            transfer: Array.isArray(transfers) ? transfers : transfers?.transfer,
          }) as GrassRequest,
        );
      },
    ),
    terminate: vi.fn(),
  };
  const reply = (request: GrassRequest, extra: Partial<GrassReply> = {}) =>
    worker.onmessage?.call(
      worker as unknown as Worker,
      new MessageEvent('message', {
        data: {
          taskId: request.taskId,
          documentVersion: request.documentVersion,
          terrainRevision: request.terrainRevision,
          grassRevision: request.grassRevision,
          groups: [],
          ...extra,
        },
      }),
    );
  return { worker, posted, reply };
}
const stamp = { documentVersion: 1, terrainRevision: 2, grassRevision: 3 };
describe('草丛任务隔离与取消', () => {
  it('只传副本且不携带模型字节；一个执行、一个最新候选，旧任务不覆盖', async () => {
    const f = fakeWorker(),
      tasks = new GrassPlacementTasks(() => f.worker),
      doc = createDemo(),
      heights = deriveHeights(doc);
    const p1 = tasks.run(doc, heights, { x: 0, z: 0 }, stamp);
    const p2 = tasks.run(doc, heights, { x: 1, z: 0 }, { ...stamp, terrainRevision: 3 });
    const p3 = tasks.run(doc, heights, { x: 2, z: 0 }, { ...stamp, documentVersion: 2 });
    expect(await p1).toBeNull();
    expect(await p2).toBeNull();
    expect(f.posted).toHaveLength(1);
    expect(heights.byteLength).toBeGreaterThan(0);
    expect(doc.grass[0].density.byteLength).toBeGreaterThan(0);
    expect(f.posted[0].doc.assets.every((asset) => !asset.bytes)).toBe(true);
    f.reply(f.posted[0]);
    expect(f.posted).toHaveLength(2);
    expect(f.posted[1].center.x).toBe(2);
    f.reply(f.posted[1]);
    expect(await p3).toEqual([]);
    tasks.dispose();
  });
  it('错误版本被丢弃、取消和关闭不提交，线程错误可重建且忽略旧线程回调', async () => {
    const a = fakeWorker(),
      b = fakeWorker();
    let current = a;
    const tasks = new GrassPlacementTasks(() => current.worker),
      doc = createDemo(),
      heights = deriveHeights(doc);
    let p = tasks.run(doc, heights, { x: 0, z: 0 }, stamp);
    a.reply(a.posted[0], { grassRevision: 999 });
    expect(await p).toBeNull();
    p = tasks.run(doc, heights, { x: 0, z: 0 }, stamp);
    const rejected = expect(p).rejects.toThrow('线程失败');
    const stale = a.worker.onmessage;
    a.worker.onerror?.call(a.worker as unknown as Worker, { message: '线程失败' } as ErrorEvent);
    await rejected;
    current = b;
    p = tasks.run(doc, heights, { x: 0, z: 0 }, stamp);
    stale?.call(
      a.worker as unknown as Worker,
      new MessageEvent('message', { data: { ...a.posted[1], groups: [] } }),
    );
    expect(b.posted).toHaveLength(1);
    tasks.cancel();
    expect(await p).toBeNull();
    tasks.dispose();
    expect(b.worker.terminate).toHaveBeenCalledOnce();
    expect(await tasks.run(doc, heights, { x: 0, z: 0 }, stamp)).toBeNull();
  });
});

describe('完整校验和提交差异仍可靠', () => {
  it('检查所有高度和四层权重，末尾非法值也不能被优化遗漏', () => {
    const doc = createDocument(1025);
    doc.heights[doc.heights.length - 1] = NaN;
    expect(() => validateDocument(doc)).toThrow('高度');
    doc.heights[doc.heights.length - 1] = 32;
    doc.surface[doc.surface.length - 4] = 254;
    expect(() => validateDocument(doc)).toThrow('权重');
    doc.surface[doc.surface.length - 4] = 255;
    expect(() => validateDocument(doc)).not.toThrow();
  });
  it('一般命令保留默认全量差异，无变化提交清除旧提示', () => {
    const before = createDocument(513),
      after = snapshot(before),
      history = new History();
    after.heights[0] += 1;
    after.surface[0] = 254;
    after.surface[1] = 1;
    expect(history.commit(before, after, '混合修改')).toBe(true);
    expect([...history.arrayChanges].sort()).toEqual(['heights', 'surface']);
    expect(history.commit(after, snapshot(after), '无变化')).toBe(false);
    expect(history.arrayChanges.size).toBe(0);
  });
});

it('四通道字比较不漏首尾通道，非对齐权重仍能正确恢复', () => {
  for (const offset of [0, 1]) {
    const doc = createDocument(513);
    const packed = new Uint8Array(doc.surface.length + offset);
    packed.set(doc.surface, offset);
    doc.surface = packed.subarray(offset);
    const before = snapshot(doc),
      history = new History();
    doc.surface[3] = 7;
    doc.surface[doc.surface.length - 1] = 13;
    expect(history.commit(before, doc, '字节边界')).toBe(true);
    history.undo(doc);
    expect(exact(doc.surface, before.surface)).toBe(true);
    history.redo(doc);
    expect(doc.surface[3]).toBe(7);
    expect(doc.surface[doc.surface.length - 1]).toBe(13);
  }
});
