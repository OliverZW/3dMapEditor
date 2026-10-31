import defaults from '../../editor-assets/water/manifest.json';
import type { WaterMaterialPack } from './types';

export function defaultWaterMaterial(): WaterMaterialPack {
  const image = (value: typeof defaults.normal) => ({
    hash: value.hash,
    width: value.width,
    height: value.height,
    resource: { origin: 'builtin' as const, id: value.file },
  });
  return {
    version: 1,
    normal: image(defaults.normal),
    mask: image(defaults.mask),
    material: { ...defaults.material },
  };
}

export function validateWaterMaterial(pack: WaterMaterialPack): void {
  if (!pack || pack.version !== 1 || !pack.material) throw new Error('水面材质无效');
  const { color, roughness, metalness, opacity } = pack.material;
  if (
    !Number.isInteger(color) ||
    color < 0 ||
    color > 0xffffff ||
    ![roughness, metalness, opacity].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
  )
    throw new Error('水面材质参数无效');
  for (const image of [pack.normal, pack.mask]) {
    if (
      !image ||
      !/^[a-f0-9]{64}$/.test(image.hash) ||
      ![image.width, image.height].every((v) => Number.isInteger(v) && v >= 2 && v <= 4096)
    )
      throw new Error('水面贴图无效');
  }
}
