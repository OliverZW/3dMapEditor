import type { MapSettings, Point } from './types';
export type MapBounds = Pick<MapSettings, 'width' | 'depth'>;
export function containsPoint(bounds: MapBounds, point: Point) {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.z) &&
    Math.abs(point.x) <= bounds.width / 2 + 1e-7 &&
    Math.abs(point.z) <= bounds.depth / 2 + 1e-7
  );
}
/** Liang–Barsky，包含边界；零长度切触由调用方排除。 */
export function clipSegment(bounds: MapBounds, a: Point, b: Point): [Point, Point] | null {
  let start = 0,
    end = 1;
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const p = [-dx, dx, -dz, dz];
  const q = [
    a.x + bounds.width / 2,
    bounds.width / 2 - a.x,
    a.z + bounds.depth / 2,
    bounds.depth / 2 - a.z,
  ];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return null;
  }
  const at = (t: number) => ({
    x: Math.max(-bounds.width / 2, Math.min(bounds.width / 2, a.x + t * dx)),
    z: Math.max(-bounds.depth / 2, Math.min(bounds.depth / 2, a.z + t * dz)),
  });
  return [at(start), at(end)];
}
export function clipPolygon(bounds: MapBounds, points: Point[]): Point[] {
  let output = points;
  const planes: ['x' | 'z', number, number][] = [
    ['x', -bounds.width / 2, 1],
    ['x', bounds.width / 2, -1],
    ['z', -bounds.depth / 2, 1],
    ['z', bounds.depth / 2, -1],
  ];
  for (const [axis, limit, sign] of planes) {
    const input = output;
    output = [];
    if (!input.length) break;
    for (let i = 0; i < input.length; i++) {
      const a = input[i],
        b = input[(i + 1) % input.length];
      const aIn = (a[axis] - limit) * sign >= -1e-8;
      const bIn = (b[axis] - limit) * sign >= -1e-8;
      if (aIn) output.push(a);
      if (aIn !== bIn) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        output.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
  }
  const area = output.reduce((sum, point, i) => {
    const next = output[(i + 1) % output.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0);
  return Math.abs(area) > 1e-8 ? output : [];
}
