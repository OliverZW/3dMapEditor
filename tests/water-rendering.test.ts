import { describe, expect, it } from 'vitest';
import { riverWaterMeshes } from '../src/core/river-water';
import type { River } from '../src/core/types';
import { createRiverFlowSampler } from '../src/core/river-flow';

const bounds = { width: 128, depth: 96 };
const rivers: River[] = [
  {
    id: 1,
    name: '主河',
    width: 24,
    depth: 6,
    waterLevel: 24,
    interpolation: 'linear',
    points: [
      { x: -64, z: 0 },
      { x: 64, z: 0 },
    ],
  },
  {
    id: 2,
    name: '支流',
    width: 12,
    depth: 3,
    waterLevel: 24,
    interpolation: 'linear',
    points: [
      { x: 0, z: -48 },
      { x: 0, z: 0 },
    ],
  },
];
function area(meshes: ReturnType<typeof riverWaterMeshes>) {
  let result = 0;
  for (const { positions: p } of meshes)
    for (let i = 0; i < p.length; i += 9)
      result +=
        Math.abs(
          (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 6] - p[i]) * (p[i + 5] - p[i + 2]),
        ) / 2;
  return result;
}
describe('水面显示细分', () => {
  it('细分保持交汇去重面积、原始河道与默认导出几何，最长边不超过4米', () => {
    const before = structuredClone(rivers);
    const original = riverWaterMeshes(rivers, bounds);
    const refined = riverWaterMeshes(rivers, bounds, 4);
    expect(area(refined)).toBeCloseTo(area(original), 7);
    for (const { positions: p } of refined) {
      for (let i = 0; i < p.length; i += 9) {
        for (let j = 0; j < 3; j++) {
          const a = i + j * 3,
            b = i + ((j + 1) % 3) * 3;
          expect(Math.hypot(p[a] - p[b], p[a + 2] - p[b + 2])).toBeLessThanOrEqual(4.000001);
          expect(p[a + 1]).toBe(24);
        }
      }
    }
    expect(rivers).toEqual(before);
    expect(riverWaterMeshes(rivers, bounds)).toEqual(original);
  });
  it('交汇中心不会因为细分生成内部岸线，拒绝无效细分长度', () => {
    const meshes = riverWaterMeshes(rivers, bounds, 4);
    let checked = 0;
    for (const mesh of meshes)
      for (let i = 0; i < mesh.shoreDistances.length; i++) {
        const x = mesh.positions[i * 3],
          z = mesh.positions[i * 3 + 2];
        if (Math.hypot(x, z) < 1) {
          expect(mesh.shoreDistances[i]).toBeGreaterThan(0.5);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(0);
    expect(() => riverWaterMeshes(rivers, bounds, 0)).toThrow('细分');
  });
});

describe('派生视觉流向', () => {
  it('沿控制点顺序流动，反转顺序会反转流向，原始数据保持不变', () => {
    const before = structuredClone(rivers);
    const sample = createRiverFlowSampler([rivers[0]]);
    const reverse = createRiverFlowSampler([
      { ...rivers[0], points: [...rivers[0].points].reverse() },
    ]);
    expect(sample({ x: -30, z: 0 }, 24)).toEqual({ x: 1, z: 0 });
    expect(reverse({ x: -30, z: 0 }, 24)).toEqual({ x: -1, z: 0 });
    expect(rivers).toEqual(before);
  });
  it('交汇处按河宽平滑混合，采样与河流排列和所属水面无关', () => {
    const sample = createRiverFlowSampler(rivers);
    const reordered = createRiverFlowSampler([...rivers].reverse());
    const center = sample({ x: 0, z: 0 }, 24);
    expect(center.x).toBeCloseTo(2 / 3);
    expect(center.z).toBeCloseTo(1 / 3);
    expect(reordered({ x: 0, z: 0 }, 24)).toEqual(center);
    const a = sample({ x: 5.99, z: -2 }, 24),
      b = sample({ x: 6.01, z: -2 }, 24);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.01);
    expect(sample({ x: 0, z: 0 }, 26)).toEqual({ x: 0, z: 0 });
  });
  it('对向流平滑停滞，零长段不产生NaN，不受其他水位河流干扰', () => {
    const reversed = { ...rivers[0], id: 3, points: [...rivers[0].points].reverse() };
    const opposing = createRiverFlowSampler([rivers[0], reversed]);
    expect(opposing({ x: 0, z: 0 }, 24)).toEqual({ x: 0, z: 0 });
    const duplicate = { ...rivers[0], points: [rivers[0].points[0], ...rivers[0].points] };
    const flow = createRiverFlowSampler([duplicate, { ...reversed, waterLevel: 28 }])(
      { x: 0, z: 0 },
      24,
    );
    expect(flow.x).toBeCloseTo(1);
    expect(flow.z).toBe(0);
  });
});
