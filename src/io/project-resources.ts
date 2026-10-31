import type { MapDocument, ModelAsset, ResourceReference, SurfaceImage } from '../core/types';
import { builtinResourceBytes, builtinResourceEntries } from './builtin-resources';
import { imageHash, validateSurfacePng } from './image-validation';
import { validateStaticGlb } from './glb-validation';

export interface ResourceRecord {
  kind: 'model' | 'surface' | 'water';
  hash: string;
  resource: ResourceReference;
}
export type BuiltinResolver = (id: string, hash: string) => Uint8Array;
export const resolveBuiltin: BuiltinResolver = (id, hash) => {
  if (!builtinResourceEntries.some((entry) => entry.file === id && entry.hash === hash))
    throw new Error(`共享资源缺失或哈希不符：${id}`);
  return builtinResourceBytes(hash);
};
export function resourcePath(hash: string, model: boolean): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('资源内容哈希无效');
  return `assets/${model ? 'models' : 'textures'}/${hash}.${model ? 'glb' : 'png'}`;
}
export function resourceReference(value: ModelAsset | SurfaceImage): ResourceReference {
  if (value.resource) return value.resource;
  // 自定义描述按工程资源处理，归属不以运行时 bytes 是否已装配推断。
  if ('builtin' in value && value.builtin) {
    const entry = builtinResourceEntries.find(
      (entry) => entry.hash === value.hash && entry.file.endsWith('.glb'),
    );
    if (!entry) throw new Error(`共享模型不存在：${value.builtin}`);
    return { origin: 'builtin', id: entry.file };
  }
  return { origin: 'project', path: resourcePath(value.hash, 'triangles' in value) };
}
export function validateReference(record: ResourceRecord): void {
  resourcePath(record.hash, record.kind === 'model');
  const ref = record.resource;
  if (!ref || !['model', 'surface', 'water'].includes(record.kind)) throw new Error('资源描述无效');
  if (ref.origin === 'builtin') {
    if (typeof ref.id !== 'string' || !ref.id || ref.id.length > 256)
      throw new Error('共享资源标识无效');
  } else if (
    ref.origin !== 'project' ||
    ref.path !== resourcePath(record.hash, record.kind === 'model')
  )
    throw new Error('工程资源路径无效');
}
export function validateResourceBytes(
  record: ResourceRecord,
  bytes: Uint8Array,
  image?: SurfaceImage,
) {
  if (imageHash(bytes) !== record.hash) throw new Error(`资源内容哈希不符：${record.hash}`);
  if (record.kind === 'model') validateStaticGlb(bytes);
  else {
    if (!image) throw new Error('贴图尺寸描述缺失');
    validateSurfacePng(bytes, record.hash, image.width, image.height, record.kind === 'water');
  }
}
/** 备份恢复的水面直接消费文档字节，不回查当前共享库。 */
export function prepareWaterDocument(doc: MapDocument): MapDocument {
  const pack = doc.waterMaterial;
  const image = (value: SurfaceImage): SurfaceImage => {
    const resource = resourceReference(value);
    const record: ResourceRecord = { kind: 'water', hash: value.hash, resource };
    validateReference(record);
    const bytes =
      value.bytes ??
      (resource.origin === 'builtin' ? resolveBuiltin(resource.id, value.hash) : undefined);
    if (!bytes) throw new Error('水面贴图数据缺失');
    validateResourceBytes(record, bytes, value);
    return { ...value, resource, bytes };
  };
  return {
    ...doc,
    waterMaterial: {
      ...pack,
      material: { ...pack.material },
      normal: image(pack.normal),
      mask: image(pack.mask),
    },
  };
}
