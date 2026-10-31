import type { MapDocument, Point, River } from './types';
import { snapshot, snapshotSize, HISTORY_BUDGET } from './history';
import { containsPoint, clipSegment } from './map-bounds';
import { rebuildGridCoverage } from './grid-coverage';
import { hexWorld, cellOnMap, indexHex } from './hex';
import { sampleHeight, riverCurve, validateRiver } from './terrain';
import { validateDocument } from './document';
export interface ResizeReport {
  removedTrees: number;
  removedSites: number;
  removedCells: number;
  affectedGrassLayers: number;
  clippedRivers: number;
  removedRivers: number;
  addedRiverSegments: number;
}
export interface ResizeCandidate {
  document: MapDocument;
  report: ResizeReport;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
function clipRiver(river: River, width: number, depth: number): Point[][] {
  const points = riverCurve(river),
    runs: Point[][] = [];
  let active: Point[] | null = null;
  for (let i = 1; i < points.length; i++) {
    const segment = clipSegment({ width, depth }, points[i - 1], points[i]);
    if (!segment || distance(...segment) < 1e-7) {
      active = null;
      continue;
    }
    if (active && distance(active[active.length - 1], segment[0]) < 1e-6) active.push(segment[1]);
    else {
      active = [...segment];
      runs.push(active);
    }
    if (distance(segment[1], points[i]) > 1e-6) active = null;
  }
  return runs;
}
export function prepareResize(source: MapDocument, width: number, depth: number): ResizeCandidate {
  if (![width, depth].every((v) => Number.isInteger(v) && v > 0 && v <= 16384))
    throw new Error('地面宽度和长度须为 1～16384 的整数米。');
  const minimumRiverWidth = (2 * Math.max(width, depth)) / (source.settings.samples - 1);
  const narrowRiver = source.rivers.find((river) => river.width < minimumRiverWidth);
  if (narrowRiver)
    throw new Error(
      narrowRiver.name +
        '：调整后河宽至少需要 ' +
        minimumRiverWidth.toFixed(2) +
        ' 米，请先加宽河流。',
    );
  const doc = snapshot(source),
    n = source.settings.samples;
  doc.settings = { ...source.settings, width, depth };
  const report: ResizeReport = {
    removedTrees: 0,
    removedSites: 0,
    removedCells: 0,
    affectedGrassLayers: 0,
    clippedRivers: 0,
    removedRivers: 0,
    addedRiverSegments: 0,
  };
  if (width === source.settings.width && depth === source.settings.depth)
    return { document: doc, report };
  const keep = (point: Point) => containsPoint(doc.settings, point);
  doc.trees = doc.trees.filter(keep);
  report.removedTrees = source.trees.length - doc.trees.length;
  doc.sites = doc.sites.filter((site) => keep(hexWorld(source.grid, site.center)));
  report.removedSites = source.sites.length - doc.sites.length;
  const remaining = new Set(doc.sites.map((site) => site.id));
  doc.owners.forEach((owner, i) => {
    if (
      owner &&
      (!remaining.has(owner) || !cellOnMap({ ...doc, grid: source.grid }, indexHex(source.grid, i)))
    ) {
      doc.owners[i] = 0;
      report.removedCells++;
    }
  });
  rebuildGridCoverage(doc);
  const layerAffected = new Set<number>();
  source.grass.forEach((layer) =>
    layer.density.forEach((value, i) => {
      if (
        value > 0 &&
        !keep({
          x: ((i % n) / (n - 1)) * source.settings.width - source.settings.width / 2,
          z: (Math.floor(i / n) / (n - 1)) * source.settings.depth - source.settings.depth / 2,
        })
      )
        layerAffected.add(layer.id);
    }),
  );
  report.affectedGrassLayers = layerAffected.size;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const x = (col / (n - 1) - 0.5) * width,
        z = (row / (n - 1) - 0.5) * depth;
      const i = row * n + col;
      doc.heights[i] = sampleHeight(source, source.heights, x, z);
      // 与地形相同的三角形重心插值；量化后保持四通道总和为 255。
      const gx = clamp((x / source.settings.width + 0.5) * (n - 1), n - 1);
      const gz = clamp((z / source.settings.depth + 0.5) * (n - 1), n - 1);
      const cx = Math.min(n - 2, Math.floor(gx)),
        cz = Math.min(n - 2, Math.floor(gz));
      const u = gx - cx,
        v = gz - cz,
        a = cz * n + cx;
      const indices = u + v <= 1 ? [a, a + 1, a + n] : [a + n + 1, a + n, a + 1];
      const weights = u + v <= 1 ? [1 - u - v, u, v] : [u + v - 1, 1 - u, 1 - v];
      let sum = 0;
      for (let channel = 0; channel < 4; channel++) {
        const value =
          channel < 3
            ? Math.min(
                255 - sum,
                Math.round(
                  indices.reduce(
                    (total, index, k) => total + source.surface[index * 4 + channel] * weights[k],
                    0,
                  ),
                ),
              )
            : 255 - sum;
        doc.surface[i * 4 + channel] = value;
        sum += value;
      }
      doc.grass.forEach((layer, k) => {
        layer.density[i] = containsPoint(source.settings, { x, z })
          ? Math.max(
              0,
              indices.reduce(
                (total, index, j) => total + source.grass[k].density[index] * weights[j],
                0,
              ),
            )
          : 0;
      });
    }
  doc.rivers = [];
  for (const river of source.rivers) {
    const curve = riverCurve(river);
    if (curve.every(keep)) {
      const touches = curve.some(
        (point) =>
          Math.abs(point.x) + river.width * 0.85 >= width / 2 ||
          Math.abs(point.z) + river.width * 0.85 >= depth / 2,
      );
      doc.rivers.push({
        ...structuredClone(river),
        clipped: river.clipped || touches || undefined,
      });
      continue;
    }
    const runs = clipRiver(river, width, depth);
    if (!runs.length) {
      report.removedRivers++;
      continue;
    }
    report.clippedRivers++;
    report.addedRiverSegments += runs.length - 1;
    runs.forEach((points, i) =>
      doc.rivers.push({
        ...river,
        points,
        id: i === 0 ? river.id : doc.nextId++,
        name: i === 0 ? river.name : river.name + ' · 河段 ' + (i + 1),
        interpolation: 'linear',
        clipped: true,
      }),
    );
  }
  validateDocument(doc);
  for (const river of doc.rivers) {
    const error = validateRiver(doc, river);
    if (error) throw new Error(river.name + '：' + error);
  }
  if (snapshotSize(source) + snapshotSize(doc) > HISTORY_BUDGET)
    throw new Error('尺寸调整超过单次历史内存预算，请减少草层或资源实例后重试。');
  return { document: doc, report };
}
