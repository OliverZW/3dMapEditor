export type AssetKind = 'city' | 'fortress' | 'tree' | 'grass';
export type ResourceReference =
  | { origin: 'builtin'; id: string }
  | { origin: 'project'; path: string };
export interface Point {
  x: number;
  z: number;
}
export interface Hex {
  q: number;
  r: number;
}
export interface MapSettings {
  width: number;
  depth: number;
  samples: number;
  minHeight: number;
  maxHeight: number;
}
export interface HexGrid {
  columns: number;
  rows: number;
  radius: number;
  originX: number;
  originZ: number;
}
export interface ModelAsset {
  resource?: ResourceReference;
  id: string;
  name: string;
  kind: AssetKind;
  builtin?: string;
  hash: string;
  bytes?: Uint8Array;
  size: [number, number, number];
  triangles: number;
  materials: number;
  scale: number;
  yaw: number;
  offset: number;
  source: string;
}
export interface Tree extends Point {
  id: number;
  assetId: string;
  yaw: number;
  scale: number;
  maxSlope?: number;
}
export interface GrassLayer {
  id: number;
  assetId: string;
  density: Float32Array;
  seed: number;
  version: 1;
  minScale: number;
  maxScale: number;
  maxSlope: number;
  wind: number;
}
export interface River {
  id: number;
  name: string;
  points: Point[];
  width: number;
  depth: number;
  waterLevel: number;
  interpolation?: 'catmull-rom' | 'linear';
  clipped?: boolean;
}
export interface Site {
  id: number;
  kind: 'city' | 'fortress';
  name: string;
  assetId: string;
  center: Hex;
  yaw: number;
  scale: number;
  factionId: number | null;
}
export interface Faction {
  id: number;
  name: string;
  color: string;
}
export interface MapDocument {
  waterMaterial: WaterMaterialPack;
  formatVersion: 3;
  generatorVersion: 1;
  name: string;
  settings: MapSettings;
  grid: HexGrid;
  nextId: number;
  heights: Float32Array;
  surface: Uint8Array;
  surfaceMaterial: SurfaceMaterialPack;
  owners: Uint32Array;
  assets: ModelAsset[];
  trees: Tree[];
  grass: GrassLayer[];
  rivers: River[];
  sites: Site[];
  factions: Faction[];
}
export type SurfaceLayerId = string;
export interface SurfaceImage {
  resource?: ResourceReference;
  hash: string;
  width: number;
  height: number;
  /** PNG 字节为不可变共享资源；内置描述在 IO 装配时补齐。 */
  bytes?: Uint8Array;
}
export interface SurfaceAsset {
  id: string;
  name: string;
  meters: number;
  color: SurfaceImage;
  normal: SurfaceImage;
}
export type SurfaceTextureKind = 'color' | 'normal';
export interface SurfaceTextureAsset {
  id: string;
  name: string;
  kind: SurfaceTextureKind;
  image: SurfaceImage;
}
export interface WaterMaterialPack {
  version: 1;
  normal: SurfaceImage;
  mask: SurfaceImage;
  material: { color: number; roughness: number; metalness: number; opacity: number };
}
export interface SurfaceMaterialPack {
  id: string;
  version: 1;
  source: string;
  layers: {
    id: SurfaceLayerId;
    scale?: number;
    detail?: number;
    materialId?: string;
    name: string;
    meters: number;
    color: SurfaceImage;
    normal: SurfaceImage;
  }[];
  library?: SurfaceAsset[];
  textures?: SurfaceTextureAsset[];
  scale: number;
  detail: number;
  slopeRock: boolean;
  slopeLayerId?: string;
}
export type Tool =
  | 'overview'
  | 'terrain'
  | 'surface'
  | 'trees'
  | 'grass'
  | 'river'
  | 'sites'
  | 'factions';
export interface BrushSettings {
  radius: number;
  strength: number;
  falloff: number;
  height: number;
  terrainMode: 'raise' | 'lower' | 'smooth' | 'flatten';
  surfaceLayer: number;
  erase: boolean;
  treeDensity: number;
  grassDensity: number;
  minScale: number;
  maxScale: number;
  maxSlope: number;
  spacing: number;
  hexRadius: number;
}
export interface ViewSettings {
  trees: boolean;
  grass: boolean;
  water: boolean;
  sites: boolean;
  hex: boolean;
  territories: boolean;
  factions: boolean;
}
export const DEFAULT_BRUSH: BrushSettings = {
  radius: 40,
  strength: 0.3,
  falloff: 0.6,
  height: 32,
  terrainMode: 'raise',
  surfaceLayer: 0,
  erase: false,
  treeDensity: 6,
  grassDensity: 2,
  minScale: 0.8,
  maxScale: 1.2,
  maxSlope: 30,
  spacing: 3,
  hexRadius: 1,
};
export const DEFAULT_VIEW: ViewSettings = {
  trees: true,
  grass: true,
  water: true,
  sites: true,
  hex: false,
  territories: true,
  factions: true,
};
