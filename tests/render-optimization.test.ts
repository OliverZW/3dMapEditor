import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createDocument } from '../src/core/document';
import { TerrainGeometry } from '../src/renderer/terrain-geometry';
import { ModelBatches } from '../src/renderer/model-batches';
import { mergeBuiltinModel } from '../src/renderer/model-merge';

describe('连续地形脏区更新', () => {
  it('局部、边缘和多次修改与全量法线一致，缓冲复用且包围体包含抬高顶点', () => {
    const doc = createDocument(513, 768, 384);
    const local = new TerrainGeometry(),
      full = new TerrainGeometry();
    local.update(doc, doc.heights);
    const position = local.getAttribute('position'),
      normal = local.getAttribute('normal');
    for (const [row, col] of [
      [256, 256],
      [0, 0],
      [512, 512],
      [160, 500],
    ]) {
      doc.heights[row * 513 + col] = 235;
      const x = (col / 512 - 0.5) * 768,
        z = (row / 512 - 0.5) * 384;
      local.update(doc, doc.heights, { minX: x, maxX: x, minZ: z, maxZ: z });
      full.update(doc, doc.heights);
      expect(
        local
          .getAttribute('position')
          .array.every((value, i) => value === full.getAttribute('position').array[i]),
      ).toBe(true);
      expect(
        local
          .getAttribute('normal')
          .array.every((value, i) => value === full.getAttribute('normal').array[i]),
      ).toBe(true);
      expect(local.boundingBox!.containsPoint(new THREE.Vector3(x, 235, z))).toBe(true);
      expect(local.diagnostics.vertices).toBe(1);
      expect(local.diagnostics.normals).toBeLessThanOrEqual(9);
    }
    expect(local.getAttribute('position')).toBe(position);
    expect(local.getAttribute('normal')).toBe(normal);
    expect((position as THREE.BufferAttribute).updateRanges.length).toBeGreaterThan(513);
    local.dispose();
    full.dispose();
  });
  it('宽深变化和采样变化强制重建完整坐标，索引仍匹配单片地面', () => {
    const geometry = new TerrainGeometry(),
      doc = createDocument();
    geometry.update(doc, doc.heights);
    doc.settings.width = 512;
    geometry.update(doc, doc.heights, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    expect(geometry.diagnostics.vertices).toBe(513 * 513);
    expect(geometry.getAttribute('position').getX(0)).toBe(-256);
    const next = createDocument(1025, 768, 384);
    geometry.update(next, next.heights, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    expect(geometry.getAttribute('normal').count).toBe(1025 * 1025);
    expect(geometry.index!.count).toBe(1024 * 1024 * 6);
    expect(Array.from(geometry.index!.array.slice(0, 6))).toEqual([0, 1025, 1, 1, 1025, 1026]);
    geometry.dispose();
  });
});

describe('内置模型派生合批', () => {
  it('相同变换的城池网格合并，不同变换保留，源模型与世界包围体不变', () => {
    const source = new THREE.Group(),
      material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), material);
      mesh.position.set(i === 2 ? 10 : 0, 0, 0);
      source.add(mesh);
    }
    const merged = mergeBuiltinModel(source, createDocument().assets[0]);
    expect(merged.children).toHaveLength(2);
    expect(source.children).toHaveLength(3);
    expect((merged.children[0] as THREE.Mesh).geometry.index!.count).toBe(2 * 36);
    expect(new THREE.Box3().setFromObject(merged)).toEqual(new THREE.Box3().setFromObject(source));
    expect((merged.children[0] as THREE.Mesh).material).toBe(material);
    expect((source.children[0] as THREE.Mesh).geometry.attributes.position.count).toBe(24);
  });
  it('叶片颜色写入线性顶点色；阔叶的粗糙度分组保持原样', () => {
    const source = new THREE.Group();
    for (const color of [0x345621, 0x416b27, 0x64753d, 0x7b8b46])
      source.add(
        new THREE.Mesh(
          new THREE.PlaneGeometry(),
          new THREE.MeshStandardMaterial({ color, roughness: 0.84, side: THREE.DoubleSide }),
        ),
      );
    const assets = createDocument().assets;
    const pine = mergeBuiltinModel(source, assets.find((asset) => asset.id === 'tree-pine')!);
    expect(pine.children).toHaveLength(1);
    const mesh = pine.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(mesh.material.vertexColors).toBe(true);
    expect(mesh.material.color.toArray()).toEqual([1, 1, 1]);
    const first = (
      source.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    ).material;
    expect(mesh.geometry.getAttribute('color').getX(0)).toBeCloseTo(first.color.r, 7);
    expect(first.vertexColors).toBe(false);
    expect(
      mergeBuiltinModel(source, assets.find((asset) => asset.id === 'tree-broad')!).children,
    ).toHaveLength(4);
  });
});

describe('模型实例上传去重', () => {
  it('可见槽位未变的平移不上传，进出视锥后只上传有效矩阵且拾取ID保持', async () => {
    const asset = createDocument().assets.find((asset) => asset.id === 'tree-pine')!;
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial()));
    const batches = new ModelBatches(
      { get: async () => source },
      'TreeBatch',
      false,
      vi.fn(),
      vi.fn(),
    );
    await batches.rebuild([
      {
        asset,
        instances: [
          { id: 7, matrix: new THREE.Matrix4() },
          { id: 9, matrix: new THREE.Matrix4().makeTranslation(5000, 0, 0) },
        ],
      },
    ]);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.5, 12000);
    camera.position.z = 1000;
    camera.updateMatrixWorld(true);
    batches.update(camera, 1000, 7);
    const before = { ...batches.diagnostics };
    camera.position.x += 1;
    batches.update(camera, 1000, 7);
    expect(batches.diagnostics.uploads).toBe(before.uploads);
    expect(batches.diagnostics.uploadBytes).toBe(before.uploadBytes);
    expect(
      batches.pick(
        new THREE.Raycaster(new THREE.Vector3(0, 0, 1000), new THREE.Vector3(0, 0, -1)),
        Infinity,
      ),
    ).toBe(7);
    camera.position.x = 5000;
    batches.update(camera, 1000, 9);
    expect(batches.diagnostics.uploadBytes).toBeGreaterThan(before.uploadBytes);
    const visible = batches.group.children.filter(
      (object) => object.visible && object.name === 'TreeBatch',
    );
    expect(visible.every((mesh) => (mesh as THREE.Mesh).userData.treeIds[0] === 9)).toBe(true);
    expect(
      batches.pick(
        new THREE.Raycaster(new THREE.Vector3(5000, 0, 1000), new THREE.Vector3(0, 0, -1)),
        Infinity,
      ),
    ).toBe(9);
    batches.dispose();
  });
});
