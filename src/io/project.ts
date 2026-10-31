import { prepareModelDocument } from './builtin-resources';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Zippable } from 'fflate';
import type { MapDocument, SurfaceImage, SurfaceMaterialPack } from '../core/types';
import { defaultSurfaceMaterial } from '../core/surface-material';
import { prepareSurfaceDocument } from './surface-resources';
import { validateDocument } from '../core/document';
import { rebuildGridCoverage } from '../core/grid-coverage';
import { validateStaticGlb } from './glb-validation';
export function floatBytes(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4),
    view = new DataView(out.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return out;
}
export function uintBytes(values: Uint32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4),
    view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v, true));
  return out;
}
function readValues(bytes: Uint8Array, float: boolean) {
  if (bytes.length % 4) throw new Error('二进制数据长度错误');
  const out = float ? new Float32Array(bytes.length / 4) : new Uint32Array(bytes.length / 4),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++)
    out[i] = float ? view.getFloat32(i * 4, true) : view.getUint32(i * 4, true);
  return out;
}
export function encodeProject(doc: MapDocument): Uint8Array {
  doc = prepareModelDocument(prepareSurfaceDocument(doc));
  validateDocument(doc);
  const files: Zippable = {};
  const {
    heights,
    surface,
    surfaceMaterial,
    owners,
    trees,
    grass,
    rivers,
    sites,
    factions,
    assets,
    ...manifest
  } = doc;
  files['manifest.json'] = strToU8(
    JSON.stringify({
      ...manifest,
      surfaceMaterial: {
        ...surfaceMaterial,
        layers: surfaceMaterial.layers.map((layer) => ({
          ...layer,
          color: {
            ...layer.color,
            bytes: undefined,
            path: `textures/surface/${layer.color.hash}.png`,
          },
          normal: {
            ...layer.normal,
            bytes: undefined,
            path: `textures/surface/${layer.normal.hash}.png`,
          },
        })),
      },
      assets: assets.map(({ bytes, ...asset }) => ({
        ...asset,
        path: bytes ? `assets/${asset.hash}.glb` : undefined,
      })),
    }),
  );
  files['terrain/base.f32'] = floatBytes(heights);
  files['terrain/surface.rgba'] = surface;
  files['logic/owners.u32'] = uintBytes(owners);
  files['objects.json'] = strToU8(
    JSON.stringify({
      trees,
      grass: grass.map(({ density, ...layer }) => layer),
      rivers,
      sites,
      factions,
    }),
  );
  for (const layer of grass) files[`grass/${layer.id}.f32`] = floatBytes(layer.density);
  for (const asset of assets) if (asset.bytes) files[`assets/${asset.hash}.glb`] = asset.bytes;
  for (const layer of surfaceMaterial.layers)
    for (const kind of ['color', 'normal'] as const)
      files[`textures/surface/${layer[kind].hash}.png`] = [layer[kind].bytes!, { level: 0 }];
  return zipSync(files, { level: 6 });
}
export function decodeProject(bytes: Uint8Array, onMigrated?: () => void): MapDocument {
  if (bytes.length > 256 * 1024 * 1024) throw new Error('工程包超过 256 MiB');
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      count++;
      if (total > 512 * 1024 * 1024 || count > 4096) throw new Error('工程解压预算超限');
      if (
        file.name.startsWith('/') ||
        file.name.includes('\\') ||
        file.name.split('/').includes('..')
      )
        throw new Error('工程包含非法资源路径');
      return true;
    },
  });
  const require = (path: string) => {
    if (!files[path]) throw new Error(`工程缺少 ${path}`);
    return files[path];
  };
  type StoredImage = SurfaceImage & { path: string };
  type StoredSurface = Omit<SurfaceMaterialPack, 'layers'> & {
    layers: (Omit<SurfaceMaterialPack['layers'][number], 'color' | 'normal'> & {
      color: StoredImage;
      normal: StoredImage;
    })[];
  };
  const manifest = JSON.parse(strFromU8(require('manifest.json'))) as Omit<
    MapDocument,
    'assets' | 'surfaceMaterial'
  > & {
    surfaceMaterial?: StoredSurface;
    assets: (MapDocument['assets'][number] & { path?: string })[];
  };
  const objects = JSON.parse(strFromU8(require('objects.json'))) as Pick<
    MapDocument,
    'trees' | 'grass' | 'rivers' | 'sites' | 'factions'
  >;
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !Array.isArray(manifest.assets) ||
    !objects ||
    !['trees', 'grass', 'rivers', 'sites', 'factions'].every((k) =>
      Array.isArray(objects[k as keyof typeof objects]),
    )
  )
    throw new Error('工程结构错误');
  const sourceVersion: unknown = manifest.formatVersion;
  if (sourceVersion !== 1 && sourceVersion !== 2 && sourceVersion !== 3)
    throw new Error('不支持的工程版本');
  let surfaceMaterial = defaultSurfaceMaterial();
  if (sourceVersion === 3) {
    const saved = manifest.surfaceMaterial;
    if (!saved || !Array.isArray(saved.layers) || saved.layers.length !== 4)
      throw new Error('工程缺少四层地表材质');
    const image = (entry: StoredImage): SurfaceImage => {
      if (
        !entry ||
        !/^[a-f0-9]{64}$/.test(entry.hash) ||
        entry.path !== `textures/surface/${entry.hash}.png`
      )
        throw new Error('地表贴图路径或内容标识无效');
      return {
        hash: entry.hash,
        width: entry.width,
        height: entry.height,
        bytes: require(entry.path),
      };
    };
    surfaceMaterial = {
      ...saved,
      layers: saved.layers.map((layer) => {
        if (!layer) throw new Error('地表材质层无效');
        return { ...layer, color: image(layer.color), normal: image(layer.normal) };
      }),
    };
  }
  const doc: MapDocument = {
    ...manifest,
    ...objects,
    formatVersion: 3,
    surfaceMaterial,
    assets: manifest.assets.map((a) => ({ ...a, bytes: a.path ? require(a.path) : undefined })),
    heights: readValues(require('terrain/base.f32'), true) as Float32Array,
    surface: require('terrain/surface.rgba'),
    owners: readValues(require('logic/owners.u32'), false) as Uint32Array,
    grass: objects.grass.map((g) => ({
      ...g,
      density: readValues(require(`grass/${g.id}.f32`), true) as Float32Array,
    })),
  };
  validateDocument(doc);
  if (sourceVersion === 1) {
    rebuildGridCoverage(doc);
  }
  validateDocument(doc);
  for (const asset of doc.assets) if (asset.bytes) validateStaticGlb(asset.bytes);
  const candidate = prepareModelDocument(prepareSurfaceDocument(doc));
  if (sourceVersion === 1 || sourceVersion === 2) onMigrated?.();
  return candidate;
}
