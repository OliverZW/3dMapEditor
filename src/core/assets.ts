import type { MapDocument } from './types';
export function assetReferenceCounts(doc: MapDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of [...doc.sites, ...doc.trees, ...doc.grass])
    counts.set(object.assetId, (counts.get(object.assetId) ?? 0) + 1);
  return counts;
}
