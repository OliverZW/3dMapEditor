import models from '../../editor-assets/models/manifest.json';
import surface from '../../editor-assets/surface/manifest.json';
import water from '../../editor-assets/water/manifest.json';
import type { MapDocument, ModelAsset } from '../core/types';
import { defaultSurfaceMaterial, validateSurfaceMaterial } from '../core/surface-material';
import { imageHash, validateSurfacePng } from './image-validation';
import { validateStaticGlb } from './glb-validation';

interface ResourceEntry {
  file: string;
  hash: string;
  width?: number;
  height?: number;
}
export const builtinResourceEntries: readonly ResourceEntry[] = [
  ...models.assets,
  ...surface.layers.flatMap((layer) => [layer.color, layer.normal, layer.thumbnail]),
  water.normal,
  water.mask,
];
let resources = new Map<string, Uint8Array>();
let initialization: Promise<void> | undefined;

export function assetUrl(file: string): string {
  if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..'))
    throw new Error(`内置资源路径无效：${file}`);
  return `${import.meta.env.BASE_URL}${file}`;
}

/** 整组验证成功后才发布；字节不可变共享，历史记录不复制素材。 */
export function installBuiltinResources(files: Record<string, Uint8Array>): void {
  try {
    validateSurfaceMaterial(defaultSurfaceMaterial());
  } catch (error) {
    throw new Error(`内置资源 surface/manifest.json：${String(error)}`);
  }
  const candidates = new Map<string, Uint8Array>();
  for (const entry of builtinResourceEntries) {
    try {
      const bytes = files[entry.file];
      if (!bytes?.length) throw new Error('文件缺失');
      if (imageHash(bytes) !== entry.hash) throw new Error('内容哈希不符');
      if (entry.file.endsWith('.glb')) validateStaticGlb(bytes);
      else {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (
          bytes.length < 24 ||
          ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
          view.getUint32(16) !== entry.width ||
          view.getUint32(20) !== entry.height
        )
          throw new Error('PNG 格式或尺寸不符');
      }
      candidates.set(entry.hash, bytes);
    } catch (error) {
      throw new Error(`内置资源 ${entry.file}：${String(error)}`);
    }
  }
  for (const layer of surface.layers)
    for (const image of [layer.color, layer.normal]) {
      try {
        validateSurfacePng(candidates.get(image.hash)!, image.hash, image.width, image.height);
      } catch (error) {
        throw new Error(`内置资源 ${image.file}：${String(error)}`);
      }
    }
  resources = candidates;
}

export function initializeBuiltinResources(): Promise<void> {
  if (!initialization) {
    initialization = Promise.all(
      builtinResourceEntries.map(async (entry) => {
        try {
          const response = await fetch(assetUrl(entry.file));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return [entry.file, new Uint8Array(await response.arrayBuffer())] as const;
        } catch (error) {
          throw new Error(`内置资源 ${entry.file}：${String(error)}`);
        }
      }),
    )
      .then((entries) => installBuiltinResources(Object.fromEntries(entries)))
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
  }
  return initialization;
}

export function builtinResourceBytes(hash: string): Uint8Array {
  const bytes = resources.get(hash);
  if (!bytes) {
    const file = builtinResourceEntries.find((entry) => entry.hash === hash)?.file ?? hash;
    throw new Error(`内置资源未准备或不存在：${file}`);
  }
  return bytes;
}

/** 浏览列表不是地图依赖；只补充当前已安装的可选内置模型，不替换工程已有条目。 */
export function availableBuiltinModels(): ModelAsset[] {
  return models.assets
    .filter((asset) => resources.has(asset.hash))
    .map(({ file, lod: _lod, ...asset }) => ({
      ...asset,
      kind: asset.kind as ModelAsset['kind'],
      bytes: resources.get(asset.hash),
      size: asset.size as [number, number, number],
      resource: { origin: 'builtin', id: file },
    }));
}

export function prepareModelDocument(doc: MapDocument): MapDocument {
  return {
    ...doc,
    assets: doc.assets.map((asset) => {
      if (asset.bytes) return { ...asset };
      if (asset.resource?.origin === 'project')
        throw new Error(`模型 ${asset.name} 缺少工程自有 GLB 数据`);
      const preset = models.assets.find((item) => item.id === asset.id && item.hash === asset.hash);
      if (!asset.builtin || !preset) throw new Error(`模型 ${asset.name} 缺少 GLB 数据`);
      return { ...asset, bytes: builtinResourceBytes(preset.hash) };
    }),
  };
}
