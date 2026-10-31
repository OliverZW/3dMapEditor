import type { BrushSettings, MapDocument, Point, River } from './types';
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export function sampleHeight(
  doc: MapDocument,
  heights: Float32Array,
  x: number,
  z: number,
): number {
  const { width, depth, samples: n } = doc.settings;
  const gx = clamp((x / width + 0.5) * (n - 1), 0, n - 1),
    gz = clamp((z / depth + 0.5) * (n - 1), 0, n - 1);
  const col = Math.min(n - 2, Math.floor(gx)),
    row = Math.min(n - 2, Math.floor(gz));
  const u = gx - col,
    v = gz - row,
    i = row * n + col;
  // 网格对角线从右上到左下；与渲染器索引严格一致。
  return u + v <= 1
    ? heights[i] * (1 - u - v) + heights[i + 1] * u + heights[i + n] * v
    : heights[i + n + 1] * (u + v - 1) + heights[i + n] * (1 - u) + heights[i + 1] * (1 - v);
}
export function sampleSlope(doc: MapDocument, heights: Float32Array, x: number, z: number): number {
  const dx = doc.settings.width / (doc.settings.samples - 1),
    dz = doc.settings.depth / (doc.settings.samples - 1);
  return (
    (Math.atan(
      Math.hypot(
        (sampleHeight(doc, heights, x + dx, z) - sampleHeight(doc, heights, x - dx, z)) / (2 * dx),
        (sampleHeight(doc, heights, x, z + dz) - sampleHeight(doc, heights, x, z - dz)) / (2 * dz),
      ),
    ) *
      180) /
    Math.PI
  );
}
export function forBrush(
  doc: MapDocument,
  point: Point,
  radius: number,
  run: (index: number, distance: number) => void,
): void {
  const { width, depth, samples: n } = doc.settings;
  const x0 = clamp(Math.floor(((point.x - radius) / width + 0.5) * (n - 1)), 0, n - 1),
    x1 = clamp(Math.ceil(((point.x + radius) / width + 0.5) * (n - 1)), 0, n - 1);
  const z0 = clamp(Math.floor(((point.z - radius) / depth + 0.5) * (n - 1)), 0, n - 1),
    z1 = clamp(Math.ceil(((point.z + radius) / depth + 0.5) * (n - 1)), 0, n - 1);
  for (let row = z0; row <= z1; row++)
    for (let col = x0; col <= x1; col++) {
      const distance = Math.hypot(
        -width / 2 + (col * width) / (n - 1) - point.x,
        -depth / 2 + (row * depth) / (n - 1) - point.z,
      );
      if (distance <= radius) run(row * n + col, distance);
    }
}
export function applyTerrainBrush(
  doc: MapDocument,
  point: Point,
  brush: BrushSettings,
  reverse = false,
): void {
  const n = doc.settings.samples,
    original = brush.terrainMode === 'smooth' ? doc.heights.slice() : doc.heights;
  forBrush(doc, point, brush.radius, (i, distance) => {
    const t = clamp((1 - distance / brush.radius) / Math.max(0.01, brush.falloff), 0, 1),
      weight = t * t * (3 - 2 * t) * brush.strength;
    let height = original[i];
    if (brush.terrainMode === 'raise' || brush.terrainMode === 'lower')
      height += weight * 5 * (brush.terrainMode === 'raise' ? 1 : -1) * (reverse ? -1 : 1);
    else if (brush.terrainMode === 'flatten') height += (brush.height - height) * weight;
    else {
      let sum = 0,
        count = 0;
      const row = Math.floor(i / n),
        col = i % n;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dz,
            c = col + dx;
          if (r >= 0 && r < n && c >= 0 && c < n) {
            sum += original[r * n + c];
            count++;
          }
        }
      height += (sum / count - height) * weight;
    }
    doc.heights[i] = clamp(height, doc.settings.minHeight, doc.settings.maxHeight);
  });
}
export function applySurfaceBrush(doc: MapDocument, point: Point, brush: BrushSettings): void {
  forBrush(doc, point, brush.radius, (i, d) => {
    const w = (1 - d / brush.radius) * brush.strength;
    const values = [0, 1, 2, 3].map(
      (c) => doc.surface[i * 4 + c] * (1 - w) + (c === brush.surfaceLayer ? 255 * w : 0),
    );
    let total = 0;
    for (let c = 0; c < 3; c++) {
      doc.surface[i * 4 + c] = Math.round(values[c]);
      total += doc.surface[i * 4 + c];
    }
    if (total > 255) {
      const channel = values.indexOf(Math.max(...values.slice(0, 3)));
      doc.surface[i * 4 + channel] -= total - 255;
      total = 255;
    }
    doc.surface[i * 4 + 3] = 255 - total;
  });
}
export function interpolateStroke(from: Point, to: Point, spacing: number): Point[] {
  const length = Math.hypot(to.x - from.x, to.z - from.z),
    n = Math.max(1, Math.ceil(length / spacing));
  return Array.from({ length: n }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / n,
    z: from.z + ((to.z - from.z) * (i + 1)) / n,
  }));
}
export function riverCurve(river: Pick<River, 'points' | 'interpolation'>, steps = 16): Point[] {
  const points = river.points;
  if (river.interpolation === 'linear') return points.map((point) => ({ ...point }));
  const result: Point[] = [];
  if (points.length < 2) return result;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)],
      b = points[i],
      c = points[i + 1],
      d = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const value = (key: 'x' | 'z') =>
        0.5 *
        (2 * b[key] +
          (-a[key] + c[key]) * t +
          (2 * a[key] - 5 * b[key] + 4 * c[key] - d[key]) * t * t +
          (-a[key] + 3 * b[key] - 3 * c[key] + d[key]) * t * t * t);
      result.push({ x: value('x'), z: value('z') });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
export function riverDistance(p: Point, curve: Point[]): number {
  let min = Infinity;
  for (let i = 1; i < curve.length; i++)
    min = Math.min(min, segmentDistance(p, curve[i - 1], curve[i]));
  return min;
}
export function validateRiver(doc: MapDocument, river: River): string | null {
  if (typeof river.name !== 'string' || !river.name.trim()) return '河流名称不能为空';
  if (river.points.length < 2) return '河流至少需要两个控制点';
  if (river.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z)))
    return '河流控制点必须是有限坐标';
  if (
    ![river.width, river.depth, river.waterLevel].every(Number.isFinite) ||
    river.width <
      (2 * Math.max(doc.settings.width, doc.settings.depth)) / (doc.settings.samples - 1) ||
    river.depth <= 0
  )
    return '河宽应至少覆盖两个地形采样间距，深度必须大于零';
  if (
    river.waterLevel > doc.settings.maxHeight ||
    river.waterLevel - river.depth < doc.settings.minHeight
  )
    return '水位与河床底部必须位于工程高度范围内';
  const curve = riverCurve(river).filter(
    (p, i, points) => !i || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > 1e-7,
  );
  if (curve.length < 2) return '河流至少需要两个不同位置的控制点';
  const margin = river.width * 0.8;
  if (
    !river.clipped &&
    curve.some(
      (p) =>
        Math.abs(p.x) + margin >= doc.settings.width / 2 ||
        Math.abs(p.z) + margin >= doc.settings.depth / 2,
    )
  )
    return '河流影响范围超出地形边界';
  const orient = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 1; i < curve.length; i++)
    for (let j = i + 2; j < curve.length; j++)
      if (
        segmentDistance(curve[j - 1], curve[i - 1], curve[i]) < 1e-7 ||
        segmentDistance(curve[j], curve[i - 1], curve[i]) < 1e-7 ||
        segmentDistance(curve[i - 1], curve[j - 1], curve[j]) < 1e-7 ||
        segmentDistance(curve[i], curve[j - 1], curve[j]) < 1e-7 ||
        (orient(curve[i - 1], curve[i], curve[j - 1]) * orient(curve[i - 1], curve[i], curve[j]) <
          0 &&
          orient(curve[j - 1], curve[j], curve[i - 1]) * orient(curve[j - 1], curve[j], curve[i]) <
            0)
      )
        return '河流中心线自交，请调整控制点';
  return null;
}
export function deriveHeights(doc: MapDocument): Float32Array {
  const heights = doc.heights.slice();
  for (const river of doc.rivers) {
    const curve = riverCurve(river);
    const reach = river.width * 0.85;
    const visited = new Set<number>();
    const stamps = curve.flatMap((point, index) =>
      index ? interpolateStroke(curve[index - 1], point, Math.max(1, reach * 0.5)) : [point],
    );
    for (const p of stamps)
      forBrush(doc, p, reach, (i) => {
        if (visited.has(i)) return;
        visited.add(i);
        const col = i % doc.settings.samples,
          row = Math.floor(i / doc.settings.samples);
        const pos = {
          x: (col / (doc.settings.samples - 1) - 0.5) * doc.settings.width,
          z: (row / (doc.settings.samples - 1) - 0.5) * doc.settings.depth,
        };
        const distance = riverDistance(pos, curve);
        const t = clamp((distance - river.width * 0.28) / (reach - river.width * 0.28), 0, 1);
        const blend = t * t * (3 - 2 * t);
        const target =
          Math.max(doc.settings.minHeight, river.waterLevel - river.depth) * (1 - blend) +
          doc.heights[i] * blend;
        heights[i] = Math.min(heights[i], target);
      });
  }
  return heights;
}
