import type { GrassLayer, MapDocument, Point, Tree } from './types';
import { hexWorld } from './hex';
import { riverCurve, riverDistance, sampleHeight, sampleSlope } from './terrain';
export function hashRandom(x: number, z: number, seed: number): number {
  let h = Math.imul(x ^ seed, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export type VegetationDocument = Pick<
  MapDocument,
  'settings' | 'grid' | 'rivers' | 'sites' | 'assets'
>;
export function vegetationFilter(doc: VegetationDocument, heights: Float32Array) {
  const water = doc.rivers.map((r) => ({ river: r, curve: riverCurve(r) }));
  const footprints = doc.sites.map((site) => {
    const asset = doc.assets.find((a) => a.id === site.assetId)!;
    const yaw = site.yaw + asset.yaw;
    return {
      point: hexWorld(doc.grid, site.center),
      halfX: (asset.size[0] * asset.scale * site.scale) / 2 + 2,
      halfZ: (asset.size[2] * asset.scale * site.scale) / 2 + 2,
      sin: Math.sin(yaw),
      cos: Math.cos(yaw),
    };
  });
  return (point: Point, maxSlope: number) => {
    if (
      Math.abs(point.x) > doc.settings.width / 2 ||
      Math.abs(point.z) > doc.settings.depth / 2 ||
      sampleSlope(doc, heights, point.x, point.z) > maxSlope
    )
      return false;
    for (const f of footprints) {
      const x = point.x - f.point.x,
        z = point.z - f.point.z;
      if (Math.abs(x * f.cos - z * f.sin) < f.halfX && Math.abs(x * f.sin + z * f.cos) < f.halfZ)
        return false;
    }
    for (const { river, curve } of water)
      if (
        riverDistance(point, curve) < river.width * 0.65 &&
        sampleHeight(doc, heights, point.x, point.z) < river.waterLevel + 0.5
      )
        return false;
    return true;
  };
}
export function generateGrass(
  doc: VegetationDocument,
  heights: Float32Array,
  layer: GrassLayer,
  center: Point,
  radius = 80,
  budget = 50000,
): Tree[] {
  const result: Tree[] = [],
    step = 0.5,
    n = doc.settings.samples,
    valid = vegetationFilter(doc, heights);
  const x0 = Math.floor((center.x - radius) / step),
    x1 = Math.ceil((center.x + radius) / step),
    z0 = Math.floor((center.z - radius) / step),
    z1 = Math.ceil((center.z + radius) / step);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const px = (x + hashRandom(x, z, layer.seed)) * step,
        pz = (z + hashRandom(x, z, layer.seed + 1)) * step;
      if (
        Math.hypot(px - center.x, pz - center.z) > radius ||
        Math.abs(px) > doc.settings.width / 2 ||
        Math.abs(pz) > doc.settings.depth / 2
      )
        continue;
      const col = Math.round((px / doc.settings.width + 0.5) * (n - 1)),
        row = Math.round((pz / doc.settings.depth + 0.5) * (n - 1));
      const density = layer.density[row * n + col];
      if (
        hashRandom(x, z, layer.seed + 2) >= density * step * step ||
        !valid({ x: px, z: pz }, layer.maxSlope)
      )
        continue;
      result.push({
        id: (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0,
        assetId: layer.assetId,
        x: px,
        z: pz,
        yaw: hashRandom(x, z, layer.seed + 3) * Math.PI * 2,
        scale:
          layer.minScale + (layer.maxScale - layer.minScale) * hashRandom(x, z, layer.seed + 4),
      });
    }
  // 固定世界身份排序；预算不会修改密度或候选身份。
  result.sort((a, b) => a.id - b.id);
  return result.slice(0, budget);
}
