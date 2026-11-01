import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/** 几何可频繁替换，材质由视口持有，避免最后一个引用释放后反复编译程序。 */
export class LogicMaterials {
  readonly fill = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.21,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  readonly grid = new LineMaterial({
    color: 0x36575e,
    linewidth: 1.25,
    worldUnits: false,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  readonly boundary = new LineMaterial({
    color: 0x6cbafa,
    linewidth: 2,
    worldUnits: false,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  dispose() {
    this.fill.dispose();
    this.grid.dispose();
    this.boundary.dispose();
  }
}
