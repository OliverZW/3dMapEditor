// 从原始 GLB 派生显示模型；不改写原模型、地图或导出资源。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

const root = new URL('../editor-assets/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(new URL('models/manifest.json', root), 'utf8'));
const checkOnly = process.argv.includes('--check');
await MeshoptSimplifier.ready;
if (!checkOnly) await mkdir(new URL('models/lod/', root), { recursive: true });

function clusterLeaves(indices, position, normal, ratio) {
  const parent = Int32Array.from({ length: position.length / 3 }, (_, i) => i);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  for (let i = 0; i < indices.length; i += 3) {
    parent[find(indices[i + 1])] = find(indices[i]);
    parent[find(indices[i + 2])] = find(indices[i]);
  }
  const components = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(indices[i], indices[i + 1], indices[i + 2]);
  }
  const leaves = [...components.values()].map((triangles) => {
    const vertices = [...new Set(triangles)],
      center = [0, 0, 0];
    for (const index of vertices)
      for (let axis = 0; axis < 3; axis++)
        center[axis] += position[index * 3 + axis] / vertices.length;
    let area = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] * 3,
        b = triangles[i + 1] * 3,
        c = triangles[i + 2] * 3;
      const u = [0, 1, 2].map((axis) => position[b + axis] - position[a + axis]);
      const v = [0, 1, 2].map((axis) => position[c + axis] - position[a + axis]);
      area +=
        Math.hypot(
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ) / 2;
    }
    return { triangles, vertices, center, area };
  });
  const target = Math.max(4, Math.floor(leaves.length * ratio));
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const leaf of leaves)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], leaf.center[axis]);
      max[axis] = Math.max(max[axis], leaf.center[axis]);
    }
  let cellSize = Math.hypot(...max.map((value, axis) => value - min[axis])) / Math.cbrt(target) / 3;
  let cells;
  do {
    cells = new Map();
    for (const leaf of leaves) {
      const key = leaf.center
        .map((value, axis) => Math.floor((value - min[axis]) / cellSize))
        .join(':');
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(leaf);
    }
    cellSize *= 1.08;
  } while (cells.size > target);
  const positions = [],
    normals = [],
    output = [];
  for (const cluster of cells.values()) {
    const area = cluster.reduce((sum, leaf) => sum + leaf.area, 0);
    const center = [0, 1, 2].map(
      (axis) => cluster.reduce((sum, leaf) => sum + leaf.center[axis] * leaf.area, 0) / area,
    );
    // 确定性的代表叶片保留原法线与叶形，按总面积补偿覆盖，避免聚类后产生跨叶黑色巨三角。
    const representative = cluster.reduce((best, leaf) =>
      Math.hypot(...leaf.center.map((value, axis) => value - center[axis])) <
      Math.hypot(...best.center.map((value, axis) => value - center[axis]))
        ? leaf
        : best,
    );
    const scale = Math.sqrt(area / representative.area);
    const remap = new Map();
    for (const index of representative.vertices) {
      remap.set(index, positions.length / 3);
      for (let axis = 0; axis < 3; axis++) {
        positions.push(
          center[axis] + (position[index * 3 + axis] - representative.center[axis]) * scale,
        );
        normals.push(normal[index * 3 + axis]);
      }
    }
    for (const index of representative.triangles) output.push(remap.get(index));
  }
  return {
    indices: new Uint32Array(output),
    position: new Float32Array(positions),
    normal: new Float32Array(normals),
  };
}

function derive(bytes, ratio) {
  const jsonLength = bytes.readUInt32LE(12);
  const source = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  const result = structuredClone(source);
  result.accessors = [];
  result.bufferViews = [];
  const chunks = [];
  let length = 0;
  const append = (data, target) => {
    const padding = (4 - (length % 4)) % 4;
    if (padding) chunks.push(Buffer.alloc(padding));
    length += padding;
    const index = result.bufferViews.length;
    result.bufferViews.push({
      buffer: 0,
      byteOffset: length,
      byteLength: data.byteLength,
      ...(target ? { target } : {}),
    });
    chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    length += data.byteLength;
    return index;
  };
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const read = (index) => {
    const accessor = source.accessors[index],
      view = source.bufferViews[accessor.bufferView];
    const Type = types[accessor.componentType],
      width = components[accessor.type];
    if (!Type || !width || accessor.sparse) throw Error('不支持的原模型属性');
    const output = new Type(accessor.count * width);
    const stride = view.byteStride ?? width * Type.BYTES_PER_ELEMENT;
    for (let i = 0; i < accessor.count; i++) {
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * stride;
      new Uint8Array(
        output.buffer,
        i * width * Type.BYTES_PER_ELEMENT,
        width * Type.BYTES_PER_ELEMENT,
      ).set(binary.subarray(offset, offset + width * Type.BYTES_PER_ELEMENT));
    }
    return output;
  };
  const addAccessor = (data, description, target) => {
    const index = result.accessors.length;
    const accessor = {
      ...description,
      bufferView: append(data, target),
      byteOffset: 0,
      count: data.length / components[description.type],
    };
    delete accessor.min;
    delete accessor.max;
    if (description.type === 'VEC3' && target === 34962) {
      accessor.min = [Infinity, Infinity, Infinity];
      accessor.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i++) {
        accessor.min[i % 3] = Math.min(accessor.min[i % 3], data[i]);
        accessor.max[i % 3] = Math.max(accessor.max[i % 3], data[i]);
      }
    }
    result.accessors.push(accessor);
    return index;
  };
  let triangles = 0;
  for (const [meshIndex, mesh] of source.meshes.entries()) {
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      const position = read(primitive.attributes.POSITION);
      const indices =
        primitive.indices === undefined
          ? Uint32Array.from({ length: position.length / 3 }, (_, i) => i)
          : new Uint32Array(read(primitive.indices));
      const target = Math.max(12, Math.floor((indices.length * ratio) / 3) * 3);
      let simplified = indices;
      let foliage;
      if (indices.length > target) {
        if (primitive.attributes.TEXCOORD_0 === undefined) {
          // 独立叶片不做连通分量删除；按空间聚类保留各色叶冠的分布。
          foliage = clusterLeaves(indices, position, read(primitive.attributes.NORMAL), ratio);
          simplified = foliage.indices;
        } else {
          const uv = read(primitive.attributes.TEXCOORD_0);
          [simplified] = MeshoptSimplifier.simplifyWithAttributes(
            indices,
            position,
            3,
            uv,
            2,
            [0.1, 0.1],
            null,
            target,
            0.02,
            ['Permissive'],
          );
        }
      }
      if (!simplified.length) throw Error('派生模型出现空网格');
      const used = [...new Set(simplified)];
      const remap = new Map(used.map((old, index) => [old, index]));
      const output = result.meshes[meshIndex].primitives[primitiveIndex];
      output.attributes = {};
      for (const [name, index] of Object.entries(primitive.attributes)) {
        const accessor = source.accessors[index],
          data = foliage ? (name === 'POSITION' ? foliage.position : foliage.normal) : read(index),
          width = components[accessor.type];
        const compact = new data.constructor(used.length * width);
        used.forEach((old, next) =>
          compact.set(data.subarray(old * width, old * width + width), next * width),
        );
        output.attributes[name] = addAccessor(compact, accessor, 34962);
      }
      const compactIndices = Uint32Array.from(simplified, (index) => remap.get(index));
      output.indices = addAccessor(compactIndices, { type: 'SCALAR', componentType: 5125 }, 34963);
      triangles += compactIndices.length / 3;
    }
  }
  for (const image of result.images ?? []) {
    if (image.bufferView === undefined) continue;
    const view = source.bufferViews[image.bufferView];
    image.bufferView = append(
      binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
    );
  }
  const padding = (4 - (length % 4)) % 4;
  if (padding) chunks.push(Buffer.alloc(padding));
  result.buffers = [{ byteLength: length + padding }];
  result.asset.generator = '3dMapEditor offline LOD / meshoptimizer 1.0.1';
  const encoded = Buffer.from(JSON.stringify(result));
  const json = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 32)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(20),
    binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return { bytes: Buffer.concat([header, json, binHeader, bin]), triangles };
}

for (const asset of manifest.assets.filter((asset) => ['tree', 'city'].includes(asset.kind))) {
  const original = await readFile(new URL(asset.file, root));
  if (hash(original) !== asset.hash) throw Error(`${asset.file} 原始哈希已过期，请先刷新清单`);
  const levels = [];
  for (const [index, ratio] of [0.2, 0.03].entries()) {
    const generated = derive(original, ratio);
    const file = `models/lod/${asset.id}-${index + 1}.glb`;
    if (checkOnly) {
      if (!(await readFile(new URL(file, root))).equals(generated.bytes))
        throw Error(`${file} 与确定性加工结果不一致`);
    } else await writeFile(new URL(file, root), generated.bytes);
    levels.push({ file, hash: hash(generated.bytes), triangles: generated.triangles });
  }
  const descriptor = { sourceHash: asset.hash, levels };
  if (checkOnly && JSON.stringify(asset.lod) !== JSON.stringify(descriptor))
    throw Error(`${asset.id} 的 LOD 清单已过期`);
  asset.lod = descriptor;
  console.log(asset.id, asset.triangles, '->', levels.map((level) => level.triangles).join(' / '));
}
if (!checkOnly)
  await writeFile(new URL('models/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
