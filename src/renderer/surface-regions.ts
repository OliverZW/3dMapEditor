import * as THREE from 'three';
import type { MapDocument } from '../core/types';
import type { RenderBounds } from '../application/render-invalidation';

const REGION_CELLS = 32;

/** 最近邻的保守占用表；边缘多读一圈，覆盖权重的双线性插值足迹。 */
export class SurfaceRegions {
  size = 1;
  texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  private samples = 0;
  update(doc: MapDocument, bounds?: RenderBounds) {
    const n = doc.settings.samples;
    if (n !== this.samples) {
      this.texture.dispose();
      this.samples = n;
      this.size = Math.ceil((n - 1) / REGION_CELLS);
      this.texture = new THREE.DataTexture(
        new Uint8Array(this.size * this.size * 4),
        this.size,
        this.size,
      );
      this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
      this.texture.generateMipmaps = false;
      bounds = undefined;
    }
    const data = this.texture.image.data as Uint8Array;
    const range = (v: number, length: number) =>
      Math.max(
        0,
        Math.min(this.size - 1, Math.floor(((v / length + 0.5) * (n - 1)) / REGION_CELLS)),
      );
    const x0 = bounds ? range(bounds.minX - doc.settings.width / (n - 1), doc.settings.width) : 0;
    const z0 = bounds ? range(bounds.minZ - doc.settings.depth / (n - 1), doc.settings.depth) : 0;
    const x1 = bounds
      ? range(bounds.maxX + doc.settings.width / (n - 1), doc.settings.width)
      : this.size - 1;
    const z1 = bounds
      ? range(bounds.maxZ + doc.settings.depth / (n - 1), doc.settings.depth)
      : this.size - 1;
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const offset = (z * this.size + x) * 4;
        data.fill(0, offset, offset + 4);
        for (
          let row = Math.max(0, z * REGION_CELLS - 1);
          row <= Math.min(n - 1, (z + 1) * REGION_CELLS + 1);
          row++
        )
          for (
            let col = Math.max(0, x * REGION_CELLS - 1);
            col <= Math.min(n - 1, (x + 1) * REGION_CELLS + 1);
            col++
          )
            for (let layer = 0; layer < 4; layer++)
              if (doc.surface[(row * n + col) * 4 + layer] !== 0) data[offset + layer] = 255;
      }
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}
