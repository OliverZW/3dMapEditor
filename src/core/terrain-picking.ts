import type { MapSettings, Point } from './types';
interface Vector3 {
  x: number;
  y: number;
  z: number;
}
export interface TerrainRay {
  origin: Vector3;
  direction: Vector3;
}

function triangleDistance(ray: TerrainRay, a: Vector3, b: Vector3, c: Vector3): number | null {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const d = ray.direction,
    o = ray.origin;
  const p = { x: d.y * v.z - d.z * v.y, y: d.z * v.x - d.x * v.z, z: d.x * v.y - d.y * v.x };
  const det = u.x * p.x + u.y * p.y + u.z * p.z;
  if (det <= 1e-12) return null;
  const t = { x: o.x - a.x, y: o.y - a.y, z: o.z - a.z };
  const s = (t.x * p.x + t.y * p.y + t.z * p.z) / det;
  if (s < -1e-8 || s > 1 + 1e-8) return null;
  const q = { x: t.y * u.z - t.z * u.y, y: t.z * u.x - t.x * u.z, z: t.x * u.y - t.y * u.x };
  const w = (d.x * q.x + d.y * q.y + d.z * q.z) / det;
  if (w < -1e-8 || s + w > 1 + 1e-8) return null;
  const distance = (v.x * q.x + v.y * q.y + v.z * q.z) / det;
  return distance >= 0 ? distance : null;
}

/** 按射线顺序遍历采样格，求与可见地形一致的最近三角面交点，不跨步跳过山脊。 */
export function pickTerrain(
  settings: MapSettings,
  heights: Float32Array,
  ray: TerrainRay,
): Point | null {
  const { width, depth, samples: n, minHeight, maxHeight } = settings;
  const o = ray.origin,
    d = ray.direction;
  if (![o.x, o.y, o.z, d.x, d.y, d.z].every(Number.isFinite) || Math.hypot(d.x, d.y, d.z) < 1e-12)
    return null;
  let enter = 0,
    exit = Infinity;
  const slabs: [number, number, number, number][] = [
    [o.x, d.x, -width / 2, width / 2],
    [o.y, d.y, minHeight - 1, maxHeight + 1],
    [o.z, d.z, -depth / 2, depth / 2],
  ];
  for (const [origin, direction, min, max] of slabs) {
    if (Math.abs(direction) < 1e-12) {
      if (origin < min || origin > max) return null;
    } else {
      const a = (min - origin) / direction,
        b = (max - origin) / direction;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
  }
  if (exit < enter || !Number.isFinite(exit)) return null;
  const sx = width / (n - 1),
    sz = depth / (n - 1);
  const clampCell = (v: number) => Math.max(0, Math.min(n - 2, Math.floor(v)));
  let col = clampCell((o.x + d.x * (enter + 1e-7) + width / 2) / sx);
  let row = clampCell((o.z + d.z * (enter + 1e-7) + depth / 2) / sz);
  const stepX = Math.sign(d.x),
    stepZ = Math.sign(d.z);
  let nextX = stepX ? (-width / 2 + (col + (stepX > 0 ? 1 : 0)) * sx - o.x) / d.x : Infinity;
  let nextZ = stepZ ? (-depth / 2 + (row + (stepZ > 0 ? 1 : 0)) * sz - o.z) / d.z : Infinity;
  const deltaX = stepX ? sx / Math.abs(d.x) : Infinity;
  const deltaZ = stepZ ? sz / Math.abs(d.z) : Infinity;
  const vertex = (x: number, z: number): Vector3 => ({
    x: -width / 2 + x * sx,
    y: heights[z * n + x],
    z: -depth / 2 + z * sz,
  });
  for (let count = 0; count < n * 2 + 2; count++) {
    const end = Math.min(nextX, nextZ, exit);
    const a = vertex(col, row),
      b = vertex(col + 1, row),
      c = vertex(col, row + 1),
      e = vertex(col + 1, row + 1);
    const distances = [triangleDistance(ray, a, c, b), triangleDistance(ray, b, c, e)].filter(
      (t): t is number => t !== null && t >= enter - 1e-7 && t <= end + 1e-7,
    );
    if (distances.length) {
      const t = Math.min(...distances);
      return { x: o.x + d.x * t, z: o.z + d.z * t };
    }
    if (end >= exit) return null;
    const crossX = nextX <= nextZ,
      crossZ = nextZ <= nextX;
    if (crossX) {
      col += stepX;
      nextX += deltaX;
    }
    if (crossZ) {
      row += stepZ;
      nextZ += deltaZ;
    }
    if (col < 0 || col >= n - 1 || row < 0 || row >= n - 1) return null;
    enter = end;
  }
  return null;
}
