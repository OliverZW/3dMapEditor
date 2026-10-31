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
    pack.layers.length !== 4
  )
    throw new Error('地表材质包或显示参数无效');
  const ids = ['grass', 'soil', 'rock', 'sand'];
  let total = 0;
  pack.layers.forEach((layer, index) => {
    if (
      !layer ||
      layer.id !== ids[index] ||
      typeof layer.name !== 'string' ||
      !layer.name ||
      layer.name.length > 128 ||
      !Number.isFinite(layer.meters) ||
      layer.meters < 1 ||
      layer.meters > 512
    )
      throw new Error('地表材质须依次为草地、泥土、岩石、沙地');
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
  if (total > 64 * 1024 * 1024) throw new Error('地表贴图解码预算超过 64 MiB');
}
