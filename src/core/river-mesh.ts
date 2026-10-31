import type { MapSettings, Point, River } from './types';
import { riverCurve } from './terrain';
import { clipPolygon } from './map-bounds';
/** 渲染与导出共用裁切水面，边界节点不会产生伸出地图的三角形。 */
export function riverMesh(river: River, bounds: Pick<MapSettings, 'width' | 'depth'>) {
  const curve = riverCurve(river),
    banks: (Point & { u: number; v: number })[] = [];
  const positions: number[] = [],
    uvs: number[] = [];
  let length = 0;
  curve.forEach((point, i) => {
    if (i) length += Math.hypot(point.x - curve[i - 1].x, point.z - curve[i - 1].z);
    const a = curve[Math.max(0, i - 1)],
      b = curve[Math.min(curve.length - 1, i + 1)];
    const dx = b.x - a.x,
      dz = b.z - a.z,
      size = Math.hypot(dx, dz) || 1;
    for (const side of [-1, 1])
      banks.push({
        x: point.x - (dz / size) * river.width * 0.5 * side,
        z: point.z + (dx / size) * river.width * 0.5 * side,
        u: side === -1 ? 0 : 1,
        v: length / river.width,
      });
  });
  function triangle(
    a: (typeof banks)[number],
    b: (typeof banks)[number],
    c: (typeof banks)[number],
  ) {
    const polygon = clipPolygon(bounds, [a, b, c]);
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-10) return;
    function append(p: Point) {
      const u = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / det;
      const v = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / det;
      positions.push(p.x, river.waterLevel, p.z);
      uvs.push(u * a.u + v * b.u + (1 - u - v) * c.u, u * a.v + v * b.v + (1 - u - v) * c.v);
    }
    for (let i = 1; i + 1 < polygon.length; i++) {
      append(polygon[0]);
      append(polygon[i]);
      append(polygon[i + 1]);
    }
  }
  for (let i = 0; i + 3 < banks.length; i += 2) {
    triangle(banks[i], banks[i + 2], banks[i + 1]);
    triangle(banks[i + 1], banks[i + 2], banks[i + 3]);
  }
  return { positions, uvs };
}
