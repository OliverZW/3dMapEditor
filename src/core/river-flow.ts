import type { Point, River } from './types';
import { riverCurve } from './terrain';

function direction(a: Point, b: Point): Point {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  return length > 1e-8 ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length } : { x: 0, z: 0 };
}

/** 控制点先后顺序只定义视觉流向，不推断高程或真实水文；采样结果不写回河流。 */
export function createRiverFlowSampler(rivers: River[]) {
  const curves = [...rivers]
    .sort((a, b) => a.id - b.id)
    .map((river) => {
      const points = riverCurve(river);
      const tangents = points.map((_, i) =>
        direction(points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)]),
      );
      return { river, points, tangents };
    });
  return (point: Point, waterLevel: number): Point => {
    let x = 0,
      z = 0,
      totalWeight = 0;
    for (const { river, points, tangents } of curves) {
      if (river.waterLevel !== waterLevel) continue;
      let nearest = Infinity,
        flowX = 0,
        flowZ = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const dx = b.x - a.x,
          dz = b.z - a.z,
          squared = dx * dx + dz * dz;
        if (squared < 1e-12) continue;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / squared));
        const distance = Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
        if (distance < nearest) {
          nearest = distance;
          flowX = tangents[i - 1].x * (1 - t) + tangents[i].x * t;
          flowZ = tangents[i - 1].z * (1 - t) + tangents[i].z * t;
        }
      }
      const fade = Math.max(0, Math.min(1, (nearest - river.width * 0.5) / river.width));
      const weight = (1 - fade * fade * (3 - 2 * fade)) * river.width;
      if (!weight) continue;
      x += flowX * weight;
      z += flowZ * weight;
      totalWeight += weight;
    }
    // 对向水流允许平滑降速至0，不能归一化成跳变方向。
    return totalWeight ? { x: x / totalWeight, z: z / totalWeight } : { x: 0, z: 0 };
  };
}
