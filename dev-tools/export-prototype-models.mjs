// 仅用于将原型素材加工为文件；应用运行不导入此工具。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};
const stone = new THREE.MeshStandardMaterial({ color: 0x8b9383, roughness: 0.95 });
const darkStone = new THREE.MeshStandardMaterial({ color: 0x515c57, roughness: 0.95 });
const plaster = new THREE.MeshStandardMaterial({ color: 0xc6bd9a, roughness: 0.9 });
const roof = new THREE.MeshStandardMaterial({ color: 0x345b59, roughness: 0.8 });
const wood = new THREE.MeshStandardMaterial({ color: 0x65503a, roughness: 1 });
function box(parent, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function pavilion(parent, x, z, y, size) {
  box(parent, size, size * 0.7, size * 0.8, x, y, z, plaster);
  for (let level = 0; level < 2; level++) {
    const geo = new THREE.CylinderGeometry(size * 0.45, size * 0.8, size * 0.23, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.scale(1, 1, 0.85);
    const mesh = new THREE.Mesh(geo, roof);
    mesh.position.set(x, y + size * 0.75 + level * size * 0.5, z);
    parent.add(mesh);
    if (level === 0)
      box(parent, size * 0.65, size * 0.5, size * 0.55, x, y + size * 0.8, z, plaster);
  }
}
function prototypeModel(kind) {
  const group = new THREE.Group();
  if (kind === 'fortress') {
    const w = 28,
      d = 26,
      h = 9;
    box(group, w + 2, 1.5, d + 2, 0, -0.5, 0, darkStone);
    box(group, w, h, 2, 0, 0, -d / 2, stone);
    box(group, w, h, 2, 0, 0, d / 2, stone);
    box(group, 2, h, d, -w / 2, 0, 0, stone);
    box(group, 2, h, d, w / 2, 0, 0, stone);
    for (let x = -w / 2; x <= w / 2; x += 3) {
      box(group, 1.8, 1.5, 2.2, x, h, -d / 2, stone);
      box(group, 1.8, 1.5, 2.2, x, h, d / 2, stone);
    }
    for (let z = -d / 2; z <= d / 2; z += 3) {
      box(group, 2.2, 1.5, 1.8, -w / 2, h, z, stone);
      box(group, 2.2, 1.5, 1.8, w / 2, h, z, stone);
    }
    for (const x of [-w / 2, w / 2])
      for (const z of [-d / 2, d / 2]) {
        box(group, 5, h + 2, 5, x, 0, z, stone);
        pavilion(group, x, z, h + 2, 5.5);
      }
    pavilion(group, 0, -3, 1, 9);
    box(group, 4, 4, 2.2, 0, 0, d / 2 + 0.15, wood);
    pavilion(group, 0, d / 2, h, 7);
  } else {
    const positions = [];
    for (let i = 0; i < 6; i++) {
      const angle = i * 2.3999,
        x = Math.cos(angle) * 0.3,
        z = Math.sin(angle) * 0.3,
        dx = Math.cos(angle + 0.7) * 0.09,
        dz = Math.sin(angle + 0.7) * 0.09,
        h = 0.6 + (i % 3) * 0.22;
      positions.push(
        x - dx,
        0,
        z - dz,
        x + dx,
        0,
        z + dz,
        x + 0.15 * Math.cos(angle),
        h,
        z + 0.15 * Math.sin(angle),
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x72904b, roughness: 1, side: THREE.DoubleSide }),
    );
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const parts = new Map();
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const material = obj.material;
      const geometries = parts.get(material) ?? [];
      geometries.push(obj.geometry.clone().applyMatrix4(obj.matrixWorld));
      parts.set(material, geometries);
      obj.geometry.dispose();
    }
  });
  const merged = new THREE.Group();
  for (const [material, geometries] of parts) {
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!geometry) throw new Error('内置模型合并失败');
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.castShadow = kind !== 'grass';
    mesh.receiveShadow = true;
    merged.add(mesh);
  }
  return merged;
}

for (const [kind, id, name, file] of [
  ['fortress', 'fort-stone', '山关要塞', 'stone-fortress'],
  ['grass', 'grass-reed', '原野草丛', 'wild-grass'],
]) {
  const model = prototypeModel(kind);
  const result = await new GLTFExporter().parseAsync(model, { binary: true });
  const base = new URL('../editor-assets/models/', import.meta.url);
  await writeFile(new URL(file + '.glb', base), new Uint8Array(result));
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  let triangles = 0,
    meshCount = 0;
  const materials = new Set();
  model.traverse((part) => {
    if (!part.isMesh) return;
    meshCount++;
    triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
    materials.add(part.material.name || '原型材质-' + materials.size);
  });
  const metadata = {
    name,
    assetId: id,
    kind,
    builtin: kind,
    units: 'meters',
    sizeThreeMeters: size.toArray(),
    groundOffset: 0,
    triangles,
    meshCount,
    materials: [...materials],
    front: '+Z',
    generator: 'dev-tools/export-prototype-models.mjs',
    source: '本工程自制程序原型转存 GLB · 可自由使用',
  };
  await writeFile(new URL(file + '.json', base), JSON.stringify(metadata, null, 2) + '\n');
  console.log(fileURLToPath(new URL(file + '.glb', base)));
}
