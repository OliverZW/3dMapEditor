import type { MapSettings, Point, River } from './types';
import { riverMesh } from './river-mesh';
import { segmentDistance } from './terrain';

type Bounds = Pick<MapSettings, 'width' | 'depth'>;
interface Vertex extends Point {
  u: number;
  v: number;
}
type Triangle = [Vertex, Vertex, Vertex];
interface Footprint {
  river: River;
  triangles: Triangle[];
}
const epsilon = 1e-8;
const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
function interpolate(a: Vertex, b: Vertex, t: number): Vertex {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    u: a.u + (b.u - a.u) * t,
    v: a.v + (b.v - a.v) * t,
  };
}
function footprint(river: River, bounds: Bounds): Footprint {
  const mesh = riverMesh(river, bounds),
    triangles: Triangle[] = [];
  for (let i = 0; i < mesh.positions.length; i += 9) {
    const vertices = [0, 1, 2].map((j) => ({
      x: mesh.positions[i + j * 3],
      z: mesh.positions[i + j * 3 + 2],
      u: mesh.uvs[(i / 3 + j) * 2],
      v: mesh.uvs[(i / 3 + j) * 2 + 1],
    }));
    if (Math.abs(cross(vertices[0], vertices[1], vertices[2])) > epsilon)
      triangles.push(vertices as Triangle);
  }
  return { river, triangles };
}
function boxesOverlap(a: Point[], b: Point[]) {
  return (
    Math.min(...a.map((p) => p.x)) <= Math.max(...b.map((p) => p.x)) + epsilon &&
    Math.min(...b.map((p) => p.x)) <= Math.max(...a.map((p) => p.x)) + epsilon &&
    Math.min(...a.map((p) => p.z)) <= Math.max(...b.map((p) => p.z)) + epsilon &&
    Math.min(...b.map((p) => p.z)) <= Math.max(...a.map((p) => p.z)) + epsilon
  );
}
function triangleContact(a: Triangle, b: Triangle) {
  if (!boxesOverlap(a, b)) return false;
  for (const polygon of [a, b]) {
    for (let i = 0; i < 3; i++) {
      const start = polygon[i],
        end = polygon[(i + 1) % 3];
      const project = (p: Point) => cross(start, end, p);
      const x = a.map(project),
        y = b.map(project);
      if (Math.max(...x) < Math.min(...y) - epsilon || Math.max(...y) < Math.min(...x) - epsilon)
        return false;
    }
  }
  return true;
}
/** 候选替换旧河道后按真实水面连通，水位不参与平面接触判断。 */
export function riverConfluence(rivers: River[], candidate: River, bounds: Bounds): River[] {
  const all = [...rivers.filter((r) => r.id !== candidate.id), candidate].map((r) =>
    footprint(r, bounds),
  );
  const connected = new Set<Footprint>([all[all.length - 1]]);
  const queue = [...connected];
  for (const current of queue) {
    for (const other of all) {
      if (connected.has(other)) continue;
      if (current.triangles.some((a) => other.triangles.some((b) => triangleContact(a, b)))) {
        connected.add(other);
        queue.push(other);
      }
    }
  }
  return [...connected].map((item) => item.river);
}
/** 半平面裁切同时插值 UV；相邻面共用同一交点公式。 */
function halfPlane(polygon: Vertex[], a: Point, b: Point, sign: number): Vertex[] {
  const result: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length];
    const dp = cross(a, b, p) * sign,
      dq = cross(a, b, q) * sign;
    const inside = dp >= 0,
      nextInside = dq >= 0;
    if (inside) result.push(p);
    if (inside !== nextInside) result.push(interpolate(p, q, dp / (dp - dq)));
  }
  return result;
}
function subtract(polygon: Vertex[], triangle: Triangle): Vertex[][] {
  if (!boxesOverlap(polygon, triangle)) return [polygon];
  const sign = Math.sign(cross(...triangle));
  let inside = polygon;
  const outside: Vertex[][] = [];
  for (let i = 0; i < 3 && inside.length; i++) {
    const a = triangle[i],
      b = triangle[(i + 1) % 3];
    const part = halfPlane(inside, a, b, -sign);
    if (part.length >= 3) outside.push(part);
    inside = halfPlane(inside, a, b, sign);
  }
  return outside;
}
/** 河岸线段只保留未被其他水面覆盖的部分，交汇内部不生成亮边。 */
function exposedBanks(item: Footprint, others: Footprint[]): [Point, Point][] {
  const banks: [Point, Point][] = [];
  const covers = others.flatMap((other) => other.triangles);
  for (const triangle of item.triangles) {
    for (let i = 0; i < 3; i++) {
      const a = triangle[i],
        b = triangle[(i + 1) % 3];
      if (
        !(Math.abs(a.u - b.u) < epsilon && (Math.abs(a.u) < epsilon || Math.abs(a.u - 1) < epsilon))
      )
        continue;
      // 用岸外侧判覆盖：重合河道的共同外岸应保留，相邻河道的共同内岸应消失。
      const dx = b.x - a.x,
        dz = b.z - a.z,
        length = Math.hypot(dx, dz);
      if (length < epsilon) continue;
      const offset = Math.max(1e-6, item.river.width * 1e-7) * Math.sign(cross(...triangle));
      const outsideA = { x: a.x + (dz / length) * offset, z: a.z - (dx / length) * offset };
      const outsideB = { x: b.x + (dz / length) * offset, z: b.z - (dx / length) * offset };
      let intervals: [number, number][] = [[0, 1]];
      for (const cover of covers) {
        if (!boxesOverlap([a, b], cover)) continue;
        const sign = Math.sign(cross(...cover));
        let lo = 0,
          hi = 1;
        for (let j = 0; j < 3; j++) {
          const p = cover[j],
            q = cover[(j + 1) % 3];
          const start = cross(p, q, outsideA) * sign,
            end = cross(p, q, outsideB) * sign;
          if (start < -epsilon && end < -epsilon) {
            hi = -1;
            break;
          }
          if (start < -epsilon) lo = Math.max(lo, start / (start - end));
          if (end < -epsilon) hi = Math.min(hi, start / (start - end));
        }
        if (lo >= hi - epsilon) continue;
        intervals = intervals.flatMap(([start, end]) => {
          if (hi <= start || lo >= end) return [[start, end] as [number, number]];
          const result: [number, number][] = [];
          if (lo > start + epsilon) result.push([start, lo]);
          if (hi < end - epsilon) result.push([hi, end]);
          return result;
        });
      }
      for (const [start, end] of intervals)
        banks.push([interpolate(a, b, start), interpolate(a, b, end)]);
    }
  }
  return banks;
}
/** 网页与导出共用：稳定 ID 决定覆盖区 UV，不改变河流身份或工程数据。 */
export function riverWaterMeshes(rivers: River[], bounds: Bounds, maxEdgeMeters = Infinity) {
  if (!(maxEdgeMeters > 0)) throw new Error('水面细分边长必须大于0');
  const all = [...rivers].sort((a, b) => a.id - b.id).map((r) => footprint(r, bounds));
  const banks = all.flatMap((item) =>
    exposedBanks(
      item,
      all.filter((other) => other !== item && other.river.waterLevel === item.river.waterLevel),
    ).map((segment) => ({ segment, level: item.river.waterLevel })),
  );
  return all.map((item, index) => {
    const positions: number[] = [],
      uvs: number[] = [],
      shoreDistances: number[] = [];
    const covers = all
      .slice(0, index)
      .filter((other) => other.river.waterLevel === item.river.waterLevel)
      .flatMap((other) => other.triangles);
    const shore = banks.filter((bank) => bank.level === item.river.waterLevel);
    function append(triangle: Triangle) {
      if (Math.abs(cross(...triangle)) < epsilon) return;
      const distances = triangle.map((p, i) =>
        Math.hypot(p.x - triangle[(i + 1) % 3].x, p.z - triangle[(i + 1) % 3].z),
      );
      const longest = Math.max(...distances),
        edge = distances.indexOf(longest);
      // 河带内部补点，避免仅有两岸顶点时整面被插值成岸边。
      if (longest > Math.min(item.river.width * 0.5, maxEdgeMeters)) {
        const a = triangle[edge],
          b = triangle[(edge + 1) % 3],
          c = triangle[(edge + 2) % 3];
        const middle = interpolate(a, b, 0.5);
        append([a, middle, c]);
        append([middle, b, c]);
        return;
      }
      for (const p of triangle) {
        positions.push(p.x, item.river.waterLevel, p.z);
        uvs.push(p.u, p.v);
        let distance = item.river.width * 0.5;
        for (const bank of shore)
          distance = Math.min(distance, segmentDistance(p, ...bank.segment));
        shoreDistances.push(distance / (item.river.width * 0.5));
      }
    }
    for (const triangle of item.triangles) {
      let polygons: Vertex[][] = [triangle];
      for (const cover of covers) {
        polygons = polygons.flatMap((polygon) => subtract(polygon, cover));
        if (!polygons.length) break;
      }
      for (const polygon of polygons)
        for (let i = 1; i + 1 < polygon.length; i++)
          append([polygon[0], polygon[i], polygon[i + 1]]);
    }
    return { riverId: item.river.id, positions, uvs, shoreDistances };
  });
}
