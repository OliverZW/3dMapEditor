import type { BrushSettings, GrassLayer, MapDocument } from './types';

export function addGrassLayer(doc: MapDocument, assetId: string, brush: BrushSettings): GrassLayer {
  if (!doc.assets.some((asset) => asset.id === assetId && asset.kind === 'grass'))
    throw new Error('请选择草丛模型');
  const layer: GrassLayer = {
    id: doc.nextId++,
    assetId,
    density: new Float32Array(doc.heights.length),
    seed: doc.nextId * 271,
    version: 1,
    minScale: brush.minScale,
    maxScale: brush.maxScale,
    maxSlope: brush.maxSlope,
    wind: 1,
  };
  doc.grass.push(layer);
  return layer;
}

export function replaceGrassLayerModel(doc: MapDocument, id: number, assetId: string): void {
  const layer = doc.grass.find((item) => item.id === id);
  if (!layer || !doc.assets.some((asset) => asset.id === assetId && asset.kind === 'grass'))
    throw new Error('草丛图层或模型不存在');
  layer.assetId = assetId;
}
