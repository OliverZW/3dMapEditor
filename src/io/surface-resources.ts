import type { MapDocument, SurfaceImage } from '../core/types';
import { cloneSurfaceMaterial, validateSurfaceMaterial } from '../core/surface-material';
import { validateSurfacePng } from './image-validation';

import { builtinResourceBytes } from './builtin-resources';

export function surfaceImageBytes(image: SurfaceImage): Uint8Array {
  if (image.bytes) return image.bytes;
  if (image.resource?.origin === 'project')
    throw new Error(`工程贴图缺少数据：${image.resource.path}`);
  return builtinResourceBytes(image.hash);
}

/** 候选装配不改变原文档；固定研究资源可由包内 PNG 独立恢复。 */
export function prepareSurfaceDocument(doc: MapDocument): MapDocument {
  validateSurfaceMaterial(doc.surfaceMaterial);
  const surfaceMaterial = cloneSurfaceMaterial(doc.surfaceMaterial);
  for (const layer of [...surfaceMaterial.layers, ...(surfaceMaterial.library ?? [])]) {
    for (const kind of ['color', 'normal'] as const) {
      const image = layer[kind];
      image.bytes = surfaceImageBytes(image);
      try {
        validateSurfacePng(image.bytes, image.hash, image.width, image.height);
      } catch (error) {
        throw new Error(`地表${layer.name} ${kind}：${String(error)}`);
      }
    }
  }
  return { ...doc, surfaceMaterial };
}
