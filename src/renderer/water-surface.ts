import * as THREE from 'three';
import type { MapDocument } from '../core/types';
import { riverWaterMeshes } from '../core/river-water';
import { sampleHeight } from '../core/terrain';
import { WaterMaterial } from './water-material';
import { createRiverFlowSampler } from '../core/river-flow';

/** 水面几何和水深均为显示派生结果；原始河流与高度数组只读。 */
export class WaterSurface {
  readonly group = new THREE.Group();
  private waterMaterial: WaterMaterial;
  private materialKey = '';

  constructor(
    private onError: (message: string) => void,
    private anisotropy = 4,
    private changed: () => void = () => {},
    private rendered: () => void = () => {},
  ) {
    this.group.name = 'RiverWaterSurfaces';
    this.waterMaterial = new WaterMaterial(onError, undefined, anisotropy, changed);
  }

  rebuild(doc: MapDocument, heights: Float32Array) {
    this.clear();
    const key = JSON.stringify(doc.waterMaterial, (key, value) =>
      key === 'bytes' ? undefined : value,
    );
    if (key !== this.materialKey) {
      this.waterMaterial.dispose();
      this.waterMaterial = new WaterMaterial(
        this.onError,
        doc.waterMaterial,
        this.anisotropy,
        this.changed,
      );
      this.materialKey = key;
    }
    const widths = new Map(doc.rivers.map((river) => [river.id, river.width]));
    const sampleFlow = createRiverFlowSampler(doc.rivers);
    const flowCache = new Map<string, [number, number]>();
    for (const mesh of riverWaterMeshes(doc.rivers, doc.settings, 4)) {
      if (!mesh.positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
      const flows = new Float32Array((mesh.positions.length / 3) * 2);
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i],
          level = mesh.positions[i + 1],
          z = mesh.positions[i + 2];
        const key = `${x.toFixed(5)}:${z.toFixed(5)}:${level}`;
        let flow = flowCache.get(key);
        if (!flow) {
          const value = sampleFlow({ x, z }, level);
          flow = [value.x, value.z];
          flowCache.set(key, flow);
        }
        flows.set(flow, (i / 3) * 2);
      }
      geometry.setAttribute('waterFlow', new THREE.BufferAttribute(flows, 2));
      const halfWidth = widths.get(mesh.riverId)! * 0.5;
      geometry.setAttribute(
        'shoreMeters',
        new THREE.Float32BufferAttribute(
          mesh.shoreDistances.map((d) => d * halfWidth),
          1,
        ),
      );
      geometry.setAttribute(
        'waterDepth',
        new THREE.Float32BufferAttribute(new Float32Array(mesh.positions.length / 3), 1),
      );
      geometry.computeVertexNormals();
      const object = new THREE.Mesh(geometry, this.waterMaterial.material);
      object.onBeforeRender = this.rendered;
      object.name = `RiverWater:${mesh.riverId}`;
      this.group.add(object);
    }
    this.updateDepth(doc, heights);
  }

  updateDepth(doc: MapDocument, heights: Float32Array) {
    for (const object of this.group.children) {
      if (!(object instanceof THREE.Mesh)) continue;
      const positions = object.geometry.getAttribute('position');
      const depth = object.geometry.getAttribute('waterDepth');
      for (let i = 0; i < positions.count; i++) {
        depth.setX(
          i,
          Math.max(
            0,
            positions.getY(i) - sampleHeight(doc, heights, positions.getX(i), positions.getZ(i)),
          ),
        );
      }
      depth.needsUpdate = true;
    }
  }

  setTime(seconds: number) {
    this.waterMaterial.time.value = seconds;
  }

  private clear() {
    for (const object of [...this.group.children]) {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      this.group.remove(object);
    }
  }

  dispose() {
    this.clear();
    this.waterMaterial.dispose();
  }
}
