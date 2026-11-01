import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createDocument } from '../src/core/document';
import { builtinModelLods, loadModelLod } from '../src/io/model-lods';
import { modelLevel, modelPixelDiameter } from '../src/renderer/model-lod';
import { ModelBatches } from '../src/renderer/model-batches';

const asset = createDocument().assets.find((asset) => asset.id === 'tree-pine')!;
const camera = () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
};
const source = () => {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial()));
  return group;
};

describe('内置模型细节层级', () => {
  it('层级不进入文档；只对源内容匹配的内置模型启用，派生文件完整且哈希一致', () => {
    for (const model of createDocument().assets) {
      expect(model).not.toHaveProperty('lod');
      for (const entry of builtinModelLods(model) ?? []) {
        expect(entry.triangles).toBeGreaterThan(0);
        expect(entry.triangles).toBeLessThan(model.triangles);
      }
    }
    expect(builtinModelLods({ ...asset, hash: '0'.repeat(64) })).toBeUndefined();
    expect(builtinModelLods({ ...asset, id: 'custom-pine' })).toBeUndefined();
  });
  it('透视由深度决定、正交由缩放决定，近裁剪相交时保留原模型', () => {
    const perspective = camera(),
      sphere = new THREE.Sphere(new THREE.Vector3(), 5);
    const pixels = modelPixelDiameter(sphere, perspective, 1000);
    perspective.position.z = 500;
    perspective.updateMatrixWorld(true);
    expect(modelPixelDiameter(sphere, perspective, 1000)).toBeCloseTo(pixels * 2);
    perspective.position.z = 3;
    perspective.updateMatrixWorld(true);
    expect(modelPixelDiameter(sphere, perspective, 1000)).toBe(Infinity);
    const orthographic = new THREE.OrthographicCamera(-500, 500, 500, -500, 0.1, 10000);
    expect(modelPixelDiameter(sphere, orthographic, 1000)).toBe(10);
    orthographic.zoom = 3;
    expect(modelPixelDiameter(sphere, orthographic, 1000)).toBe(30);
  });
  it('96/24 像素分档与15%滞回避免阈值附近反复切换', () => {
    expect([100, 50, 20].map((pixels) => modelLevel(pixels))).toEqual([0, 1, 2]);
    expect(modelLevel(90, 0)).toBe(0);
    expect(modelLevel(90, 1)).toBe(1);
    expect(modelLevel(100, 1)).toBe(1);
    expect(modelLevel(111, 1)).toBe(0);
    expect(modelLevel(25, 2)).toBe(2);
    expect(modelLevel(28, 2)).toBe(1);
    expect(modelLevel(21, 1)).toBe(1);
    expect(modelLevel(20, 1)).toBe(2);
  });
  it('损坏的惰性 LOD 不发布字节，错误定位文件，并使用部署 base', async () => {
    vi.stubEnv('BASE_URL', '/editor/');
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(loadModelLod(asset, 2)).rejects.toThrow('内容哈希不符');
      expect(fetch).toHaveBeenCalledWith('/editor/' + builtinModelLods(asset)![1].file);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe('模型批次与稳定身份', () => {
  it('移动相机只更新可见槽位；选中强制原模型；拾取返回真实ID，地面遮挡有效', async () => {
    const get = vi.fn(async () => source());
    const batches = new ModelBatches({ get }, 'TreeBatch', false, vi.fn(), vi.fn());
    await batches.rebuild([
      {
        asset,
        instances: [
          { id: 71, matrix: new THREE.Matrix4() },
          { id: 93, matrix: new THREE.Matrix4().makeTranslation(5000, 0, 0) },
        ],
      },
    ]);
    const view = camera();
    batches.update(view, 1000, null);
    expect(batches.diagnostics.visible).toBe(1);
    expect(
      batches.group.children
        .filter((object) => object.userData.modelLevel === 2)
        .map((object) => object.userData.treeIds),
    ).toContainEqual([71]);
    const calls = get.mock.calls.length,
      rebuilds = batches.diagnostics.rebuilds;
    view.position.x += 2;
    view.updateMatrixWorld(true);
    batches.update(view, 1000, 71);
    expect(batches.diagnostics.rebuilds).toBe(rebuilds);
    expect(get.mock.calls.length).toBe(calls);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 1000), new THREE.Vector3(0, 0, -1));
    expect(batches.pick(ray, Infinity)).toBe(71);
    expect(batches.pick(ray, 500)).toBeNull();
    expect(
      batches.group.children
        .filter((object) => object.userData.modelLevel === 0)
        .map((object) => object.userData.treeIds),
    ).toContainEqual([71]);
    batches.dispose();
  });
  it('场外模型保留稳定阴影，重复视图不上传，释放实例缓冲而不释放共享几何', async () => {
    const model = source(),
      geometryDispose = vi.fn();
    (model.children[0] as THREE.Mesh).geometry.addEventListener('dispose', geometryDispose);
    const batches = new ModelBatches(
      { get: async () => model },
      'TreeBatch',
      false,
      vi.fn(),
      vi.fn(),
    );
    await batches.rebuild([
      { asset, instances: [{ id: 1, matrix: new THREE.Matrix4().makeTranslation(5000, 0, 0) }] },
    ]);
    const view = camera();
    batches.update(view, 1000, null);
    expect(batches.diagnostics.visible).toBe(0);
    const uploads = batches.diagnostics.uploads;
    batches.update(view, 1000, null);
    expect(batches.diagnostics.uploads).toBe(uploads);
    const shadow = batches.group.children.find(
      (object) => object.name === 'TreeBatchShadow',
    ) as THREE.InstancedMesh;
    expect(shadow.castShadow).toBe(true);
    expect(shadow.instanceMatrix.count).toBe(1);
    const disposal = vi.fn();
    shadow.addEventListener('dispose', disposal);
    batches.dispose();
    batches.dispose();
    expect(disposal).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(batches.group.children).toHaveLength(0);
  });
  it('树木投影关闭时不创建阴影批次，内置和自定义树木仍显示、接收阴影并可拾取', async () => {
    for (const original of [false, true]) {
      for (const modelAsset of [asset, { ...asset, id: 'custom-tree' }]) {
        const model = source();
        const batches = new ModelBatches(
          { get: async () => model },
          'TreeBatch',
          original,
          vi.fn(),
          vi.fn(),
          undefined,
          undefined,
          false,
        );
        await batches.rebuild([
          { asset: modelAsset, instances: [{ id: 71, matrix: new THREE.Matrix4() }] },
        ]);
        // 选中使用原模型，独立验证颜色批次与稳定拾取身份。
        batches.update(camera(), 1000, 71);
        expect(batches.group.children.some((object) => object.castShadow)).toBe(false);
        expect(batches.group.children.some((object) => object.name.endsWith('Shadow'))).toBe(false);
        expect(batches.diagnostics.visible).toBe(1);
        expect(batches.group.children.every((object) => object.receiveShadow)).toBe(true);
        const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 1000), new THREE.Vector3(0, 0, -1));
        expect(batches.pick(ray, Infinity)).toBe(71);
        const disposed = vi.fn();
        batches.group.children.forEach((object) =>
          (object as THREE.InstancedMesh).addEventListener('dispose', disposed),
        );
        const count = batches.group.children.length;
        await batches.rebuild([]);
        expect(disposed).toHaveBeenCalledTimes(count);
        batches.dispose();
        // 批次开关不改写共享源模型或几何。
        expect(
          (model.children[0] as THREE.Mesh).geometry.attributes.position.count,
        ).toBeGreaterThan(0);
      }
    }
    const sites = new ModelBatches(
      { get: async () => source() },
      'SiteBatch',
      false,
      vi.fn(),
      vi.fn(),
    );
    await sites.rebuild([
      {
        asset: { ...asset, id: 'custom-city', kind: 'city' },
        instances: [{ id: 4, matrix: new THREE.Matrix4() }],
      },
    ]);
    expect(
      sites.group.children.some((object) => object.name === 'SiteBatchShadow' && object.castShadow),
    ).toBe(true);
    sites.dispose();
  });
  it('迟到构建不会覆盖已切换的工程，LOD失败保留原模型', async () => {
    let release!: (group: THREE.Group) => void;
    const pending = new Promise<THREE.Group>((resolve) => {
      release = resolve;
    });
    const get = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(source());
    const batches = new ModelBatches({ get }, 'TreeBatch', false, vi.fn(), vi.fn());
    const stale = batches.rebuild([{ asset, instances: [{ id: 1, matrix: new THREE.Matrix4() }] }]);
    await batches.rebuild([]);
    release(source());
    await stale;
    expect(batches.group.children).toHaveLength(0);
    const errors = vi.fn();
    const fallback = new ModelBatches(
      {
        get: async (_asset, level) => {
          if (level) throw Error('LOD损坏');
          return source();
        },
      },
      'TreeBatch',
      false,
      vi.fn(),
      errors,
    );
    await fallback.rebuild([{ asset, instances: [{ id: 2, matrix: new THREE.Matrix4() }] }]);
    fallback.update(camera(), 1000, 2);
    expect(fallback.diagnostics.visible).toBe(1);
    expect(errors).toHaveBeenCalled();
    fallback.dispose();
    batches.dispose();
  });
});
