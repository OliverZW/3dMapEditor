import type { MapDocument } from './types';
import { cloneSurfaceMaterial } from './surface-material';
export type HistoryArray = 'heights' | 'surface' | 'owners' | 'grass';
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
  | 'waterMaterial'
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
    waterMaterial: {
      ...doc.waterMaterial,
      material: { ...doc.waterMaterial.material },
      normal: { ...doc.waterMaterial.normal },
      mask: { ...doc.waterMaterial.mask },
    },
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
  private changedArrays = new Set<HistoryArray>();
  /** 本次 commit 已完成的精确差异，应用层无需再扫描大数组。 */
  get arrayChanges(): ReadonlySet<HistoryArray> {
    return this.changedArrays;
  }
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
    this.changedArrays.clear();
    this.undoEntries = [];
    this.redoEntries = [];
    this.bytes = 0;
  }
  commit(
    before: MapDocument,
    after: MapDocument,
    label: string,
    arrays?: readonly HistoryArray[],
  ): boolean {
    this.changedArrays = new Set();
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
      this.changedArrays = new Set(['heights', 'surface', 'owners', 'grass']);
      return true;
    }
    const patches: Patch[] = [];
    const diff = (key: Patch['key'], a: Values, b: Values) => {
      const indices: number[] = [],
        old: number[] = [],
        next: number[] = [];
      const record = (i: number) => {
        if (a[i] !== b[i]) {
          indices.push(i);
          old.push(a[i]);
          next.push(b[i]);
        }
      };
      // 权重四通道按字比较；仅有变化的字再逐字节生成原有补丁，不改变补丁顺序。
      if (
        a instanceof Uint8Array &&
        b instanceof Uint8Array &&
        a.length === b.length &&
        a.byteOffset % 4 === 0 &&
        b.byteOffset % 4 === 0 &&
        a.length % 4 === 0
      ) {
        const wordsA = new Uint32Array(a.buffer, a.byteOffset, a.length / 4);
        const wordsB = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
        for (let word = 0; word < wordsA.length; word++)
          if (wordsA[word] !== wordsB[word])
            for (let channel = 0; channel < 4; channel++) record(word * 4 + channel);
      } else for (let i = 0; i < a.length; i++) record(i);
      if (indices.length)
        patches.push({ key, indices: new Uint32Array(indices), before: old, after: next });
    };
    if (!arrays || arrays.includes('heights')) diff('heights', before.heights, after.heights);
    if (!arrays || arrays.includes('surface')) diff('surface', before.surface, after.surface);
    if (!arrays || arrays.includes('owners')) diff('owners', before.owners, after.owners);
    for (const layer of before.grass) {
      const next = after.grass.find((g) => g.id === layer.id);
      if (next && (!arrays || arrays.includes('grass')))
        diff(`grass:${layer.id}`, layer.density, next.density);
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
    this.changedArrays = new Set(
      patches.map((p) => (p.key.startsWith('grass:') ? 'grass' : (p.key as HistoryArray))),
    );
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
