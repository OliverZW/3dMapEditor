import type { MapDocument, ModelAsset } from './types';
export function isBuiltinAsset(asset: ModelAsset): boolean {
  return asset.resource ? asset.resource.origin === 'builtin' : !!asset.builtin;
}
export function assetReferenceLocations(doc: MapDocument, id: string, limit = 20): string[] {
  const locations: string[] = [];
  for (const site of doc.sites) {
    if (site.assetId === id)
      locations.push(`${site.kind === 'city' ? '城池' : '要塞'}：${site.name}（ID ${site.id}）`);
    if (locations.length >= limit) return locations;
  }
  for (const layer of doc.grass) {
    if (layer.assetId === id) locations.push(`草丛图层（ID ${layer.id}）`);
    if (locations.length >= limit) return locations;
  }
  for (const tree of doc.trees) {
    if (tree.assetId === id) locations.push(`树木实例（ID ${tree.id}）`);
    if (locations.length >= limit) return locations;
  }
  return locations;
}
export function assetReferenceCounts(doc: MapDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of [...doc.sites, ...doc.trees, ...doc.grass])
    counts.set(object.assetId, (counts.get(object.assetId) ?? 0) + 1);
  return counts;
}
