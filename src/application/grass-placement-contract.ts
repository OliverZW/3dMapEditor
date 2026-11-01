import type { GrassLayer, Point, Tree } from '../core/types';
import type { VegetationDocument } from '../core/vegetation';

export interface GrassVersion {
  documentVersion: number;
  terrainRevision: number;
  grassRevision: number;
}
export interface GrassRequest extends GrassVersion {
  taskId: number;
  doc: VegetationDocument;
  heights: Float32Array;
  layers: GrassLayer[];
  center: Point;
}
export interface GrassGroup {
  assetId: string;
  instances: Tree[];
}
export type GrassReply = GrassVersion & { taskId: number } & (
    | { groups: GrassGroup[]; error?: never }
    | { error: string; groups?: never }
  );
