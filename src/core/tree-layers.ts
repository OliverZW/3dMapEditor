import type { MapDocument, TreeLayer } from './types';

/** 旧工程按模型归层，保留所有实例的身份和变换。空数组表示用户已删除所有层。 */
export function prepareTreeLayers(doc: MapDocument): void {
  if (doc.treeLayers !== undefined) return;
  doc.trees = doc.trees.map((tree) => ({ ...tree }));
  doc.treeLayers = doc.assets
    .filter((asset) => asset.kind === 'tree')
    .map((asset) => ({
      id: `tree-layer-model-${asset.id}`,
      name: asset.name,
      assetId: asset.id,
    }));
  for (const tree of doc.trees)
    tree.layerId = doc.treeLayers.find((layer) => layer.assetId === tree.assetId)?.id;
}

export function addTreeLayer(doc: MapDocument, assetId: string): TreeLayer {
  prepareTreeLayers(doc);
  const asset = doc.assets.find((item) => item.id === assetId && item.kind === 'tree');
  if (!asset) throw new Error('请选择树木模型');
  const layer = { id: `tree-layer-${doc.nextId++}`, name: asset.name, assetId };
  doc.treeLayers!.push(layer);
  return layer;
}

export function replaceTreeLayerModel(doc: MapDocument, id: string, assetId: string): void {
  const layer = doc.treeLayers?.find((item) => item.id === id);
  const asset = doc.assets.find((item) => item.id === assetId && item.kind === 'tree');
  if (!layer || !asset) throw new Error('树木图层或模型不存在');
  layer.assetId = assetId;
  layer.name = asset.name;
  for (const tree of doc.trees) if (tree.layerId === id) tree.assetId = assetId;
}

export function deleteTreeLayer(doc: MapDocument, id: string): void {
  if (!doc.treeLayers?.some((layer) => layer.id === id)) throw new Error('树木图层不存在');
  doc.treeLayers = doc.treeLayers.filter((layer) => layer.id !== id);
  doc.trees = doc.trees.filter((tree) => tree.layerId !== id);
}
