import type { MapDocument, SurfaceAsset } from './types';

export function addSurfaceLayer(doc: MapDocument, asset: SurfaceAsset, id: string) {
  const count = doc.surfaceMaterial.layers.length;
  if (count >= 8) throw new Error('每张地图最多使用 8 种地表');
  if (doc.surfaceMaterial.layers.some((layer) => layer.id === id)) throw new Error('地表标识重复');
  const weights = new Uint8Array(doc.settings.samples ** 2 * (count + 1));
  for (let i = 0; i < doc.settings.samples ** 2; i++)
    weights.set(doc.surface.subarray(i * count, (i + 1) * count), i * (count + 1));
  doc.surface = weights;
  doc.surfaceMaterial.layers.push({ ...asset, id, scale: 1, detail: 0.25 });
}

export function deleteSurfaceLayer(doc: MapDocument, id: string, replacement: string) {
  const layers = doc.surfaceMaterial.layers;
  const from = layers.findIndex((layer) => layer.id === id);
  const to = layers.findIndex((layer) => layer.id === replacement);
  if (layers.length <= 1 || from < 0 || to < 0 || from === to)
    throw new Error('至少保留一种地表，并选择其他替代地表');
  const weights = new Uint8Array(doc.settings.samples ** 2 * (layers.length - 1));
  for (let i = 0; i < doc.settings.samples ** 2; i++) {
    let target = i * (layers.length - 1);
    for (let c = 0; c < layers.length; c++) {
      if (c === from) continue;
      weights[target++] =
        doc.surface[i * layers.length + c] + (c === to ? doc.surface[i * layers.length + from] : 0);
    }
  }
  if ((doc.surfaceMaterial.slopeLayerId ?? 'rock') === id)
    doc.surfaceMaterial.slopeLayerId = replacement;
  doc.surface = weights;
  layers.splice(from, 1);
}
