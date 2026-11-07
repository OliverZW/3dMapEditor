import { strFromU8, strToU8 } from 'fflate';
import type { MapDocument, ModelAsset, SurfaceImage } from '../core/types';
import { validateDocument } from '../core/document';
import { snapshot } from '../core/history';
import { floatBytes, uintBytes } from './project-binary';
import {
  resourceReference,
  resourcePath,
  resolveBuiltin,
  validateReference,
  validateResourceBytes,
} from './project-resources';
import type { BuiltinResolver, ResourceRecord } from './project-resources';

export type ProjectFiles = Record<string, Uint8Array>;
export const jsonBytes = (value: unknown) => strToU8(JSON.stringify(value));
export function validateRelativePath(path: string): void {
  if (
    !path ||
    path.length > 512 ||
    /[\\:\x00-\x1f]/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  )
    throw new Error(`工程包含非法资源路径：${path}`);
}
export function parseJson(bytes: Uint8Array | undefined, path: string): Record<string, unknown> {
  if (!bytes) throw new Error(`工程缺少 ${path}`);
  if (bytes.length > 16 * 1024 * 1024) throw new Error(`${path} JSON 预算超限`);
  try {
    const value: unknown = JSON.parse(strFromU8(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('须为对象');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${path}：${String(error)}`);
  }
}
function lock(records: ResourceRecord[]) {
  const unique = new Map<string, ResourceRecord>();
  for (const record of records)
    if (record.resource.origin === 'builtin')
      unique.set(`${record.kind}:${record.resource.id}:${record.hash}`, record);
  return [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function encodeProjectFiles(
  doc: MapDocument,
  embedded = false,
  resolver: BuiltinResolver = resolveBuiltin,
): ProjectFiles {
  validateDocument(doc);
  const files: ProjectFiles = {},
    records: ResourceRecord[] = [];
  const used = new Set(
    [...doc.trees, ...doc.grass, ...doc.sites, ...(doc.treeLayers ?? [])].map(
      (item) => item.assetId,
    ),
  );
  const store = (value: ModelAsset | SurfaceImage, kind: ResourceRecord['kind']) => {
    const resource = resourceReference(value),
      record = { kind, hash: value.hash, resource };
    validateReference(record);
    // 共享锁必须匹配当前库，即便运行时已装配 bytes。
    const bytes = resource.origin === 'builtin' ? resolver(resource.id, value.hash) : value.bytes;
    if (!bytes) throw new Error(`工程资源缺少数据：${value.hash}`);
    validateResourceBytes(record, bytes, 'width' in value ? value : undefined);
    if (value.bytes && value.bytes !== bytes)
      validateResourceBytes(record, value.bytes, 'width' in value ? value : undefined);
    records.push(record);
    if (embedded || resource.origin === 'project')
      files[resourcePath(value.hash, kind === 'model')] = bytes.slice();
    return { ...value, bytes: undefined, resource };
  };
  const {
    name: _name,
    heights,
    surface,
    owners,
    grass,
    trees,
    rivers,
    sites,
    factions,
    assets,
    surfaceMaterial,
    waterMaterial,
    ...map
  } = doc;
  files['map.json'] = jsonBytes({
    ...map,
    formatVersion: 4,
    assets: assets
      .filter((asset) => resourceReference(asset).origin === 'project' || used.has(asset.id))
      .map((asset) => store(asset, 'model')),
    surfaceMaterial: {
      ...surfaceMaterial,
      textures: surfaceMaterial.textures?.map((asset) => ({
        ...asset,
        image: store(asset.image, 'surface'),
      })),
      layers: surfaceMaterial.layers.map((layer) => ({
        ...layer,
        color: store(layer.color, 'surface'),
        normal: store(layer.normal, 'surface'),
      })),
      library: surfaceMaterial.library?.map((asset) => ({
        ...asset,
        color: store(asset.color, 'surface'),
        normal: store(asset.normal, 'surface'),
      })),
    },
    waterMaterial: {
      ...waterMaterial,
      normal: store(waterMaterial.normal, 'water'),
      mask: store(waterMaterial.mask, 'water'),
    },
  });
  files['objects.json'] = jsonBytes({
    trees,
    rivers,
    sites,
    factions,
    grass: grass.map(({ density: _density, ...layer }) => layer),
  });
  files['builtin-lock.json'] = jsonBytes({ version: 1, resources: lock(records) });
  files['terrain/base.f32'] = floatBytes(heights);
  files['terrain/surface.rgba'] = surface.slice();
  files['logic/owners.u32'] = uintBytes(owners);
  for (const layer of grass) files[`grass/${layer.id}.f32`] = floatBytes(layer.density);
  validateFileBudget(files);
  return files;
}
export function validateFileBudget(files: ProjectFiles): void {
  let total = 0;
  const entries = Object.entries(files);
  if (entries.length > 4096) throw new Error('工程文件数量超限');
  for (const [path, bytes] of entries) {
    validateRelativePath(path);
    total += bytes.length;
    if (total > 512 * 1024 * 1024) throw new Error('工程数据预算超限');
  }
}
export function decodeProjectFiles(
  files: ProjectFiles,
  name: string,
  embedded = false,
  resolver: BuiltinResolver = resolveBuiltin,
): MapDocument {
  validateFileBudget(files);
  if (!name.trim() || name !== name.trim() || name.length > 128) throw new Error('工程名称无效');
  const map = parseJson(files['map.json'], 'map.json'),
    objects = parseJson(files['objects.json'], 'objects.json');
  if (
    typeof map.formatVersion !== 'number' ||
    ![3, 4].includes(map.formatVersion) ||
    map.generatorVersion !== 1
  )
    throw new Error('不支持的地图数据版本');
  if (
    !Array.isArray(map.assets) ||
    !['trees', 'grass', 'rivers', 'sites', 'factions'].every((key) => Array.isArray(objects[key]))
  )
    throw new Error('工程数据结构错误');
  const records: ResourceRecord[] = [];
  const read = (path: string) => {
    validateRelativePath(path);
    if (!files[path]) throw new Error(`工程缺少 ${path}`);
    return files[path];
  };
  const hydrate = <T extends ModelAsset | SurfaceImage>(
    value: T,
    kind: ResourceRecord['kind'],
  ): T => {
    if (!value || typeof value !== 'object') throw new Error('资源描述无效');
    const record = { kind, hash: value.hash, resource: value.resource! };
    validateReference(record);
    records.push(record);
    const path = resourcePath(value.hash, kind === 'model');
    const bytes =
      embedded || record.resource.origin === 'project'
        ? read(path)
        : resolver(record.resource.id, record.hash);
    validateResourceBytes(record, bytes, 'width' in value ? value : undefined);
    return { ...value, bytes, resource: embedded ? { origin: 'project', path } : record.resource };
  };
  const values = (path: string, float: boolean) => {
    const bytes = read(path);
    if (bytes.length % 4) throw new Error(`${path} 二进制长度错误`);
    const array = float ? new Float32Array(bytes.length / 4) : new Uint32Array(bytes.length / 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < array.length; i++)
      array[i] = float ? view.getFloat32(i * 4, true) : view.getUint32(i * 4, true);
    return array;
  };
  try {
    // 外部 JSON 只在候选对象完成结构、资源和文档校验后返回。
    const source = map as unknown as MapDocument;
    const contents = objects as unknown as Pick<
      MapDocument,
      'trees' | 'grass' | 'rivers' | 'sites' | 'factions'
    >;
    const doc: MapDocument = {
      ...source,
      formatVersion: 3,
      ...contents,
      name,
      assets: source.assets.map((asset) => hydrate(asset, 'model')),
      surfaceMaterial: {
        ...source.surfaceMaterial,
        textures: source.surfaceMaterial.textures?.map((asset) => ({
          ...asset,
          image: hydrate(asset.image, 'surface'),
        })),
        layers: source.surfaceMaterial.layers.map((layer) => ({
          ...layer,
          color: hydrate(layer.color, 'surface'),
          normal: hydrate(layer.normal, 'surface'),
        })),
        library: source.surfaceMaterial.library?.map((asset) => ({
          ...asset,
          color: hydrate(asset.color, 'surface'),
          normal: hydrate(asset.normal, 'surface'),
        })),
      },
      waterMaterial: {
        ...source.waterMaterial,
        normal: hydrate(source.waterMaterial.normal, 'water'),
        mask: hydrate(source.waterMaterial.mask, 'water'),
      },
      heights: values('terrain/base.f32', true) as Float32Array,
      surface: read('terrain/surface.rgba').slice(),
      owners: values('logic/owners.u32', false) as Uint32Array,
      grass: contents.grass.map((layer) => {
        if (!Number.isSafeInteger(layer.id) || layer.id <= 0) throw new Error('草层 ID 无效');
        return { ...layer, density: values(`grass/${layer.id}.f32`, true) as Float32Array };
      }),
    };
    const savedLock = parseJson(files['builtin-lock.json'], 'builtin-lock.json');
    if (
      savedLock.version !== 1 ||
      JSON.stringify(savedLock.resources) !== JSON.stringify(lock(records))
    )
      throw new Error('共享资源锁与地图引用不一致');
    validateDocument(doc);
    return snapshot(doc);
  } catch (error) {
    throw new Error(`工程候选数据校验失败：${String(error)}`);
  }
}
