import * as THREE from 'three';
import type { ModelAsset } from '../core/types';
import { builtinModelLods } from '../io/model-lods';
import type { ModelLevel } from '../io/model-lods';
import type { ModelLibrary } from './models';
import { modelLevel, modelPixelDiameter } from './model-lod';
import type { ModelRenderCounter } from './model-render-counter';

export interface ModelInstance {
  id: number;
  matrix: THREE.Matrix4;
}
interface Instance extends ModelInstance {
  sphere: THREE.Sphere;
  cullSphere: THREE.Sphere;
  level?: ModelLevel;
  visible: boolean;
}
interface Part {
  mesh: THREE.InstancedMesh;
  matrix: THREE.Matrix4;
}
interface AssetBatch {
  asset: ModelAsset;
  instances: Instance[];
  levels: Map<ModelLevel, Part[]>;
  pending: Set<ModelLevel>;
  cells: Map<string, { bounds: THREE.Box3; instances: Instance[] }>;
  shadows: Part[];
  bounds: THREE.Box3;
  slots: Map<ModelLevel, Instance[]>;
}

/** 显示矩阵是文档的派生缓存；槽位从不作为对象身份。 */
export class ModelBatches {
  readonly group = new THREE.Group();
  readonly diagnostics = {
    rebuilds: 0,
    uploads: 0,
    uploadBytes: 0,
    updateMs: 0,
    visible: 0,
    triangles: 0,
  };
  private assets: AssetBatch[] = [];
  private generation = 0;
  private disposed = false;
  private viewKey = '';
  private scratch = new THREE.Matrix4();
  constructor(
    private library: Pick<ModelLibrary, 'get'> & Partial<Pick<ModelLibrary, 'getForRendering'>>,
    private name: 'TreeBatch' | 'SiteBatch',
    private original: boolean,
    private changed: () => void,
    private error: (error: unknown) => void,
    private renderCounter?: ModelRenderCounter,
    private performanceMode?: 'baseline' | 'candidate',
  ) {}

  private get(asset: ModelAsset, level: ModelLevel = 0) {
    return this.performanceMode === 'candidate' && this.library.getForRendering
      ? this.library.getForRendering(asset, level)
      : this.library.get(asset, level);
  }

  async rebuild(input: { asset: ModelAsset; instances: ModelInstance[] }[]) {
    const generation = ++this.generation;
    const next: AssetBatch[] = [];
    const started = performance.now();
    try {
      for (const { asset, instances } of input) {
        if (!instances.length) continue;
        const source = await this.get(asset);
        if (this.disposed || generation !== this.generation) return;
        const sourceBounds = new THREE.Box3().setFromObject(source);
        const bounds = sourceBounds.getBoundingSphere(new THREE.Sphere());
        const batch: AssetBatch = {
          asset,
          instances: instances.map((item) => ({
            ...item,
            sphere: bounds.clone().applyMatrix4(item.matrix),
            cullSphere: bounds.clone().applyMatrix4(item.matrix),
            visible: false,
          })),
          levels: new Map(),
          pending: new Set(),
          cells: new Map(),
          shadows: [],
          bounds: sourceBounds,
          slots: new Map(),
        };
        next.push(batch);
        batch.levels.set(0, this.parts(source, instances.length));
        // 阴影独立于观察相机；低精度模型的屏幕层级变化不使阴影失效。
        const shadowLevel = !this.original && builtinModelLods(asset) ? 2 : 0;
        let shadowSource = source;
        if (shadowLevel) {
          try {
            shadowSource = await this.get(asset, shadowLevel);
          } catch (error) {
            this.error(error);
          }
          if (this.disposed || generation !== this.generation) return;
          if (shadowSource !== source)
            batch.levels.set(shadowLevel, this.parts(shadowSource, instances.length));
        }
        batch.shadows = this.parts(shadowSource, instances.length, false);
        this.index(batch, shadowSource);
        for (const part of batch.shadows) {
          const mesh = part.mesh;
          mesh.name = this.name + 'Shadow';
          mesh.castShadow = true;
          mesh.visible = true;
          mesh.receiveShadow = false;
          mesh.frustumCulled = false;
          instances.forEach((instance, index) =>
            mesh.setMatrixAt(index, this.scratch.multiplyMatrices(instance.matrix, part.matrix)),
          );
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.count = 0;
          // Three 的阴影钩子与颜色钩子分别调用：仅阴影通道提交这些实例。
          mesh.onBeforeShadow = () => {
            mesh.count = instances.length;
          };
          mesh.onBeforeRender = () => {
            mesh.count = 0;
          };
        }
      }
      if (this.disposed || generation !== this.generation) return;
      this.clear();
      this.assets = [...next];
      for (const batch of next)
        for (const part of [...batch.levels.values()].flat().concat(batch.shadows))
          this.group.add(part.mesh);
      next.length = 0;
      this.viewKey = '';
      this.diagnostics.rebuilds++;
      this.diagnostics.updateMs = performance.now() - started;
      this.changed();
    } finally {
      for (const batch of next) this.release(batch);
    }
  }
  private cellKey(point: THREE.Vector3) {
    return `${Math.floor(point.x / 128)}:${Math.floor(point.z / 128)}`;
  }
  private index(batch: AssetBatch, model: THREE.Group) {
    // 面积补偿后的叶片可能略超原轮廓；裁剪包含所有已就绪层级，分档仍用原尺寸。
    batch.bounds.union(new THREE.Box3().setFromObject(model));
    const sphere = batch.bounds.getBoundingSphere(new THREE.Sphere());
    batch.cells.clear();
    for (const instance of batch.instances) {
      instance.cullSphere.copy(sphere).applyMatrix4(instance.matrix);
      const key = this.cellKey(instance.sphere.center);
      let cell = batch.cells.get(key);
      if (!cell) {
        cell = { bounds: new THREE.Box3(), instances: [] };
        batch.cells.set(key, cell);
      }
      cell.instances.push(instance);
      cell.bounds.union(instance.cullSphere.getBoundingBox(new THREE.Box3()));
    }
  }
  private parts(source: THREE.Group, capacity: number, countRender = true): Part[] {
    const parts: Part[] = [];
    source.updateMatrixWorld(true);
    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(object.geometry, object.material, capacity);
      mesh.name = this.name;
      // 叶冠的新材质 ID 不能把原本后绘制的树干移到叶片之前。
      if (this.performanceMode === 'candidate')
        mesh.renderOrder =
          object.userData.renderMaterialId ??
          (Array.isArray(object.material) ? 0 : object.material.id);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      if (countRender) this.renderCounter?.track(mesh);
      parts.push({ mesh, matrix: object.matrixWorld.clone() });
    });
    return parts;
  }
  update(camera: THREE.Camera, height: number, selected: number | null) {
    if (!this.group.visible) return;
    camera.updateMatrixWorld(true);
    const key = [
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
      height,
      selected,
    ].join(',');
    if (key === this.viewKey) return;
    this.viewKey = key;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      this.scratch.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    let visible = 0,
      triangles = 0;
    let uploaded = false;
    for (const batch of this.assets) {
      const byLevel: Instance[][] = [[], [], []];
      for (const cell of batch.cells.values()) {
        const cellVisible = frustum.intersectsBox(cell.bounds);
        for (const instance of cell.instances) {
          instance.visible = cellVisible && frustum.intersectsSphere(instance.cullSphere);
          if (!instance.visible) continue;
          let level: ModelLevel =
            this.original || !builtinModelLods(batch.asset) || selected === instance.id
              ? 0
              : modelLevel(modelPixelDiameter(instance.sphere, camera, height), instance.level);
          instance.level = level;
          if (!batch.levels.has(level)) {
            this.requestLevel(batch, level);
            level = batch.levels.has(2) ? 2 : 0;
          }
          byLevel[level].push(instance);
          visible++;
        }
      }
      for (const [level, parts] of batch.levels) {
        const instances = byLevel[level];
        const previous = batch.slots.get(level);
        const changed =
          this.performanceMode === 'baseline' ||
          !previous ||
          previous.length !== instances.length ||
          instances.some((instance, index) => instance !== previous[index]);
        if (changed) batch.slots.set(level, instances);
        const ids = changed ? instances.map((instance) => instance.id) : undefined;
        for (const part of parts) {
          const mesh = part.mesh;
          mesh.count = instances.length;
          mesh.visible = instances.length > 0;
          if (ids) mesh.userData.treeIds = ids;
          mesh.userData.modelLevel = level;
          if (changed && instances.length) {
            instances.forEach((instance, index) =>
              mesh.setMatrixAt(index, this.scratch.multiplyMatrices(instance.matrix, part.matrix)),
            );
            mesh.instanceMatrix.clearUpdateRanges();
            if (this.performanceMode !== 'baseline')
              mesh.instanceMatrix.addUpdateRange(0, instances.length * 16);
            mesh.instanceMatrix.needsUpdate = true;
            this.diagnostics.uploadBytes +=
              (this.performanceMode === 'baseline' ? mesh.instanceMatrix.count : instances.length) *
              64;
            uploaded = true;
          }
          triangles +=
            ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3) *
            instances.length;
        }
      }
    }
    if (uploaded) this.diagnostics.uploads++;
    this.diagnostics.visible = visible;
    this.diagnostics.triangles = triangles;
  }
  private requestLevel(batch: AssetBatch, level: ModelLevel) {
    if (batch.pending.has(level)) return;
    batch.pending.add(level);
    void this.get(batch.asset, level).then(
      (source) => {
        if (this.disposed || !this.assets.includes(batch)) return;
        const parts = this.parts(source, batch.instances.length);
        batch.levels.set(level, parts);
        this.index(batch, source);
        for (const part of parts) this.group.add(part.mesh);
        this.viewKey = '';
      },
      (error) => {
        if (!this.disposed && this.assets.includes(batch)) this.error(error);
      },
    );
  }
  pick(raycaster: THREE.Raycaster, maximumDistance: number): number | null {
    if (!this.group.visible) return null;
    let closest = maximumDistance + 0.05,
      id: number | null = null;
    const probe = new THREE.Mesh();
    const hits: THREE.Intersection[] = [];
    for (const batch of this.assets)
      for (const cell of batch.cells.values()) {
        if (!raycaster.ray.intersectsBox(cell.bounds)) continue;
        for (const instance of cell.instances) {
          if (!instance.visible || !raycaster.ray.intersectsSphere(instance.cullSphere)) continue;
          const requested = instance.level ?? 0;
          const parts =
            batch.levels.get(requested) ?? batch.levels.get(batch.levels.has(2) ? 2 : 0)!;
          for (const part of parts) {
            probe.geometry = part.mesh.geometry;
            probe.material = part.mesh.material;
            probe.matrixWorld.multiplyMatrices(instance.matrix, part.matrix);
            hits.length = 0;
            probe.raycast(raycaster, hits);
            for (const hit of hits)
              if (hit.distance < closest) {
                closest = hit.distance;
                id = instance.id;
              }
          }
        }
      }
    return id;
  }
  invalidate() {
    this.generation++;
  }
  private release(batch: AssetBatch) {
    for (const part of [...batch.levels.values()].flat().concat(batch.shadows)) {
      part.mesh.removeFromParent();
      part.mesh.dispose();
    }
  }
  private clear() {
    this.assets.forEach((batch) => this.release(batch));
    this.assets = [];
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
    this.clear();
  }
}
