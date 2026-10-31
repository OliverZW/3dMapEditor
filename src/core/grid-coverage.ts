import type { HexGrid, MapDocument, MapSettings } from './types';
import { hexWorld, indexHex, worldHex, hexIndex, hexCorners } from './hex';
import { clipPolygon } from './map-bounds';
export function coveringGrid(
  settings: Pick<MapSettings, 'width' | 'depth'>,
  previous?: HexGrid,
): HexGrid {
  const radius = previous?.radius ?? 12,
    sx = Math.sqrt(3) * radius,
    sz = 1.5 * radius;
  const anchorX = previous?.originX ?? 0,
    anchorZ = previous?.originZ ?? 0;
  // 偶数行平移保留奇偶行错列相位，避免扩大时原有格心移动。
  const row = Math.floor((-settings.depth / 2 - anchorZ - radius) / sz / 2) * 2;
  const col = Math.floor((-settings.width / 2 - anchorX) / sx) - 1;
  const originX = anchorX + col * sx,
    originZ = anchorZ + row * sz;
  const columns = Math.ceil((settings.width / 2 - originX) / sx) + 2;
  const rows = Math.ceil((settings.depth / 2 - originZ) / sz) + 2;
  if (columns > 2048 || rows > 2048 || columns * rows > 1048576)
    throw new Error('完整逻辑网格超过容量预算，请减小地图范围。');
  return { radius, originX, originZ, columns, rows };
}
export function rebuildGridCoverage(doc: MapDocument) {
  const previous = doc.grid,
    grid = coveringGrid(doc.settings, previous);
  const owners = new Uint32Array(grid.columns * grid.rows);
  doc.owners.forEach((owner, i) => {
    if (!owner) return;
    const oldCell = indexHex(previous, i),
      point = hexWorld(previous, oldCell);
    const cell = worldHex(grid, point),
      index = hexIndex(grid, cell);
    if (index >= 0 && clipPolygon(doc.settings, hexCorners(grid, cell)).length >= 3)
      owners[index] = owner;
  });
  for (const site of doc.sites) site.center = worldHex(grid, hexWorld(previous, site.center));
  doc.grid = grid;
  doc.owners = owners;
}
