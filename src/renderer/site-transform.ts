import * as THREE from 'three';
import type { Hex, MapDocument, ModelAsset } from '../core/types';
import { hexWorld } from '../core/hex';
import { sampleHeight } from '../core/terrain';
export function placeSiteModel(
  model: THREE.Object3D,
  doc: MapDocument,
  heights: Float32Array,
  asset: ModelAsset,
  center: Hex,
  yaw: number,
  scale: number,
) {
  const point = hexWorld(doc.grid, center);
  model.position.set(
    point.x,
    sampleHeight(doc, heights, point.x, point.z) + asset.offset * scale,
    point.z,
  );
  model.rotation.y = yaw + asset.yaw;
  model.scale.setScalar(scale * asset.scale);
}
