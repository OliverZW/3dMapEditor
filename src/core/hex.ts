import type { Hex, HexGrid, MapDocument, Point } from './types';
import { clipPolygon, containsPoint } from './map-bounds';
export function hexIndex(grid: HexGrid, hex: Hex): number {
  const col = hex.q + Math.floor(hex.r / 2);
  return Number.isInteger(hex.q) &&
    Number.isInteger(hex.r) &&
    col >= 0 &&
    col < grid.columns &&
    hex.r >= 0 &&
    hex.r < grid.rows
    ? hex.r * grid.columns + col
    : -1;
}
export function indexHex(grid: HexGrid, index: number): Hex {
  const r = Math.floor(index / grid.columns);
  return { q: (index % grid.columns) - Math.floor(r / 2), r };
}
export function hexWorld(grid: HexGrid, hex: Hex): Point {
  return {
    x: grid.originX + Math.sqrt(3) * grid.radius * (hex.q + hex.r / 2),
    z: grid.originZ + 1.5 * grid.radius * hex.r,
  };
}
export function hexCorners(grid: HexGrid, cell: Hex): Point[] {
  const center = hexWorld(grid, cell);
  return Array.from({ length: 6 }, (_, k) => {
    const angle = ((60 * k - 30) * Math.PI) / 180;
    return {
      x: center.x + Math.cos(angle) * grid.radius,
      z: center.z + Math.sin(angle) * grid.radius,
    };
  });
}
export function cellOnMap(doc: MapDocument, cell: Hex) {
  return (
    hexIndex(doc.grid, cell) >= 0 &&
    clipPolygon(doc.settings, hexCorners(doc.grid, cell)).length >= 3
  );
}
export function roundHex(q: number, r: number): Hex {
  let x = Math.round(q),
    z = Math.round(r);
  const y = Math.round(-q - r);
  const dx = Math.abs(x - q),
    dy = Math.abs(y + q + r),
    dz = Math.abs(z - r);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dz > dy) z = -x - y;
  return { q: x, r: z };
}
export function worldHex(grid: HexGrid, point: Point): Hex {
  const z = (point.z - grid.originZ) / grid.radius;
  return roundHex((point.x - grid.originX) / (Math.sqrt(3) * grid.radius) - z / 3, (z * 2) / 3);
}
export function hexDistance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
export function hexDisk(center: Hex, radius: number): Hex[] {
  const cells: Hex[] = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++)
      cells.push({ q: center.q + q, r: center.r + r });
  return cells;
}
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  return Array.from({ length: n + 1 }, (_, i) =>
    roundHex(a.q + ((b.q - a.q) * i) / (n || 1) + 1e-7, a.r + ((b.r - a.r) * i) / (n || 1) + 1e-7),
  );
}
export function getCellOwner(doc: MapDocument, cell: Hex) {
  const index = hexIndex(doc.grid, cell);
  return index < 0 ? undefined : doc.sites.find((site) => site.id === doc.owners[index]);
}
export function getCellFaction(doc: MapDocument, cell: Hex) {
  const site = getCellOwner(doc, cell);
  return doc.factions.find((faction) => faction.id === site?.factionId);
}
export function getSiteCells(doc: MapDocument, id: number, includeCenter = true): Hex[] {
  const site = doc.sites.find((s) => s.id === id);
  const centerIndex = site ? hexIndex(doc.grid, site.center) : -1;
  const cells: Hex[] = [];
  doc.owners.forEach((owner, i) => {
    if (owner === id && (includeCenter || i !== centerIndex)) cells.push(indexHex(doc.grid, i));
  });
  return cells;
}
export function getFactionCells(doc: MapDocument, id: number): Hex[] {
  const ids = new Set(doc.sites.filter((s) => s.factionId === id).map((s) => s.id));
  const cells: Hex[] = [];
  doc.owners.forEach((owner, i) => {
    if (ids.has(owner)) cells.push(indexHex(doc.grid, i));
  });
  return cells;
}
export function paintTerritory(
  doc: MapDocument,
  siteId: number,
  cells: Hex[],
  erase: boolean,
): void {
  if (!doc.sites.some((s) => s.id === siteId)) throw new Error('请先选择据点');
  const centers = new Set(doc.sites.map((s) => hexIndex(doc.grid, s.center)));
  for (const cell of cells) {
    const i = hexIndex(doc.grid, cell);
    if (i < 0 || centers.has(i) || !cellOnMap(doc, cell)) continue;
    if (!erase || doc.owners[i] === siteId) doc.owners[i] = erase ? 0 : siteId;
  }
}
export function moveSite(doc: MapDocument, id: number, center: Hex): void {
  const site = doc.sites.find((s) => s.id === id);
  if (!site) throw new Error('据点不存在');
  const index = hexIndex(doc.grid, center);
  if (index < 0 || !containsPoint(doc.settings, hexWorld(doc.grid, center)))
    throw new Error('中心超出地图地面');
  const old = hexIndex(doc.grid, site.center);
  if (old === index) return;
  if (doc.sites.some((s) => s.id !== id && hexIndex(doc.grid, s.center) === index))
    throw new Error('该格已被其他据点中心占用');
  doc.owners[old] = 0;
  doc.owners[index] = id;
  site.center = { ...center };
}
