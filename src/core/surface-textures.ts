import { defaultSurfaceMaterial } from './surface-material';
import type { MapDocument, SurfaceImage, SurfaceTextureAsset, SurfaceTextureKind } from './types';

export function surfaceTextures(doc: MapDocument): SurfaceTextureAsset[] {
  const items: SurfaceTextureAsset[] = [...(doc.surfaceMaterial.textures ?? [])];
  for (const layer of [
    ...defaultSurfaceMaterial().layers,
    ...doc.surfaceMaterial.layers,
    ...(doc.surfaceMaterial.library ?? []),
  ])
    for (const kind of ['color', 'normal'] as const)
      items.push({
        id: `image-${kind}-${layer[kind].hash}`,
        name: `${layer.name} · ${kind === 'color' ? '颜色' : '法线'}`,
        kind,
        image: layer[kind],
      });
  const unique = new Map<string, SurfaceTextureAsset>();
  for (const item of items) {
    const key = `${item.kind}:${item.image.hash}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

export function textureLocations(
  doc: MapDocument,
  kind: SurfaceTextureKind,
  hash: string,
): string[] {
  return [
    ...doc.surfaceMaterial.layers
      .filter((layer) => layer[kind].hash === hash)
      .map((layer) => layer.name),
    ...(doc.surfaceMaterial.library ?? [])
      .filter((asset) => asset[kind].hash === hash)
      .map((asset) => `材质库：${asset.name}`),
  ];
}

export function replaceSurfaceTexture(
  doc: MapDocument,
  layerId: string,
  kind: SurfaceTextureKind,
  image: SurfaceImage,
) {
  const layer = doc.surfaceMaterial.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error('目标地表已不存在，请重新选择');
  const other = layer[kind === 'color' ? 'normal' : 'color'];
  if (other.width !== image.width || other.height !== image.height)
    throw new Error(`贴图尺寸须与另一张贴图一致（${other.width} × ${other.height}）`);
  if (layer[kind].hash === image.hash) return;
  layer[kind] = { ...image };
  layer.materialId = undefined;
}
