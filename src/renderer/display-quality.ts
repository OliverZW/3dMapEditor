export type DisplayQuality = 'fast' | 'balanced' | 'high';
export type ShadowSize = 512 | 1024 | 2048;

export function isShadowSize(value: unknown): value is ShadowSize {
  return value === 512 || value === 1024 || value === 2048;
}

export interface RenderSettings {
  quality: DisplayQuality;
  shadows: boolean;
  shadowSize: ShadowSize;
  treeShadows: boolean;
  antialias: boolean;
  simplifiedSurface: boolean;
  demandRendering: boolean;
}

export function presetSettings(quality: DisplayQuality): RenderSettings {
  const { shadows, shadowSize, antialias, simplifiedSurface } = DISPLAY_QUALITIES[quality];
  return {
    quality,
    shadows,
    shadowSize,
    treeShadows: true,
    antialias,
    simplifiedSurface,
    demandRendering: true,
  };
}

export const DISPLAY_QUALITIES = {
  fast: {
    label: '流畅',
    antialias: false,
    shadows: false,
    shadowSize: 1024,
    anisotropy: 1,
    normalDetail: false,
    simplifiedSurface: true,
  },
  balanced: {
    label: '均衡',
    antialias: false,
    shadows: true,
    shadowSize: 1024,
    anisotropy: 4,
    normalDetail: true,
    simplifiedSurface: false,
  },
  high: {
    label: '高画质',
    antialias: true,
    shadows: true,
    shadowSize: 2048,
    anisotropy: 4,
    normalDetail: true,
    simplifiedSurface: false,
  },
} as const;

export function isDisplayQuality(value: unknown): value is DisplayQuality {
  return value === 'fast' || value === 'balanced' || value === 'high';
}

/** 仅缩小绘制缓冲；CSS 视口及拾取坐标保持不变。 */
export function displayPixelRatio(
  quality: DisplayQuality,
  dpr: number,
  width: number,
  height: number,
) {
  if (quality === 'high') return Math.min(dpr, 1.75);
  if (quality === 'balanced') return Math.min(dpr, 1);
  const base = Math.min(dpr, 1) * 0.75;
  return width > 0 && height > 0 ? Math.min(base, Math.sqrt(921600 / (width * height))) : base;
}
