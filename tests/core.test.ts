import { describe, it, expect } from 'vitest';
import { createDocument, validateDocument } from '../src/core/document';
import {
  getCellFaction,
  getSiteCells,
  getFactionCells,
  hexDisk,
  hexIndex,
  hexLine,
  hexWorld,
  moveSite,
  paintTerritory,
  worldHex,
} from '../src/core/hex';
import { History, snapshot } from '../src/core/history';
import { deriveHeights, sampleHeight, applyTerrainBrush } from '../src/core/terrain';
import { DEFAULT_BRUSH } from '../src/core/types';
import { generateGrass } from '../src/core/vegetation';
import { imageHash } from '../src/io/image-validation';
import { decodeProject, encodeProject } from '../src/io/project';
import { decodeHeightPng, encodeHeightPng } from '../src/io/heightmap';
import { ExportRegistry } from '../src/io/export-adapter';
import { createDemo } from '../src/core/demo';
function sampleGlb() {
  const json = new TextEncoder().encode('{"asset":{"version":"2.0"}} ');
  const bytes = new Uint8Array(20 + json.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  return bytes;
}
function withSites() {
  const d = createDocument();
  d.factions = [{ id: 1, name: '青州', color: '#6699aa' }];
  d.sites = [
    {
      id: 2,
      kind: 'city',
      name: '城池',
      assetId: 'city-jade',
      center: { q: 0, r: 10 },
      yaw: 0,
      scale: 1,
      factionId: 1,
    },
    {
      id: 3,
      kind: 'fortress',
      name: '要塞',
      assetId: 'fort-stone',
      center: { q: 5, r: 10 },
      yaw: 0,
      scale: 1,
      factionId: null,
    },
  ];
  d.nextId = 4;
  for (const site of d.sites) d.owners[hexIndex(d.grid, site.center)] = site.id;
  return d;
}
describe('六边形与据点不变量', () => {
  it('格圈数量和世界往返一致', () => {
    const d = createDocument();
    for (let radius = 0; radius <= 4; radius++)
      expect(hexDisk({ q: 0, r: 0 }, radius)).toHaveLength(1 + 3 * radius * (radius + 1));
    for (let r = 0; r < 48; r += 3)
      for (let q = -Math.floor(r / 2); q < 64 - Math.floor(r / 2); q += 7)
        expect(worldHex(d.grid, hexWorld(d.grid, { q, r }))).toEqual({ q: q || 0, r: r || 0 });
  });
  it('快速路径连续补格', () => {
    const cells = hexLine({ q: 0, r: 10 }, { q: 15, r: 12 });
    for (let i = 1; i < cells.length; i++)
      expect(hexDisk(cells[i - 1], 1)).toContainEqual(cells[i]);
  });
  it('转移唯一归属、全部中心受保护、擦除仅限当前据点', () => {
    const d = withSites(),
      cell = { q: 2, r: 10 },
      i = hexIndex(d.grid, cell);
    paintTerritory(d, 2, [cell], false);
    paintTerritory(d, 3, [cell, ...d.sites.map((s) => s.center)], false);
    expect(d.owners[i]).toBe(3);
    expect(d.owners[hexIndex(d.grid, d.sites[0].center)]).toBe(2);
    paintTerritory(d, 2, [cell], true);
    expect(d.owners[i]).toBe(3);
    paintTerritory(d, 3, [cell, d.sites[1].center], true);
    expect(d.owners[i]).toBe(0);
    expect(getSiteCells(d, 3)).toHaveLength(1);
  });
  it('移动原地无变更、保留飞地、转移新中心并释放旧中心', () => {
    const d = withSites(),
      island = { q: 10, r: 20 };
    paintTerritory(d, 2, [island], false);
    const original = d.owners.slice();
    moveSite(d, 2, { ...d.sites[0].center });
    expect(d.owners).toEqual(original);
    const old = { ...d.sites[0].center },
      next = { q: 6, r: 10 };
    paintTerritory(d, 3, [next], false);
    moveSite(d, 2, next);
    expect(d.owners[hexIndex(d.grid, old)]).toBe(0);
    expect(d.owners[hexIndex(d.grid, island)]).toBe(2);
    expect(d.owners[hexIndex(d.grid, next)]).toBe(2);
    expect(() => moveSite(d, 2, d.sites[1].center)).toThrow('占用');
  });
  it('势力范围仅派生，删除势力保留据点与辖区', () => {
    const d = withSites();
    paintTerritory(d, 2, [{ q: 2, r: 10 }], false);
    expect(getFactionCells(d, 1)).toHaveLength(2);
    expect(getCellFaction(d, { q: 2, r: 10 })?.id).toBe(1);
    const owners = d.owners.slice();
    d.factions = [];
    d.sites[0].factionId = null;
    expect(d.owners).toEqual(owners);
    expect(getCellFaction(d, { q: 2, r: 10 })).toBeUndefined();
    validateDocument(d);
  });
  it('跨据点转移撤销重做同时恢复双方', () => {
    const d = withSites(),
      h = new History(),
      cell = { q: 2, r: 10 };
    paintTerritory(d, 2, [cell], false);
    const before = snapshot(d);
    paintTerritory(d, 3, [cell], false);
    h.commit(before, d, '转移');
    h.undo(d);
    expect(d.owners[hexIndex(d.grid, cell)]).toBe(2);
    h.redo(d);
    expect(d.owners[hexIndex(d.grid, cell)]).toBe(3);
    validateDocument(d);
  });
});
describe('高度、植被与工程', () => {
  it('首屏示例地图满足保存与导出校验', () => {
    expect(() => validateDocument(createDemo())).not.toThrow();
  });
  it('采样严格使用实际三角面', () => {
    const d = createDocument();
    d.heights[0] = 0;
    d.heights[1] = 0;
    d.heights[513] = 0;
    d.heights[514] = 100;
    expect(sampleHeight(d, d.heights, -1023, -1023)).toBe(0);
    expect(sampleHeight(d, d.heights, -1021, -1021)).toBeCloseTo(50);
  });
  it('基础雕刻可回滚且河床不破坏基础高度', () => {
    const d = createDocument(),
      h = new History(),
      before = snapshot(d);
    applyTerrainBrush(d, { x: 0, z: 0 }, DEFAULT_BRUSH);
    h.commit(before, d, '雕刻');
    expect(d.heights[256 * 513 + 256]).toBeGreaterThan(32);
    h.undo(d);
    expect(d.heights).toEqual(before.heights);
    d.rivers = [
      {
        id: 1,
        name: '河',
        width: 24,
        depth: 6,
        waterLevel: 24,
        points: [
          { x: -100, z: 0 },
          { x: 100, z: 0 },
        ],
      },
    ];
    const result = deriveHeights(d);
    expect(result[256 * 513 + 256]).toBe(18);
    expect(d.heights[256 * 513 + 256]).toBe(32);
    d.rivers = [];
    expect(deriveHeights(d)).toEqual(before.heights);
  });
  it('长而窄的河流在采样截面之间保持连续河床', () => {
    const d = createDocument();
    d.rivers = [
      {
        id: 1,
        name: '长河',
        width: 8,
        depth: 6,
        waterLevel: 24,
        points: [
          { x: -900, z: 0 },
          { x: 900, z: 0 },
        ],
      },
    ];
    const heights = deriveHeights(d);
    for (const x of [-800, -52, 52, 800]) expect(sampleHeight(d, heights, x, 0)).toBeCloseTo(18);
    expect(d.heights[256 * 513 + 269]).toBe(32);
  });
  it('草生成确定，改变远处密度不改变原位置', () => {
    const d = createDocument(),
      density = new Float32Array(d.heights.length).fill(2),
      layer = {
        id: 1,
        assetId: 'grass-reed',
        density,
        seed: 42,
        version: 1 as const,
        minScale: 0.8,
        maxScale: 1.2,
        maxSlope: 30,
        wind: 1,
      };
    const a = generateGrass(d, d.heights, layer, { x: 0, z: 0 }, 6, 500);
    const b = generateGrass(d, d.heights, layer, { x: 0, z: 0 }, 6, 500);
    expect(a).toEqual(b);
    density[0] = 0;
    expect(generateGrass(d, d.heights, layer, { x: 0, z: 0 }, 6, 500)).toEqual(a);
  });
  it('工程包含城池要塞、资源、密度与逻辑并能重开', () => {
    const d = withSites();
    d.assets.push({
      id: 'custom-tree',
      kind: 'tree',
      hash: imageHash(sampleGlb()),
      name: '测试资源',
      bytes: sampleGlb(),
      size: [1, 2, 1],
      triangles: 1,
      materials: 1,
      scale: 1,
      yaw: 0,
      offset: 0,
      source: 'test',
    });
    d.grass.push({
      id: 4,
      assetId: 'grass-reed',
      density: new Float32Array(d.heights.length).fill(0.5),
      seed: 1,
      version: 1,
      minScale: 0.8,
      maxScale: 1.2,
      maxSlope: 30,
      wind: 1,
    });
    d.nextId = 5;
    const result = decodeProject(encodeProject(d));
    expect(result.owners).toEqual(d.owners);
    expect(result.sites).toEqual(d.sites);
    expect(result.grass[0].density).toEqual(d.grass[0].density);
    expect(result.assets.at(-1)?.bytes).toEqual(sampleGlb());
  });
  it('PNG 是真 16 位灰度，精度优于 8 位', () => {
    const values = new Float32Array([0, 0.12345, 0.56789, 1]),
      png = encodeHeightPng(values, 2, 2, 0, 1);
    expect(png[24]).toBe(16);
    expect(png[25]).toBe(0);
    const decoded = decodeHeightPng(png);
    expect(decoded.bits).toBe(16);
    decoded.values.forEach((v, i) => expect(Math.abs(v - values[i])).toBeLessThan(1 / 65535));
    const damaged = png.slice();
    damaged[40] ^= 1;
    expect(() => decodeHeightPng(damaged)).toThrow();
  });
  it('新增草层撤销删除，重做恢复同一密度', () => {
    const d = createDocument(),
      h = new History(),
      before = snapshot(d);
    d.grass.push({
      id: d.nextId++,
      assetId: 'grass-reed',
      density: new Float32Array(d.heights.length).fill(1),
      seed: 42,
      version: 1,
      minScale: 0.8,
      maxScale: 1.2,
      maxSlope: 30,
      wind: 1,
    });
    h.commit(before, d, '新增草');
    h.undo(d);
    expect(d.grass).toHaveLength(0);
    h.redo(d);
    expect(d.grass[0].density[256]).toBe(1);
  });
  it('拒绝悬空 owner、损坏高度和重复中心', () => {
    const d = withSites();
    d.owners[0] = 999;
    expect(() => validateDocument(d)).toThrow('悬空');
    d.owners[0] = 0;
    d.heights[0] = NaN;
    expect(() => validateDocument(d)).toThrow('高度');
  });
  it('引擎导出接口独立，未注册目标不产生占位结果', () => {
    const registry = new ExportRegistry();
    expect(registry.list()).toEqual([]);
    expect(() => registry.get('unity')).toThrow('尚未实现');
    expect(() => registry.get('godot')).toThrow('尚未实现');
  });
});
