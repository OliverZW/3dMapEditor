import type { MapDocument, ModelAsset } from './types';
import { defaultSurfaceMaterial, validateSurfaceMaterial } from './surface-material';
import { hexIndex, hexWorld, cellOnMap, indexHex } from './hex';
import { coveringGrid } from './grid-coverage';
import { containsPoint } from './map-bounds';
import modelManifest from '../../editor-assets/models/manifest.json';
import { defaultWaterMaterial, validateWaterMaterial } from './water-material';
export const BUILTIN_ASSETS: ModelAsset[] = modelManifest.assets.map(
  ({ file, lod: _lod, ...asset }) => ({ ...asset, resource: { origin: 'builtin', id: file } }),
) as ModelAsset[];
export function createDocument(samples = 513, width = 2048, depth = 2048): MapDocument {
  const grid = coveringGrid({ width, depth });
  const count = samples * samples;
  const surface = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) surface[i * 4] = 255;
  return {
    waterMaterial: defaultWaterMaterial(),
    formatVersion: 3,
    generatorVersion: 1,
    name: '未命名山河',
    settings: { width, depth, samples, minHeight: 0, maxHeight: 256 },
    grid,
    nextId: 1,
    heights: new Float32Array(count).fill(32),
    surface,
    surfaceMaterial: defaultSurfaceMaterial(),
    owners: new Uint32Array(grid.columns * grid.rows),
    assets: structuredClone(BUILTIN_ASSETS),
    trees: [],
    grass: [],
    rivers: [],
    sites: [],
    factions: [],
  };
}
export function validateDocument(doc: MapDocument): void {
  if (doc.formatVersion !== 3 || doc.generatorVersion !== 1)
    throw new Error('不支持的工程或生成器版本');
  validateSurfaceMaterial(doc.surfaceMaterial);
  validateWaterMaterial(doc.waterMaterial);
  const s = doc.settings;
  if (
    ![513, 1025].includes(s.samples) ||
    ![s.width, s.depth, s.minHeight, s.maxHeight].every(Number.isFinite) ||
    !Number.isInteger(s.width) ||
    s.width <= 0 ||
    !Number.isInteger(s.depth) ||
    s.depth <= 0 ||
    s.width > 16384 ||
    s.depth > 16384 ||
    s.maxHeight <= s.minHeight
  )
    throw new Error('地图参数无效');
  const g = doc.grid;
  if (
    ![g.columns, g.rows].every((v) => Number.isInteger(v) && v > 0 && v <= 2048) ||
    ![g.radius, g.originX, g.originZ].every(Number.isFinite) ||
    g.columns * g.rows > 1048576 ||
    g.radius <= 0
  )
    throw new Error('逻辑网格无效');
  const count = s.samples ** 2;
  if (
    doc.heights.length !== count ||
    doc.surface.length !== count * 4 ||
    doc.owners.length !== g.columns * g.rows
  )
    throw new Error('地图数据长度不一致');
  if (!doc.heights.every((h) => Number.isFinite(h) && h >= s.minHeight && h <= s.maxHeight))
    throw new Error('高度数据超出范围');
  for (let i = 0; i < count; i++)
    if (doc.surface.subarray(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0) !== 255)
      throw new Error('地表权重未归一化');
  const ids = new Set<number>();
  const register = (id: number) => {
    if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) throw new Error('对象 ID 无效或重复');
    ids.add(id);
  };
  const assets = new Map(doc.assets.map((a) => [a.id, a]));
  if (assets.size !== doc.assets.length) throw new Error('资源 ID 重复');
  for (const a of doc.assets)
    if (
      !['city', 'fortress', 'tree', 'grass'].includes(a.kind) ||
      !a.id ||
      typeof a.name !== 'string' ||
      !a.name.trim() ||
      a.name.length > 128 ||
      !a.size.every((v) => Number.isFinite(v) && v >= 0) ||
      ![a.scale, a.yaw, a.offset].every(Number.isFinite) ||
      a.scale <= 0 ||
      (!a.bytes &&
        !BUILTIN_ASSETS.some(
          (preset) => preset.id === a.id && preset.hash === a.hash && preset.builtin === a.builtin,
        ))
    )
      throw new Error('资源描述无效');
  const pointValid = (x: number, z: number) =>
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Math.abs(x) <= s.width / 2 &&
    Math.abs(z) <= s.depth / 2;
  const factions = new Set(doc.factions.map((f) => f.id));
  for (const f of doc.factions) {
    register(f.id);
    if (!f.name.trim() || !/^#[\da-f]{6}$/i.test(f.color)) throw new Error('势力属性无效');
  }
  const centers = new Set<number>();
  for (const site of doc.sites) {
    register(site.id);
    const i = hexIndex(g, site.center);
    if (
      i < 0 ||
      centers.has(i) ||
      doc.owners[i] !== site.id ||
      !containsPoint(s, hexWorld(g, site.center))
    )
      throw new Error('据点中心冲突或归属错误');
    centers.add(i);
    if (
      !site.name.trim() ||
      assets.get(site.assetId)?.kind !== site.kind ||
      ![site.yaw, site.scale].every(Number.isFinite) ||
      site.scale <= 0 ||
      (site.factionId !== null && !factions.has(site.factionId))
    )
      throw new Error('据点引用或属性无效');
  }
  const sites = new Set(doc.sites.map((s) => s.id));
  if (!doc.owners.every((id, i) => id === 0 || (sites.has(id) && cellOnMap(doc, indexHex(g, i)))))
    throw new Error('存在悬空据点归属');
  for (const tree of doc.trees) {
    register(tree.id);
    if (
      assets.get(tree.assetId)?.kind !== 'tree' ||
      !pointValid(tree.x, tree.z) ||
      ![tree.scale, tree.yaw].every(Number.isFinite) ||
      tree.scale <= 0
    )
      throw new Error('树木数据无效');
  }
  for (const grass of doc.grass) {
    register(grass.id);
    if (
      grass.version !== 1 ||
      grass.density.length !== count ||
      !grass.density.every((d) => Number.isFinite(d) && d >= 0 && d <= 20) ||
      assets.get(grass.assetId)?.kind !== 'grass' ||
      ![grass.minScale, grass.maxScale, grass.maxSlope, grass.wind, grass.seed].every(
        Number.isFinite,
      ) ||
      grass.minScale <= 0 ||
      grass.maxScale < grass.minScale
    )
      throw new Error('草层数据无效');
  }
  for (const river of doc.rivers) {
    register(river.id);
    if (
      typeof river.name !== 'string' ||
      !river.name.trim() ||
      river.points.length < 2 ||
      (river.interpolation !== undefined &&
        !['catmull-rom', 'linear'].includes(river.interpolation)) ||
      (river.clipped !== undefined && typeof river.clipped !== 'boolean') ||
      !river.points.every((p) => pointValid(p.x, p.z)) ||
      ![river.width, river.depth, river.waterLevel].every(Number.isFinite) ||
      river.depth <= 0 ||
      river.width < (2 * Math.max(s.width, s.depth)) / (s.samples - 1)
    )
      throw new Error('河流数据无效');
  }
  if (
    !Number.isSafeInteger(doc.nextId) ||
    doc.nextId <= [...ids].reduce((max, id) => Math.max(max, id), 0)
  )
    throw new Error('递增 ID 无效');
}
