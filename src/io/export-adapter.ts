import { prepareModelDocument } from './builtin-resources';
import { prepareWaterDocument } from './project-resources';
import type { MapDocument } from '../core/types';
import { snapshot } from '../core/history';
import { deriveHeights } from '../core/terrain';
import { validateDocument } from '../core/document';
import type { ExportReport } from './engine-export-types';
import { prepareSurfaceDocument } from './surface-resources';
export interface ExportOptions {
  target?: string;
  mode?: 'production' | 'preview';
  trees: boolean;
  grass: boolean;
  water: boolean;
  sites: boolean;
  logic: boolean;
}
export interface ExportSnapshot {
  document: MapDocument;
  finalHeights: Float32Array;
  coordinates: { up: 'Y'; unit: 'meter'; imageRight: '+X'; imageDown: '+Z' };
}
export interface ExportResult {
  bytes: Uint8Array;
  report: string[];
  details: ExportReport;
}
export interface ExportAdapter {
  id: string;
  label: string;
  export: (snapshot: ExportSnapshot, options: ExportOptions) => Promise<ExportResult>;
}
export function captureSnapshot(doc: MapDocument): ExportSnapshot {
  validateDocument(doc);
  const document = prepareWaterDocument(
    prepareSurfaceDocument(prepareModelDocument(snapshot(doc))),
  );
  return {
    document,
    finalHeights: deriveHeights(document),
    coordinates: { up: 'Y', unit: 'meter', imageRight: '+X', imageDown: '+Z' },
  };
}
export class ExportRegistry {
  private adapters = new Map<string, ExportAdapter>();
  register(adapter: ExportAdapter) {
    if (this.adapters.has(adapter.id)) throw new Error('重复的导出适配器');
    this.adapters.set(adapter.id, adapter);
  }
  get(id: string) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error('此导出目标尚未实现');
    return adapter;
  }
  list() {
    return [...this.adapters.values()].map(({ id, label }) => ({ id, label }));
  }
}
