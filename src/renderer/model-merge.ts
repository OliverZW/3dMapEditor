import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ModelAsset } from '../core/types';

/** 只生成显示缓存；共享原材质，新增的顶点色材质由派生组独占。 */
export function mergeBuiltinModel(source: THREE.Group, asset: ModelAsset): THREE.Group {
  source.updateMatrixWorld(true);
  const result = new THREE.Group();
  result.userData.sharedMaterials = true;
  const owned: THREE.Material[] = [];
  result.userData.ownedMaterials = owned;
  const buckets = new Map<
    string,
    {
      material: THREE.Material | THREE.Material[];
      geometries: THREE.BufferGeometry[];
      matrix: THREE.Matrix4;
      order: number;
    }
  >();
  const foliage = ['tree-pine', 'tree-cypress', 'tree-maple', 'tree-willow'].includes(asset.id);
  let leafMaterial: THREE.MeshStandardMaterial | undefined;
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry: THREE.BufferGeometry = object.geometry.clone();
    // 保留原矩阵运算顺序；烘焙平移会使少量屋檐像素超过严格画质门槛。
    let material = object.material;
    if (
      foliage &&
      material instanceof THREE.MeshStandardMaterial &&
      !material.map &&
      !material.normalMap &&
      !material.roughnessMap &&
      !material.metalnessMap &&
      !geometry.getAttribute('color')
    ) {
      const color = new Float32Array(geometry.getAttribute('position').count * 3);
      for (let i = 0; i < color.length; i += 3) material.color.toArray(color, i);
      geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
      if (!leafMaterial) {
        leafMaterial = material.clone();
        leafMaterial.name = '内置叶冠 · 顶点色';
        leafMaterial.color.setRGB(1, 1, 1);
        leafMaterial.vertexColors = true;
        owned.push(leafMaterial);
      }
      material = leafMaterial;
    }
    // 不兼容的属性、索引格式或材质数组各自保留，不为凑批次删属性。
    const signature = [
      Array.isArray(material) ? material.map((m) => m.uuid).join(',') : material.uuid,
      !!geometry.index,
      object.matrixWorld.elements.join(','),
      Object.entries(geometry.attributes)
        .map(([name, attribute]) =>
          [name, attribute.itemSize, attribute.normalized, attribute.array.constructor.name].join(
            ':',
          ),
        )
        .sort()
        .join('|'),
    ].join('/');
    let bucket = buckets.get(signature);
    if (!bucket) {
      bucket = {
        material,
        geometries: [],
        matrix: object.matrixWorld.clone(),
        order: Array.isArray(object.material) ? 0 : object.material.id,
      };
      buckets.set(signature, bucket);
    }
    // 数组材质的 group 范围不能被无分组拼接覆盖。
    if (Array.isArray(material)) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrix.copy(object.matrixWorld);
      mesh.matrixAutoUpdate = false;
      result.add(mesh);
    } else bucket.geometries.push(geometry);
  });
  for (const { material, geometries, matrix, order } of buckets.values()) {
    if (!geometries.length) continue;
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    if (merged) {
      if (geometries.length > 1) geometries.forEach((geometry) => geometry.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.matrix.copy(matrix);
      mesh.matrixAutoUpdate = false;
      mesh.userData.renderMaterialId = order;
      result.add(mesh);
    } else
      for (const geometry of geometries) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.matrix.copy(matrix);
        mesh.matrixAutoUpdate = false;
        mesh.userData.renderMaterialId = order;
        result.add(mesh);
      }
  }
  result.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  result.updateMatrixWorld(true);
  return result;
}
