import defaults from '../../editor-assets/surface/manifest.json';
import type { SurfaceMaterialPack } from './types';

export function defaultSurfaceMaterial(): SurfaceMaterialPack {
  return {
    ...structuredClone(defaults),
    version: 1,
    layers: defaults.layers.map((layer) => ({
      id: layer.id as SurfaceMaterialPack['layers'][number]['id'],
      name: layer.name,
      meters: layer.meters,
      color: {
        hash: layer.color.hash,
        width: layer.color.width,
        height: layer.color.height,
        resource: { origin: 'builtin', id: layer.color.file },
      },
      normal: {
        hash: layer.normal.hash,
        width: layer.normal.width,
        height: layer.normal.height,
        resource: { origin: 'builtin', id: layer.normal.file },
      },
    })),
  };
}

export function cloneSurfaceMaterial(pack: SurfaceMaterialPack): SurfaceMaterialPack {
  return {
    ...pack,
    layers: pack.layers.map((layer) => ({
      ...layer,
      color: { ...layer.color },
      normal: { ...layer.normal },
    })),
    library: pack.library?.map((asset) => ({
      ...asset,
      color: { ...asset.color },
      normal: { ...asset.normal },
    })),
    textures: pack.textures?.map((asset) => ({ ...asset, image: { ...asset.image } })),
  };
}

export function validateSurfaceMaterial(pack: SurfaceMaterialPack): void {
  if (
    !pack ||
    pack.version !== 1 ||
    typeof pack.id !== 'string' ||
    !pack.id ||
    typeof pack.source !== 'string' ||
    pack.source.length > 2048 ||
    !Number.isFinite(pack.scale) ||
    pack.scale < 0.25 ||
    pack.scale > 4 ||
    !Number.isFinite(pack.detail) ||
    pack.detail < 0 ||
    pack.detail > 1 ||
    typeof pack.slopeRock !== 'boolean' ||
    !Array.isArray(pack.layers) ||
    pack.layers.length < 1 ||
    pack.layers.length > 8
  )
    throw new Error('地表材质包或显示参数无效');
  const ids = new Set<string>();
  if (pack.textures !== undefined && (!Array.isArray(pack.textures) || pack.textures.length > 128))
    throw new Error('贴图库无效或超过 128 项');
  const textureIds = new Set<string>();
  let textureBytes = 0;
  for (const asset of pack.textures ?? []) {
    const image = asset?.image;
    if (
      !asset ||
      typeof asset.id !== 'string' ||
      !/^texture-[a-zA-Z0-9-]{1,80}$/.test(asset.id) ||
      textureIds.has(asset.id) ||
      typeof asset.name !== 'string' ||
      !asset.name.trim() ||
      asset.name.length > 128 ||
      !['color', 'normal'].includes(asset.kind) ||
      !image ||
      !/^[a-f0-9]{64}$/.test(image.hash) ||
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 2 ||
      image.height < 2 ||
      image.width > 4096 ||
      image.height > 4096 ||
      !(image.bytes instanceof Uint8Array) ||
      image.bytes.length === 0 ||
      image.bytes.length > 16 * 1024 * 1024
    )
      throw new Error('贴图库条目无效');
    textureIds.add(asset.id);
    textureBytes += image.bytes.length;
  }
  if (textureBytes > 384 * 1024 * 1024) throw new Error('贴图库超过 384 MiB');
  if (
    pack.slopeLayerId !== undefined &&
    !pack.layers.some((layer) => layer.id === pack.slopeLayerId)
  )
    throw new Error('显岩地表引用无效');
  if (pack.library !== undefined && (!Array.isArray(pack.library) || pack.library.length > 64))
    throw new Error('地表材质库无效或超过 64 项');
  const libraryIds = new Set<string>();
  let libraryBytes = 0;
  const libraryHashes = new Set<string>();
  for (const asset of pack.library ?? []) {
    if (
      !asset ||
      typeof asset.id !== 'string' ||
      !/^surface-[a-zA-Z0-9-]{1,64}$/.test(asset.id) ||
      libraryIds.has(asset.id) ||
      typeof asset.name !== 'string' ||
      !asset.name.trim() ||
      asset.name.length > 128 ||
      !Number.isFinite(asset.meters) ||
      asset.meters < 1 ||
      asset.meters > 512 ||
      !asset.color ||
      !asset.normal ||
      asset.color.width !== asset.normal.width ||
      asset.color.height !== asset.normal.height
    )
      throw new Error('地表材质库条目无效');
    libraryIds.add(asset.id);
    for (const image of [asset.color, asset.normal]) {
      if (
        !/^[a-f0-9]{64}$/.test(image.hash) ||
        !Number.isInteger(image.width) ||
        !Number.isInteger(image.height) ||
        image.width < 2 ||
        image.height < 2 ||
        image.width > 4096 ||
        image.height > 4096 ||
        !(image.bytes instanceof Uint8Array) ||
        !image.bytes.length ||
        image.bytes.length > 16 * 1024 * 1024
      )
        throw new Error(`地表材质 ${asset.name} 的贴图无效或缺失`);
      if (!libraryHashes.has(image.hash)) {
        libraryHashes.add(image.hash);
        libraryBytes += image.bytes.length;
      }
    }
  }
  if (libraryBytes > 384 * 1024 * 1024) throw new Error('地表材质库超过 384 MiB');
  let total = 0;
  pack.layers.forEach((layer) => {
    if (
      !layer ||
      typeof layer.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(layer.id) ||
      ids.has(layer.id) ||
      typeof layer.name !== 'string' ||
      !layer.name ||
      layer.name.length > 128 ||
      (layer.scale !== undefined &&
        (!Number.isFinite(layer.scale) || layer.scale < 0.25 || layer.scale > 4)) ||
      (layer.detail !== undefined &&
        (!Number.isFinite(layer.detail) || layer.detail < 0 || layer.detail > 1)) ||
      !Number.isFinite(layer.meters) ||
      layer.meters < 1 ||
      layer.meters > 512
    )
      throw new Error('地表标识或参数无效');
    ids.add(layer.id);
    if (layer.materialId !== undefined) {
      const asset = pack.library?.find((item) => item.id === layer.materialId);
      if (
        !asset ||
        asset.meters !== layer.meters ||
        asset.color.hash !== layer.color.hash ||
        asset.normal.hash !== layer.normal.hash
      )
        throw new Error(`地表${layer.name}的材质引用无效`);
    }
    if (layer.color.width !== layer.normal.width || layer.color.height !== layer.normal.height)
      throw new Error(`地表${layer.name}的颜色和法线尺寸不一致`);
    for (const kind of ['color', 'normal'] as const) {
      const image = layer[kind];
      if (
        !image ||
        !/^[a-f0-9]{64}$/.test(image.hash) ||
        !Number.isInteger(image.width) ||
        !Number.isInteger(image.height) ||
        image.width < 2 ||
        image.width > 4096 ||
        image.height < 2 ||
        image.height > 4096 ||
        (image.bytes !== undefined &&
          (!(image.bytes instanceof Uint8Array) ||
            !image.bytes.length ||
            image.bytes.length > 16 * 1024 * 1024))
      )
        throw new Error(`地表${layer.name}的${kind}贴图无效或超限`);
      if (!image.bytes && !defaults.layers.some((item) => item[kind].hash === image.hash))
        throw new Error(`地表${layer.name}缺少贴图数据`);
      total += image.width * image.height * 4;
    }
  });
  if (total > 256 * 1024 * 1024) throw new Error('地表贴图解码预算超过 256 MiB');
}
