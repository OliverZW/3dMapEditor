import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetKind, ModelAsset } from '../core/types';
import { builtinResourceBytes } from '../io/builtin-resources';
import { validateStaticGlb } from '../io/glb-validation';
import { builtinModelLods, loadModelLod } from '../io/model-lods';
import type { ModelLevel } from '../io/model-lods';
import { mergeBuiltinModel } from './model-merge';
function disposeModel(root: THREE.Object3D, includeGeometry = true) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (includeGeometry) geometries.add(object.geometry);
    for (const material of root.userData.sharedMaterials
      ? []
      : Array.isArray(object.material)
        ? object.material
        : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const owned = root.userData.ownedMaterials as THREE.Material[] | undefined;
  owned?.forEach((material) => material.dispose());
  const images = new Set<unknown>();
  textures.forEach((texture) => {
    images.add(texture.image);
    texture.dispose();
  });
  for (const image of images) {
    if (image && typeof image === 'object' && 'close' in image && typeof image.close === 'function')
      image.close();
  }
}
export class ModelLibrary {
  private cache = new Map<string, Promise<THREE.Group>>();
  private renderCache = new Map<string, Promise<THREE.Group>>();
  private disposed = false;
  async get(asset: ModelAsset, level: ModelLevel = 0): Promise<THREE.Group> {
    if (this.disposed) throw new Error('模型资源库已释放');
    if (!builtinModelLods(asset)) level = 0;
    const key = asset.id + ':' + asset.hash + ':' + level;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.load(asset, level);
      this.cache.set(key, pending);
      void pending.catch(() => {
        if (this.cache.get(key) === pending) this.cache.delete(key);
      });
    }
    return pending;
  }
  getForRendering(asset: ModelAsset, level: ModelLevel = 0): Promise<THREE.Group> {
    if (!builtinModelLods(asset)) return this.get(asset, level);
    const key = asset.id + ':' + asset.hash + ':' + level;
    let pending = this.renderCache.get(key);
    if (!pending) {
      pending = this.get(asset, level).then((source) => {
        const merged = mergeBuiltinModel(source, asset);
        if (this.disposed) {
          disposeModel(merged);
          throw new Error('模型资源库已释放');
        }
        return merged;
      });
      this.renderCache.set(key, pending);
      void pending.catch(() => {
        if (this.renderCache.get(key) === pending) this.renderCache.delete(key);
      });
    }
    return pending;
  }
  private async load(asset: ModelAsset, level: ModelLevel): Promise<THREE.Group> {
    const source = level ? await this.get(asset) : undefined;
    if (!level && asset.resource?.origin === 'project' && !asset.bytes)
      throw new Error(`工程模型 ${asset.name} 缺少 GLB 数据`);
    const bytes = level
      ? await loadModelLod(asset, level)
      : (asset.bytes ?? builtinResourceBytes(asset.hash));
    let group: THREE.Group;
    try {
      group = (await new GLTFLoader().parseAsync(bytes.slice().buffer, '')).scene;
    } catch (error) {
      throw new Error(`模型 ${asset.name} GLB 解析失败：${String(error)}`);
    }
    if (source) {
      const shared = new Map<string, THREE.Material>();
      source.traverse((object) => {
        if (object instanceof THREE.Mesh)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            shared.set(material.name, material);
      });
      // GLTFLoader 创建的重复贴图不进入缓存，几何归各层级、材质归原模型。
      disposeModel(group, false);
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const replace = (material: THREE.Material) => shared.get(material.name)!;
          object.material = Array.isArray(object.material)
            ? object.material.map(replace)
            : replace(object.material);
        }
      });
      group.userData.sharedMaterials = true;
    }
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = asset.kind !== 'grass';
        object.receiveShadow = true;
      }
    });
    if (asset.kind === 'city' || asset.kind === 'fortress') {
      const visual = group,
        center = source
          ? source.children[0].position.clone().negate()
          : new THREE.Box3().setFromObject(visual).getCenter(new THREE.Vector3()),
        anchor = new THREE.Group();
      visual.position.x -= center.x;
      visual.position.z -= center.z;
      anchor.add(visual);
      anchor.userData.sharedMaterials = !!source;
      group = anchor;
    }
    group.updateMatrixWorld(true);
    if (this.disposed) {
      disposeModel(group);
      throw new Error('模型资源库已释放');
    }
    return group;
  }
  retainAssets(assets: ModelAsset[]) {
    const active = new Set(
      assets.flatMap((asset) =>
        [0, 1, 2].map((level) => asset.id + ':' + asset.hash + ':' + level),
      ),
    );
    for (const cache of [this.renderCache, this.cache])
      for (const [key, pending] of cache)
        if (!active.has(key)) {
          cache.delete(key);
          void pending.then(
            (model) => disposeModel(model),
            () => {},
          );
        }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cache of [this.renderCache, this.cache]) {
      for (const pending of cache.values())
        void pending.then(
          (model) => disposeModel(model),
          () => {},
        );
      cache.clear();
    }
  }
}
export async function importGlb(file: File, kind: AssetKind): Promise<ModelAsset> {
  if (file.size > 32 * 1024 * 1024) throw new Error('模型超过 32 MiB 限制');
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateStaticGlb(bytes);
  const scene = (await new GLTFLoader().parseAsync(bytes.slice().buffer, '')).scene;
  try {
    const bounds = new THREE.Box3().setFromObject(scene),
      size = bounds.getSize(new THREE.Vector3());
    let triangles = 0;
    const materials = new Set<THREE.Material>();
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        triangles += (obj.geometry.index?.count ?? obj.geometry.attributes.position.count) / 3;
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          materials.add(m);
          for (const v of Object.values(m))
            if (
              v instanceof THREE.Texture &&
              v.image &&
              (v.image.width > 4096 || v.image.height > 4096)
            )
              throw new Error('纹理尺寸超过 4096');
        }
      }
    });
    if (!triangles || !Number.isFinite(size.length()) || size.length() <= 0)
      throw new Error('模型没有有效可见网格');
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    return {
      id: `asset-${crypto.randomUUID()}`,
      name: file.name.replace(/\.glb$/i, ''),
      kind,
      hash,
      resource: { origin: 'project', path: `assets/models/${hash}.glb` },
      bytes,
      size: [size.x, size.y, size.z],
      triangles: Math.round(triangles),
      materials: materials.size,
      scale: 1,
      yaw: 0,
      offset: -bounds.min.y,
      source: '用户导入 · 请确认素材使用许可',
    };
  } finally {
    disposeModel(scene);
  }
}
