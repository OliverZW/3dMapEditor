import * as THREE from 'three';
import type { MapDocument } from '../core/types';
import type { RenderBounds } from '../application/render-invalidation';

/** 连续地面只有一个网格；脏区只缩小计算和上传范围，不改变三角形。 */
export class TerrainGeometry extends THREE.BufferGeometry {
  readonly diagnostics = { updates: 0, vertices: 0, normals: 0, bytes: 0, updateMs: 0 };
  private settingsKey = '';

  update(doc: MapDocument, heights: Float32Array, bounds?: RenderBounds, incremental = true) {
    const started = performance.now();
    const { samples: n, width, depth, minHeight, maxHeight } = doc.settings;
    const key = [n, width, depth, minHeight, maxHeight].join(':');
    let positions = this.getAttribute('position') as THREE.BufferAttribute | undefined;
    let normals = this.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!positions || positions.count !== n * n) {
      this.dispose();
      positions = new THREE.BufferAttribute(new Float32Array(n * n * 3), 3);
      positions.setUsage(THREE.DynamicDrawUsage);
      positions.onUpload(() => positions!.clearUpdateRanges());
      this.setAttribute('position', positions);
      const indices = new Uint32Array((n - 1) * (n - 1) * 6);
      let offset = 0;
      for (let row = 0; row < n - 1; row++)
        for (let col = 0; col < n - 1; col++) {
          const a = row * n + col;
          indices.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], offset);
          offset += 6;
        }
      this.setIndex(new THREE.BufferAttribute(indices, 1));
      normals = undefined;
      bounds = undefined;
    }
    if (!normals || !incremental) {
      normals = new THREE.BufferAttribute(new Float32Array(n * n * 3), 3);
      normals.setUsage(THREE.DynamicDrawUsage);
      normals.onUpload(() => normals!.clearUpdateRanges());
      this.setAttribute('normal', normals);
      bounds = undefined;
    }
    if (key !== this.settingsKey || !incremental) bounds = undefined;
    this.settingsKey = key;
    const sample = (v: number, length: number) => (v / length + 0.5) * (n - 1);
    const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
    const x0 = bounds ? clamp(Math.floor(sample(bounds.minX, width))) : 0;
    const z0 = bounds ? clamp(Math.floor(sample(bounds.minZ, depth))) : 0;
    const x1 = bounds ? clamp(Math.ceil(sample(bounds.maxX, width))) : n - 1;
    const z1 = bounds ? clamp(Math.ceil(sample(bounds.maxZ, depth))) : n - 1;
    for (let row = z0; row <= z1; row++)
      for (let col = x0; col <= x1; col++) {
        const i = row * n + col;
        positions.setXYZ(
          i,
          (col / (n - 1) - 0.5) * width,
          heights[i],
          (row / (n - 1) - 0.5) * depth,
        );
      }
    const nx0 = clamp(x0 - 1),
      nz0 = clamp(z0 - 1);
    const nx1 = clamp(x1 + 1),
      nz1 = clamp(z1 + 1);
    const sx = width / (n - 1),
      sz = depth / (n - 1);
    for (let row = nz0; row <= nz1; row++)
      for (let col = nx0; col <= nx1; col++) {
        const dx =
          (heights[row * n + Math.min(n - 1, col + 1)] - heights[row * n + Math.max(0, col - 1)]) /
          (sx * (col === 0 || col === n - 1 ? 1 : 2));
        const dz =
          (heights[Math.min(n - 1, row + 1) * n + col] - heights[Math.max(0, row - 1) * n + col]) /
          (sz * (row === 0 || row === n - 1 ? 1 : 2));
        const length = Math.hypot(dx, 1, dz);
        normals.setXYZ(row * n + col, -dx / length, 1 / length, -dz / length);
      }
    // 范围累积到实际绘制后由 Three 清空，不能丢掉同一帧的前一次更新。
    const upload = (
      attribute: THREE.BufferAttribute,
      left: number,
      top: number,
      right: number,
      bottom: number,
    ) => {
      for (let row = top; row <= bottom; row++)
        attribute.addUpdateRange((row * n + left) * 3, (right - left + 1) * 3);
      attribute.needsUpdate = true;
      return (right - left + 1) * (bottom - top + 1);
    };
    const vertices = upload(positions, x0, z0, x1, z1);
    const normalCount = upload(normals, nx0, nz0, nx1, nz1);
    if (incremental) {
      // 已校验的高度上下限包含所有最终高度，避免局部抬高后被旧包围体裁掉。
      this.boundingBox = new THREE.Box3(
        new THREE.Vector3(-width / 2, minHeight, -depth / 2),
        new THREE.Vector3(width / 2, maxHeight, depth / 2),
      );
      this.boundingSphere = this.boundingBox.getBoundingSphere(new THREE.Sphere());
    } else {
      this.computeBoundingBox();
      this.computeBoundingSphere();
    }
    Object.assign(this.diagnostics, {
      updates: this.diagnostics.updates + 1,
      vertices,
      normals: normalCount,
      bytes: (vertices + normalCount) * 12,
      updateMs: performance.now() - started,
    });
  }
}
