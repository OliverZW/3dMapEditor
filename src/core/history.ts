import type { MapDocument } from './types';
import { cloneSurfaceMaterial } from './surface-material';
type Values = Float32Array | Uint8Array | Uint32Array;
interface Patch {
  key: 'heights' | 'surface' | 'owners' | `grass:${number}`;
  indices: Uint32Array;
  before: number[];
  after: number[];
}
type Metadata = Pick<
  MapDocument,
  | 'name'
  | 'nextId'
  | 'assets'
  | 'trees'
  | 'rivers'
  | 'sites'
  | 'factions'
  | 'settings'
  | 'grid'
  | 'surfaceMaterial'
>;
interface PatchEntry {
  kind: 'patch';
  label: string;
  patches: Patch[];
  before: Metadata;
  after: Metadata;
  beforeGrass: MapDocument['grass'];
  afterGrass: MapDocument['grass'];
  bytes: number;
}
interface SnapshotEntry {
  kind: 'snapshot';
  label: string;
  before: MapDocument;
  after: MapDocument;
  bytes: number;
}
type Entry = PatchEntry | SnapshotEntry;
export const HISTORY_BUDGET = 128 * 1024 * 1024;
export function snapshotSize(doc: MapDocument): number {
  return (
    doc.heights.byteLength +
    doc.surface.byteLength +
    doc.owners.byteLength +
    doc.grass.reduce((sum, layer) => sum + layer.density.byteLength, 0) +
    JSON.stringify(metadata(doc), (key, value) => (key === 'bytes' ? undefined : value)).length * 2
  );
}
function metadata(doc: MapDocument): Metadata {
  return {
    settings: { ...doc.settings },
    grid: { ...doc.grid },
    surfaceMaterial: cloneSurfaceMaterial(doc.surfaceMaterial),
    name: doc.name,
    nextId: doc.nextId,
    assets: doc.assets.map((a) => ({ ...a })),
    trees: structuredClone(doc.trees),
    rivers: structuredClone(doc.rivers),
    sites: structuredClone(doc.sites),
    factions: structuredClone(doc.factions),
  };
}
export function snapshot(doc: MapDocument): MapDocument {
  return {
    ...doc,
    ...metadata(doc),
    heights: doc.heights.slice(),
    surface: doc.surface.slice(),
    owners: doc.owners.slice(),
    grass: doc.grass.map((g) => ({ ...g, density: g.density.slice() })),
  };
}
export class History {
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];
  private bytes = 0;
  get canUndo() {
    return this.undoEntries.length > 0;
  }
  get canRedo() {
    return this.redoEntries.length > 0;
  }
  get undoLabel() {
    return this.undoEntries.at(-1)?.label;
  }
  get redoLabel() {
    return this.redoEntries.at(-1)?.label;
  }
  clear() {
    this.undoEntries = [];
    this.redoEntries = [];
    this.bytes = 0;
  }
  commit(before: MapDocument, after: MapDocument, label: string): boolean {
    if (
      JSON.stringify(before.settings) !== JSON.stringify(after.settings) ||
      JSON.stringify(before.grid) !== JSON.stringify(after.grid) ||
      before.owners.length !== after.owners.length
    ) {
      const bytes = snapshotSize(before) + snapshotSize(after);
      if (bytes > HISTORY_BUDGET)
        throw new Error('尺寸调整超过单次历史内存预算，请减少草层或资源实例后重试。');
      this.push({
        kind: 'snapshot',
        label,
        before: snapshot(before),
        after: snapshot(after),
        bytes,
      });
      return true;
    }
    const patches: Patch[] = [];
    const diff = (key: Patch['key'], a: Values, b: Values) => {
      const indices: number[] = [],
        old: number[] = [],
        next: number[] = [];
      for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i]) {
          indices.push(i);
          old.push(a[i]);
          next.push(b[i]);
        }
      if (indices.length)
        patches.push({ key, indices: new Uint32Array(indices), before: old, after: next });
    };
    diff('heights', before.heights, after.heights);
    diff('surface', before.surface, after.surface);
    diff('owners', before.owners, after.owners);
    for (const layer of before.grass) {
      const next = after.grass.find((g) => g.id === layer.id);
      if (next) diff(`grass:${layer.id}`, layer.density, next.density);
    }
    const grassMeta = (doc: MapDocument) =>
      doc.grass.map((g) => ({ ...g, density: new Float32Array(0) }));
    const oldMeta = metadata(before),
      nextMeta = metadata(after);
    const withoutBytes = (value: unknown) =>
      JSON.stringify(value, (key, v) => (key === 'bytes' ? undefined : v));
    if (
      !patches.length &&
      withoutBytes(oldMeta) === withoutBytes(nextMeta) &&
      withoutBytes(grassMeta(before)) === withoutBytes(grassMeta(after))
    )
      return false;
    const changedLayers = (doc: MapDocument, other: MapDocument) =>
      doc.grass.map((g) => ({
        ...g,
        density: other.grass.some((o) => o.id === g.id) ? new Float32Array(0) : g.density.slice(),
      }));
    const entry: PatchEntry = {
      kind: 'patch',
      label,
      patches,
      before: oldMeta,
      after: nextMeta,
      beforeGrass: changedLayers(before, after),
      afterGrass: changedLayers(after, before),
      bytes:
        patches.reduce((sum, p) => sum + p.indices.length * 20, 0) +
        withoutBytes(oldMeta).length * 2 +
        withoutBytes(nextMeta).length * 2,
    };
    entry.bytes +=
      entry.beforeGrass.reduce((n, g) => n + g.density.byteLength, 0) +
      entry.afterGrass.reduce((n, g) => n + g.density.byteLength, 0);
    this.push(entry);
    return true;
  }
  private push(entry: Entry) {
    if (entry.bytes > HISTORY_BUDGET) throw new Error('此操作超过单次撤销内存预算，未提交。');
    this.bytes -= this.redoEntries.reduce((sum, item) => sum + item.bytes, 0);
    this.redoEntries = [];
    this.undoEntries.push(entry);
    this.bytes += entry.bytes;
    while (this.undoEntries.length > 50 || this.bytes > HISTORY_BUDGET)
      this.bytes -= this.undoEntries.shift()!.bytes;
  }
  private apply(doc: MapDocument, entry: Entry, forward: boolean) {
    if (entry.kind === 'snapshot') {
      const nextId = doc.nextId;
      Object.assign(doc, snapshot(forward ? entry.after : entry.before));
      doc.nextId = Math.max(nextId, doc.nextId);
      return;
    }
    const current = new Map(doc.grass.map((g) => [g.id, g.density]));
    const layers = forward ? entry.afterGrass : entry.beforeGrass;
    const nextId = doc.nextId;
    Object.assign(doc, metadata({ ...doc, ...(forward ? entry.after : entry.before) }));
    doc.nextId = Math.max(nextId, doc.nextId);
    doc.grass = layers.map((g) => ({
      ...g,
      density: g.density.length ? g.density.slice() : current.get(g.id)!,
    }));
    for (const p of entry.patches) {
      const target = p.key.startsWith('grass:')
        ? doc.grass.find((g) => g.id === Number(p.key.slice(6)))!.density
        : doc[p.key as 'heights' | 'surface' | 'owners'];
      const values = forward ? p.after : p.before;
      p.indices.forEach((index, i) => (target[index] = values[i]));
    }
  }
  undo(doc: MapDocument) {
    const e = this.undoEntries.pop();
    if (!e) return;
    this.apply(doc, e, false);
    this.redoEntries.push(e);
    return e.label;
  }
  redo(doc: MapDocument) {
    const e = this.redoEntries.pop();
    if (!e) return;
    this.apply(doc, e, true);
    this.undoEntries.push(e);
    return e.label;
  }
}
