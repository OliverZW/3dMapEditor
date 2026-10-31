import models from '../../editor-assets/models/manifest.json';
import type { ModelAsset } from '../core/types';
import { assetUrl } from './builtin-resources';
import { imageHash } from './image-validation';
import { validateStaticGlb } from './glb-validation';

export type ModelLevel = 0 | 1 | 2;

/** 只对内容完全相同的内置资源启用派生模型，不能以 ID 代替内容身份。 */
export function builtinModelLods(asset: ModelAsset) {
  if (asset.resource?.origin === 'project') return undefined;
  const entry = models.assets.find((entry) => entry.id === asset.id && entry.hash === asset.hash);
  return entry?.lod?.sourceHash === asset.hash ? entry.lod.levels : undefined;
}

export async function loadModelLod(asset: ModelAsset, level: 1 | 2): Promise<Uint8Array> {
  const entry = builtinModelLods(asset)?.[level - 1];
  if (!entry) throw new Error(`模型 ${asset.name} 没有细节层级 ${level}`);
  try {
    const response = await fetch(assetUrl(entry.file));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (imageHash(bytes) !== entry.hash) throw new Error('内容哈希不符');
    validateStaticGlb(bytes);
    return bytes;
  } catch (error) {
    throw new Error(`内置模型 ${entry.file}：${String(error)}`);
  }
}
