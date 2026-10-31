import Ajv from 'ajv';
import schema from '../../.agent/docs/contracts/engine-export-v2.schema.json';
import { imageHash, validateSurfacePng } from './image-validation';
import { referenceImageInfo } from './engine-export-files';
import { readGlb } from './engine-glb';
import { decodeHeightPng } from './heightmap';
import { hexIndex, hexWorld, indexHex, hexCorners } from '../core/hex';
import { clipPolygon } from '../core/map-bounds';
import type { River, Site, Faction } from '../core/types';
import type {
  EngineManifest,
  ExportFile,
  ExportInstance,
  ExportReport,
  ModelDescription,
  WaterDescription,
} from './engine-export-types';

const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
ajv.addSchema(schema);
function fail(code: string, path: string, reason: string): never {
  throw new Error(`${code}：${path}：${reason}`);
}

export function validateExportPath(path: string) {
  if (
    path.length > 240 ||
    /\s/.test(path) ||
    !/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
    path
      .split('/')
      .some(
        (part) => part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    fail('E_PATH', path, '包路径无效');
}
function parseJson(bytes: Uint8Array, path: string): unknown {
  if (bytes.length > 16 * 1024 * 1024) fail('E_BUDGET', path, 'JSON 超过 16 MiB');
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
    fail('E_SCHEMA', path, 'JSON 不允许 BOM');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  // JSON.parse 会覆盖重复键；在可信类型收窄前检查所有对象的原始键。
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]]/g;
  for (const token of text.matchAll(tokens)) {
    if (token[0] === '{') stack.push(new Set());
    else if (token[0] === '[') stack.push(null);
    else if (token[0] === '}' || token[0] === ']') stack.pop();
    else if (/^\s*:/.test(text.slice(token.index! + token[0].length))) {
      const key = JSON.parse(token[0]) as string,
        keys = stack.at(-1);
      if (keys?.has(key)) fail('E_SCHEMA', path, `重复 JSON 键 ${key}`);
      keys?.add(key);
    }
  }
  const finite = (item: unknown): void => {
    if (typeof item === 'number' && !Number.isFinite(item))
      fail('E_SCHEMA', path, '包含非有限数值');
    if (item && typeof item === 'object') Object.values(item).forEach(finite);
  };
  finite(value);
  return value;
}
function contract<T>(value: unknown, definition: string, path: string): T {
  const validate = ajv.getSchema(schema.$id + (definition ? `#/definitions/${definition}` : ''))!;
  if (!validate(value)) fail('E_SCHEMA', path, ajv.errorsText(validate.errors));
  return value as T;
}

/** 校验生成包及测试候选，成功前不发布 ZIP；不触及地图或游戏资源。 */
export function validateEnginePackage(files: Record<string, Uint8Array>) {
  if (!Object.hasOwn(files, 'manifest.json')) fail('E_REFERENCE', 'manifest.json', '文件缺失');
  const manifest = contract<EngineManifest>(
    parseJson(files['manifest.json'], 'manifest.json'),
    '',
    'manifest.json',
  );
  const { map, entries, options } = manifest;
  if (options.target !== 'cocos-creator-3.8' || manifest.adapter.id !== options.target)
    fail('E_TARGET', 'manifest.json', '目标未实现或不一致');
  if (map.minHeight >= map.maxHeight || map.grid.columns * map.grid.rows > 1048576)
    fail('E_ARRAY', 'manifest.json', '高度范围或逻辑格预算无效');
  const listed = new Map<string, ExportFile>(),
    folded = new Set<string>();
  const jsons = new Map<string, unknown>();
  let total = files['manifest.json'].length,
    decodedImages = 0;
  if (manifest.files.length > 10000) fail('E_BUDGET', 'manifest.json', '文件数超限');
  for (const entry of manifest.files) {
    validateExportPath(entry.path);
    if (entry.path === 'manifest.json' || folded.has(entry.path.toLowerCase()))
      fail('E_PATH', entry.path, '文件重复或大小写冲突');
    folded.add(entry.path.toLowerCase());
    listed.set(entry.path, entry);
    const bytes = Object.hasOwn(files, entry.path) ? files[entry.path] : undefined;
    if (!bytes) fail('E_REFERENCE', entry.path, '清单文件缺失');
    if (bytes.length !== entry.byteLength || imageHash(bytes) !== entry.sha256)
      fail('E_HASH', entry.path, '长度或内容哈希不符');
    total += bytes.length;
    if (total > 512 * 1024 * 1024) fail('E_BUDGET', entry.path, '解压数据超过 512 MiB');
    if (entry.binary) {
      const { dimensions, elementCount, componentType } = entry.binary;
      const width = componentType === 'uint8' ? 1 : 4;
      if (
        dimensions.reduce((a, b) => a * b, 1) !== elementCount ||
        elementCount * width !== bytes.length
      )
        fail('E_ARRAY', entry.path, '维度、元素数量或字节数不符');
      if (componentType === 'float32') {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < elementCount; i++)
          if (!Number.isFinite(view.getFloat32(i * 4, true)))
            fail('E_ARRAY', entry.path, '浮点数组包含非有限值');
      }
    }
    if (entry.image) {
      const actual = referenceImageInfo(bytes, entry.mediaType);
      if (
        (['width', 'height', 'bitDepth', 'channels'] as const).some(
          (key) => actual[key] !== entry.image![key],
        )
      )
        fail('E_ARRAY', entry.path, '图片尺寸、通道或位深不符');
      const decoded = actual.width * actual.height * 4;
      decodedImages += decoded;
      if (
        bytes.length > 16 * 1024 * 1024 ||
        decoded > 64 * 1024 * 1024 ||
        decodedImages > 256 * 1024 * 1024
      )
        fail('E_BUDGET', entry.path, '图片预算超限');
      if (entry.mediaType === 'image/png' && actual.bitDepth === 8) {
        if (actual.channels === 1) decodeHeightPng(bytes);
        else validateSurfacePng(bytes, entry.sha256, actual.width, actual.height);
      }
    }
    if (entry.mediaType === 'model/gltf-binary') readGlb(bytes);
    if (entry.mediaType === 'application/json') jsons.set(entry.path, parseJson(bytes, entry.path));
  }
  for (const path of Object.keys(files)) {
    validateExportPath(path);
    if (path !== 'manifest.json' && !listed.has(path)) fail('E_REFERENCE', path, '文件未列入清单');
  }
  const require = (path: string, mediaType?: string) => {
    validateExportPath(path);
    const entry = listed.get(path);
    if (!entry || (mediaType && entry.mediaType !== mediaType))
      fail('E_REFERENCE', path, '引用缺失或媒体类型不符');
    return entry;
  };
  const json = <T>(path: string, definition: string): T => {
    require(path, 'application/json');
    return contract<T>(jsons.get(path), definition, path);
  };
  const array = (path: string, type: 'float32' | 'uint32' | 'uint8', dimensions: number[]) => {
    const entry = require(path, 'application/octet-stream');
    if (
      entry.binary?.componentType !== type ||
      JSON.stringify(entry.binary.dimensions) !== JSON.stringify(dimensions)
    )
      fail('E_ARRAY', path, '数组类型或维度与用途不符');
    return new DataView(files[path].buffer, files[path].byteOffset, files[path].byteLength);
  };
  const unique = <T extends { id: number | string }>(items: T[], path: string) => {
    const result = new Map<T['id'], T>();
    for (const item of items) {
      if (result.has(item.id)) fail('E_REFERENCE', path, `重复 ID ${item.id}`);
      result.set(item.id, item);
    }
    return result;
  };
  const terrain = json<{
    mesh: string;
    heights: string;
    surface: string;
    heightmap: string;
    heightMetadata: string;
    material: string;
  }>(entries.terrain, 'terrain');
  require(terrain.mesh, 'model/gltf-binary');
  require(terrain.heightmap, 'image/png');
  const n = map.samplesX,
    count = n * n;
  const heights = array(terrain.heights, 'float32', [n, n]);
  array(terrain.surface, 'uint8', [n, n, 4]);
  const heightMeta = json<{
    width: number;
    depth: number;
    samplesX: number;
    samplesZ: number;
    minHeight: number;
    maxHeight: number;
    origin: number[];
  }>(terrain.heightMetadata, 'heightMetadata');
  for (const key of ['width', 'depth', 'samplesX', 'samplesZ', 'minHeight', 'maxHeight'] as const)
    if (heightMeta[key] !== map[key])
      fail('E_ARRAY', terrain.heightMetadata, `${key} 与地图不一致`);
  if (JSON.stringify(heightMeta.origin) !== JSON.stringify([-map.width / 2, 0, -map.depth / 2]))
    fail('E_ARRAY', terrain.heightMetadata, '原点不一致');
  const png = decodeHeightPng(files[terrain.heightmap]);
  if (png.bits !== 16 || png.width !== n || png.height !== n)
    fail('E_ARRAY', terrain.heightmap, '不是匹配尺寸的 PNG16');
  const surface = files[terrain.surface];
  for (let i = 0; i < count; i++) {
    const height = heights.getFloat32(i * 4, true);
    if (height < map.minHeight || height > map.maxHeight)
      fail('E_ARRAY', terrain.heights, '高度超范围');
    if (
      Math.abs(png.values[i] * (map.maxHeight - map.minHeight) + map.minHeight - height) >
      (map.maxHeight - map.minHeight) / 65535 / 2 + 0.0001
    )
      fail('E_ARRAY', terrain.heightmap, '高度图与权威高度不符');
    if (surface[i * 4] + surface[i * 4 + 1] + surface[i * 4 + 2] + surface[i * 4 + 3] !== 255)
      fail('E_ARRAY', terrain.surface, '地表权重未归一化');
  }
  const surfaceMaterial = json<{ layers: { color: { path: string }; normal: { path: string } }[] }>(
    terrain.material,
    'surfaceMaterial',
  );
  for (const layer of surfaceMaterial.layers)
    for (const texture of [layer.color, layer.normal]) require(texture.path, 'image/png');
  const terrainGlb = readGlb(files[terrain.mesh]);
  if (terrainGlb.json.meshes.length !== 1 || terrainGlb.json.meshes[0].primitives.length !== 1)
    fail('E_ARRAY', terrain.mesh, '地形必须为一个连续网格');
  const position =
    terrainGlb.json.accessors[terrainGlb.json.meshes[0].primitives[0].attributes.POSITION];
  if (position.count !== count) fail('E_ARRAY', terrain.mesh, '地形顶点数不符');
  const positionView = terrainGlb.json.bufferViews[position.bufferView];
  const vertexData = new DataView(
    terrainGlb.binary.buffer,
    terrainGlb.binary.byteOffset,
    terrainGlb.binary.byteLength,
  );
  for (let i = 0; i < count; i++) {
    const offset =
      (positionView.byteOffset ?? 0) +
      (position.byteOffset ?? 0) +
      i * (positionView.byteStride ?? 12);
    const expected = [
      ((i % n) / (n - 1) - 0.5) * map.width,
      heights.getFloat32(i * 4, true),
      (Math.floor(i / n) / (n - 1) - 0.5) * map.depth,
    ];
    if (
      expected.some((value, axis) => {
        const actual = vertexData.getFloat32(offset + axis * 4, true);
        return !Number.isFinite(actual) || Math.abs(actual - value) > 0.001;
      })
    )
      fail('E_ARRAY', terrain.mesh, '地形坐标与权威高度不符');
  }
  const models = json<ModelDescription[]>(entries.models, 'models'),
    modelIds = unique(models, entries.models);
  for (const model of models)
    if (model.included) {
      require(model.path!, 'model/gltf-binary');
      const material = json<{ textures: { path: string }[] }>(model.material!, 'modelMaterials');
      for (const texture of material.textures) {
        const entry = require(texture.path);
        if (!entry.image) fail('E_REFERENCE', texture.path, '不是图片资源');
      }
    }
  const instances = (path: string | null, kinds: string[]) => {
    if (!path) return [];
    const items = json<ExportInstance[]>(path, 'instances');
    unique(items, path);
    for (const item of items) {
      const model = modelIds.get(item.assetId);
      if (!model?.included || !kinds.includes(model.kind))
        fail('E_REFERENCE', path, `实例 ${item.id} 模型引用无效`);
      if (Math.abs(item.position[0]) > map.width / 2 || Math.abs(item.position[2]) > map.depth / 2)
        fail('E_REFERENCE', path, `实例 ${item.id} 超出地图`);
    }
    return items;
  };
  const trees = instances(entries.trees, ['tree']),
    sites = instances(entries.sites, ['city', 'fortress']);
  let logicCells = 0;
  if (entries.logic) {
    const logic = json<{ sites: Site[]; factions: Faction[]; owners: string }>(
      entries.logic,
      'logic',
    );
    const siteIds = unique(logic.sites, entries.logic),
      factionIds = unique(logic.factions, entries.logic);
    const owners = array(logic.owners, 'uint32', [map.grid.rows, map.grid.columns]);
    logicCells = map.grid.rows * map.grid.columns;
    for (const site of logic.sites) {
      const index = hexIndex(map.grid, site.center),
        point = hexWorld(map.grid, site.center);
      if (
        index < 0 ||
        Math.abs(point.x) > map.width / 2 ||
        Math.abs(point.z) > map.depth / 2 ||
        owners.getUint32(index * 4, true) !== site.id
      )
        fail('E_CENTER_OWNER', entries.logic, `据点 ${site.id} 格心或保护归属不一致`);
      if (site.factionId !== null && !factionIds.has(site.factionId))
        fail('E_REFERENCE', entries.logic, `据点 ${site.id} 势力不存在`);
      if (modelIds.get(site.assetId)?.kind !== site.kind)
        fail('E_REFERENCE', entries.logic, `据点 ${site.id} 模型类别不符`);
      const visual = sites.find((item) => item.id === site.id);
      if (
        entries.sites &&
        (!visual ||
          visual.assetId !== site.assetId ||
          Math.abs(visual.position[0] - point.x) > 0.001 ||
          Math.abs(visual.position[2] - point.z) > 0.001)
      )
        fail('E_REFERENCE', entries.logic, `据点 ${site.id} 视觉与逻辑不一致`);
    }
    if (entries.sites && sites.length !== logic.sites.length)
      fail('E_REFERENCE', entries.logic, '视觉和逻辑据点集合不符');
    for (let i = 0; i < logicCells; i++) {
      const owner = owners.getUint32(i * 4, true);
      if (
        owner &&
        (!siteIds.has(owner) ||
          clipPolygon(map, hexCorners(map.grid, indexHex(map.grid, i))).length < 3)
      )
        fail('E_REFERENCE', logic.owners, '逐格归属引用不存在或位于地图外');
    }
  }
  let grassLayers = 0,
    rivers: River[] = [];
  if (entries.water || entries.grass) rivers = json<River[]>('water/rivers.json', 'rivers');
  unique(rivers, 'water/rivers.json');
  if (entries.grass) {
    const grass = json<{
      layers: {
        id: number;
        assetId: string;
        density: string;
        minScale: number;
        maxScale: number;
      }[];
      exclusions: string;
    }>(entries.grass, 'grass');
    unique(grass.layers, entries.grass);
    grassLayers = grass.layers.length;
    const exclusions = json<{ rivers: string }>(grass.exclusions, 'exclusions');
    json(exclusions.rivers, 'rivers');
    for (const layer of grass.layers) {
      const model = modelIds.get(layer.assetId);
      if (!model?.included || model.kind !== 'grass' || layer.minScale > layer.maxScale)
        fail('E_REFERENCE', entries.grass, `草层 ${layer.id} 资源或缩放无效`);
      const density = array(layer.density, 'float32', [n, n]);
      for (let i = 0; i < count; i++) {
        const value = density.getFloat32(i * 4, true);
        if (value < 0 || value > 20) fail('E_ARRAY', layer.density, '草密度超范围');
      }
    }
  }
  if (entries.water) {
    const water = json<WaterDescription>(entries.water, 'water');
    json(water.rivers, 'rivers');
    const material = json<{ normal: { path: string }; mask: { path: string } }>(
      water.material,
      'waterMaterial',
    );
    require(material.normal.path, 'image/png');
    require(material.mask.path, 'image/png');
    if (water.mesh) {
      require(water.mesh, 'model/gltf-binary');
      const glb = readGlb(files[water.mesh]);
      const seen = new Set<string>();
      for (const primitive of water.primitives) {
        const key = `${primitive.meshIndex}:${primitive.primitiveIndex}`;
        const mesh = glb.json.meshes[primitive.meshIndex]?.primitives[primitive.primitiveIndex];
        if (
          !mesh ||
          seen.has(key) ||
          glb.json.accessors[mesh.attributes.POSITION].count !== primitive.vertexCount ||
          !glb.json.nodes.some(
            (node, index) =>
              node.mesh === primitive.meshIndex &&
              (glb.json.nodes[index] as { name?: string }).name === primitive.nodeName,
          )
        )
          fail('E_REFERENCE', entries.water, '水面 primitive 引用无效');
        seen.add(key);
        for (const path of [primitive.depth, primitive.shore]) {
          const values = array(path, 'float32', [primitive.vertexCount]);
          for (let i = 0; i < primitive.vertexCount; i++)
            if (values.getFloat32(i * 4, true) < 0) fail('E_ARRAY', path, '水深或岸距不能为负');
        }
        array(primitive.flow, 'float32', [primitive.vertexCount, 2]);
      }
      if (seen.size !== glb.json.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0))
        fail('E_REFERENCE', entries.water, '水面缺少逐顶点数据');
    }
  }
  const report = json<ExportReport>('report.json', 'report');
  const expectedCounts = {
    files: manifest.files.length,
    models: models.filter((model) => model.included).length,
    trees: trees.length,
    sites: sites.length,
    grassLayers,
    rivers: rivers.length,
    logicCells,
  };
  if (
    (Object.keys(expectedCounts) as (keyof typeof expectedCounts)[]).some(
      (key) => report.counts[key] !== expectedCounts[key],
    ) ||
    report.mode !== options.mode ||
    report.listedBytes !==
      manifest.files
        .filter((entry) => entry.path !== 'report.json')
        .reduce((sum, entry) => sum + entry.byteLength, 0)
  )
    fail('E_ARRAY', 'report.json', '报告计数不一致');
  const required = [
    'continuous-terrain@1',
    ...(models.some((model) => model.included) ? ['static-model-pbr@1'] : []),
    ...(grassLayers ? ['grass-generator@1'] : []),
    ...(entries.logic ? ['hex-owners@1'] : []),
  ];
  if (JSON.stringify([...manifest.requiredCapabilities].sort()) !== JSON.stringify(required.sort()))
    fail('E_CAPABILITY', 'manifest.json', '数据能力声明与内容不符');
  return manifest;
}
