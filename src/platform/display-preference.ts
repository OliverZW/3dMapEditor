import { isDisplayQuality } from '../renderer/display-quality';
import type { DisplayQuality } from '../renderer/display-quality';

const key = 'shanhe.display-quality.v1';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readDisplayPreference(storage?: PreferenceStorage): {
  quality: DisplayQuality;
  warning?: string;
} {
  try {
    const value = (storage ?? localStorage).getItem(key);
    if (value === null) return { quality: 'fast' };
    if (isDisplayQuality(value)) return { quality: value };
    return { quality: 'fast', warning: '本机显示档位记录无效，已使用流畅档。' };
  } catch (error) {
    return { quality: 'fast', warning: `无法读取本机显示档位，已使用流畅档：${String(error)}` };
  }
}

export function writeDisplayPreference(quality: DisplayQuality, storage?: PreferenceStorage) {
  (storage ?? localStorage).setItem(key, quality);
}
