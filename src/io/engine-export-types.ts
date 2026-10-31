import type { MapDocument } from '../core/types';

export interface BinaryDescriptor {
  componentType: 'float32' | 'uint32' | 'uint8';
  byteOrder: 'little' | 'none';
  dimensions: number[];
  elementCount: number;
}
export interface ImageDescriptor {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  channels: 1 | 3 | 4;
}
export interface ExportFile {
  path: string;
  purpose: 'data' | 'resource' | 'diagnostic' | 'tooling';
  mediaType: string;
  byteLength: number;
  sha256: string;
  binary?: BinaryDescriptor;
  image?: ImageDescriptor;
}
export interface ExportIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  stage: 'snapshot' | 'schema' | 'bytes' | 'references' | 'capabilities' | 'import' | 'engine';
  message: string;
  path: string | null;
  objectId: number | null;
  capability: string | null;
}
export interface ExportReport {
  mode: 'production' | 'preview';
  issues: ExportIssue[];
  counts: {
    files: number;
    models: number;
    trees: number;
    sites: number;
    grassLayers: number;
    rivers: number;
    logicCells: number;
  };
  listedBytes: number;
  validation: { package: 'passed'; import: 'not-run'; engine: 'not-run' };
}
export interface EngineManifest {
  packageKind: 'map3d-engine-export';
  exportVersion: 2;
  name: string;
  source: { projectFormatVersion: number; generatorVersion: number };
  adapter: { id: string; version: string; engine: string };
  algorithms: { terrainSampling: 1; grassGenerator: 1; waterGeometry: 1; waterFlow: 1 };
  coordinates: {
    handedness: 'right';
    up: 'Y';
    unit: 'meter';
    imageRight: '+X';
    imageDown: '+Z';
    origin: 'map-center';
    arrayOrder: 'row-major';
    angleUnit: 'radian';
  };
  map: Omit<MapDocument['settings'], 'samples'> & {
    samplesX: number;
    samplesZ: number;
    grid: MapDocument['grid'];
  };
  options: {
    target: string;
    mode: 'production' | 'preview';
    trees: boolean;
    grass: boolean;
    water: boolean;
    sites: boolean;
    logic: boolean;
  };
  entries: {
    terrain: string;
    models: string;
    trees: string | null;
    sites: string | null;
    grass: string | null;
    water: string | null;
    logic: string | null;
  };
  files: ExportFile[];
  requiredCapabilities: string[];
  omissions: { capability: string; reason: string; fallback: string }[];
  validation: ExportReport['validation'];
}
export interface ExportInstance {
  id: number;
  assetId: string;
  position: [number, number, number];
  yaw: number;
  scale: number;
}
export interface ModelDescription {
  id: string;
  name: string;
  kind: 'city' | 'fortress' | 'tree' | 'grass';
  size: number[];
  source: string;
  included: boolean;
  path: string | null;
  material: string | null;
}
export interface WaterDescription {
  rivers: string;
  mesh: string | null;
  material: string;
  primitives: {
    nodeName: string;
    meshIndex: number;
    primitiveIndex: number;
    vertexCount: number;
    depth: string;
    shore: string;
    flow: string;
  }[];
}
