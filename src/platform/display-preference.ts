import { isDisplayQuality, isShadowSize, presetSettings } from '../renderer/display-quality';
import type { DisplayQuality, RenderSettings } from '../renderer/display-quality';

const key = 'shanhe.render-settings.v2';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readDisplayPreference(
  storage?: PreferenceStorage,
): RenderSettings & { warning?: string } {
  try {
    const source = storage ?? localStorage;
    const raw = source.getItem(key);
    if (raw === null) {
      const old = source.getItem('shanhe.display-quality.v1');
      if (old === null) return presetSettings('fast');
      if (isDisplayQuality(old)) return presetSettings(old);
      throw new Error('旧显示档位无效');
    }
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === 'object' &&
      'quality' in value &&
      isDisplayQuality(value.quality) &&
      'shadows' in value &&
      typeof value.shadows === 'boolean' &&
      'antialias' in value &&
      typeof value.antialias === 'boolean' &&
      'simplifiedSurface' in value &&
      typeof value.simplifiedSurface === 'boolean' &&
      'demandRendering' in value &&
      typeof value.demandRendering === 'boolean'
    ) {
      const preset = presetSettings(value.quality);
      const shadowSize = 'shadowSize' in value ? value.shadowSize : preset.shadowSize;
      const treeShadows = 'treeShadows' in value ? value.treeShadows : true;
      if (!isShadowSize(shadowSize) || typeof treeShadows !== 'boolean')
        throw new Error('光照性能设置无效');
      return {
        quality: value.quality,
        shadows: value.shadows,
        shadowSize,
        treeShadows,
        antialias: value.antialias,
        simplifiedSurface: value.simplifiedSurface,
        demandRendering: value.demandRendering,
      };
    }
    throw new Error('渲染设置无效');
  } catch (error) {
    return {
      ...presetSettings('fast'),
      warning: `本机渲染设置无效或无法读取，已使用流畅档：${String(error)}`,
    };
  }
}

export function writeDisplayPreference(
  settings: RenderSettings | DisplayQuality,
  storage?: PreferenceStorage,
) {
  (storage ?? localStorage).setItem(
    key,
    JSON.stringify(typeof settings === 'string' ? presetSettings(settings) : settings),
  );
}
