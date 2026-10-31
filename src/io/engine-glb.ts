import * as THREE from 'three';
import { validateStaticGlb } from './glb-validation';

interface GltfNode {
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfData {
  asset: { version: string };
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: {
    min?: number[];
    max?: number[];
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
    type: string;
  }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  images?: { bufferView?: number; uri?: string; mimeType?: string }[];
  textures?: {
    source?: number;
    sampler?: number;
    extensions?: { EXT_texture_webp?: { source: number } };
  }[];
  samplers?: Record<string, number>[];
  materials?: Record<string, unknown>[];
}
export function readGlb(bytes: Uint8Array) {
  validateStaticGlb(bytes, 128 * 1024 * 1024);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + length)),
  ) as GltfData;
  const binOffset = 28 + length;
  if (
    binOffset > bytes.length ||
    view.getUint32(24 + length, true) !== 0x004e4942 ||
    view.getUint32(20 + length, true) !== bytes.length - binOffset
  )
    throw new Error('GLB 二进制块无效');
  return { json, binary: bytes.subarray(binOffset) };
}
function encodeGlb(json: object, binary: Uint8Array) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonSize = Math.ceil(text.length / 4) * 4;
  const binSize = Math.ceil(binary.length / 4) * 4;
  const result = new Uint8Array(28 + jsonSize + binSize);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.length, true);
  view.setUint32(12, jsonSize, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + jsonSize);
  result.set(text, 20);
  view.setUint32(20 + jsonSize, binSize, true);
  view.setUint32(24 + jsonSize, 0x004e4942, true);
  result.set(binary, 28 + jsonSize);
  return result;
}

/** 只为据点增加一次水平锚点包装；原始顶点、材质、内嵌纹理和源文件均保留。 */
export function centerSiteGlb(bytes: Uint8Array) {
  const { json, binary } = readGlb(bytes);
  const bounds = new THREE.Box3();
  const visited = new Set<number>();
  const traverse = (index: number, parent: THREE.Matrix4) => {
    if (visited.has(index)) throw new Error('GLB 节点重复或循环');
    visited.add(index);
    const node = json.nodes[index];
    if (!node) throw new Error('GLB 节点引用无效');
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
        );
    const matrix = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh];
      if (!mesh) throw new Error('GLB 网格引用无效');
      for (const primitive of mesh.primitives) {
        const accessor = json.accessors[primitive.attributes.POSITION];
        if (!accessor || accessor.type !== 'VEC3' || accessor.componentType !== 5126)
          throw new Error('GLB 顶点位置无效');
        const box = new THREE.Box3();
        if (accessor.min && accessor.max) {
          box.min.fromArray(accessor.min);
          box.max.fromArray(accessor.max);
        } else {
          const buffer = json.bufferViews[accessor.bufferView];
          const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
          for (let i = 0; i < accessor.count; i++) {
            const offset =
              (buffer.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (buffer.byteStride ?? 12);
            box.expandByPoint(
              new THREE.Vector3(
                view.getFloat32(offset, true),
                view.getFloat32(offset + 4, true),
                view.getFloat32(offset + 8, true),
              ),
            );
          }
        }
        bounds.union(box.applyMatrix4(matrix));
      }
    }
    for (const child of node.children ?? []) traverse(child, matrix);
  };
  const scene = json.scenes[json.scene ?? 0];
  if (!scene) throw new Error('GLB 场景无效');
  scene.nodes.forEach((index) => traverse(index, new THREE.Matrix4()));
  const center = bounds.getCenter(new THREE.Vector3());
  if (bounds.isEmpty() || ![center.x, center.z].every(Number.isFinite))
    throw new Error('GLB 包围体无效');
  const root = json.nodes.length;
  json.nodes.push({ children: [...scene.nodes], translation: [-center.x, 0, -center.z] });
  scene.nodes = [root];
  return encodeGlb(json, binary);
}

export interface MeshData {
  name: string;
  positions: Float32Array;
  uvs: Float32Array;
  indices?: Uint32Array;
  colors?: Float32Array;
}
/** 标准 glTF 数组直接编码，不通过浏览器图片重编码，也不改变顶点顺序。 */
export function meshGlb(meshes: MeshData[], water = false) {
  const chunks: Uint8Array[] = [];
  const views: object[] = [],
    accessors: object[] = [];
  let size = 0;
  const append = (array: Float32Array | Uint32Array, width: number, target: number) => {
    const raw = new Uint8Array(array.length * 4),
      data = new DataView(raw.buffer);
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i])) throw new Error('GLB 包含非有限数组值');
      if (array instanceof Uint32Array) data.setUint32(i * 4, array[i], true);
      else data.setFloat32(i * 4, array[i], true);
    }
    const bufferView = views.length;
    views.push({ buffer: 0, byteOffset: size, byteLength: raw.length, target });
    chunks.push(raw);
    size += raw.length;
    const min = Array(width).fill(Infinity) as number[],
      max = Array(width).fill(-Infinity) as number[];
    for (let i = 0; i < array.length; i++) {
      min[i % width] = Math.min(min[i % width], array[i]);
      max[i % width] = Math.max(max[i % width], array[i]);
    }
    const accessor = accessors.length;
    accessors.push({
      bufferView,
      componentType: array instanceof Uint32Array ? 5125 : 5126,
      count: array.length / width,
      type: width === 1 ? 'SCALAR' : `VEC${width}`,
      min,
      max,
    });
    return accessor;
  };
  const outputs = meshes.map((mesh) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    if (mesh.indices) geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    const attributes: Record<string, number> = {
      POSITION: append(mesh.positions, 3, 34962),
      NORMAL: append(geometry.getAttribute('normal').array as Float32Array, 3, 34962),
      TEXCOORD_0: append(mesh.uvs, 2, 34962),
    };
    if (mesh.colors) attributes.COLOR_0 = append(mesh.colors, 3, 34962);
    const indices = mesh.indices ? append(mesh.indices, 1, 34963) : undefined;
    geometry.dispose();
    return {
      name: mesh.name,
      primitives: [
        { attributes, ...(indices === undefined ? {} : { indices }), material: 0, mode: 4 },
      ],
    };
  });
  const binary = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, offset);
    offset += chunk.length;
  }
  return encodeGlb(
    {
      asset: { version: '2.0', generator: '3dMapEditor export v2' },
      scene: 0,
      scenes: [{ nodes: meshes.map((_, i) => i) }],
      nodes: meshes.map((mesh, i) => ({ name: mesh.name, mesh: i })),
      meshes: outputs,
      accessors,
      bufferViews: views,
      buffers: [{ byteLength: size }],
      materials: [
        {
          name: water ? 'ReferenceWater' : 'ReferenceTerrain',
          pbrMetallicRoughness: {
            baseColorFactor: water ? [...new THREE.Color(0x507f82).toArray(), 0.84] : [1, 1, 1, 1],
            metallicFactor: 0,
            roughnessFactor: water ? 0.3 : 0.95,
          },
          ...(water ? { alphaMode: 'BLEND', doubleSided: true } : {}),
        },
      ],
    },
    binary,
  );
}
