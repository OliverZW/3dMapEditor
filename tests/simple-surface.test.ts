import { afterEach, describe, expect, it, vi } from 'vitest';
import { SurfaceMaterial } from '../src/renderer/surface-material';
import { acquireSurfaceMacro, surfaceMacroPixels } from '../src/renderer/surface-macro';
import { DISPLAY_QUALITIES } from '../src/renderer/display-quality';
import { createDocument } from '../src/core/document';
import { prepareSurfaceDocument } from '../src/io/surface-resources';

afterEach(() => vi.unstubAllGlobals());

describe('流畅地表与派生纹理', () => {
  it('宏观纹理确定、具有变化并在重复边界连续', () => {
    const a = surfaceMacroPixels();
    expect(a).toEqual(surfaceMacroPixels());
    expect(
      Math.max(...a.filter((_, i) => i % 4 === 0)) - Math.min(...a.filter((_, i) => i % 4 === 0)),
    ).toBeGreaterThan(80);
    let maxEdge = 0;
    for (let i = 0; i < 128; i++)
      for (let channel = 0; channel < 2; channel++) {
        maxEdge = Math.max(
          maxEdge,
          Math.abs(a[i * 128 * 4 + channel] - a[(i * 128 + 127) * 4 + channel]),
          Math.abs(a[i * 4 + channel] - a[(127 * 128 + i) * 4 + channel]),
        );
      }
    expect(maxEdge).toBeLessThan(45);
  });
  it('共享宏观纹理仅在最后引用释放时回收，重复释放无副作用', () => {
    const first = acquireSurfaceMacro(),
      second = acquireSurfaceMacro();
    expect(first.texture).toBe(second.texture);
    const dispose = vi.fn();
    first.texture.addEventListener('dispose', dispose);
    first.release();
    first.release();
    expect(dispose).not.toHaveBeenCalled();
    second.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    const next = acquireSurfaceMacro();
    expect(next.texture).not.toBe(first.texture);
    next.release();
  });
  it('流畅档只解码颜色；更换未使用法线不重载，更新与销毁不改文档', async () => {
    const close = vi.fn();
    const decode = vi.fn(async () => ({ close }));
    vi.stubGlobal('createImageBitmap', decode);
    const doc = prepareSurfaceDocument(createDocument());
    const before = doc.surface.slice();
    const material = new SurfaceMaterial(() => {}, false, false, DISPLAY_QUALITIES.fast);
    try {
      material.update(doc);
      await vi.waitFor(() => expect(material.ready).toBe(true));
      const colors = new Set(doc.surfaceMaterial.layers.map((layer) => layer.color.hash));
      expect(decode).toHaveBeenCalledTimes(colors.size);
      expect(material.material.type).toBe('MeshLambertMaterial');
      const key = material.resourceVersion;
      const preview = {
        ...doc,
        surfaceMaterial: {
          ...doc.surfaceMaterial,
          layers: doc.surfaceMaterial.layers.map((layer, index) => ({
            ...layer,
            normal: doc.surfaceMaterial.layers[(index + 1) % 4].normal,
          })),
        },
      };
      material.updateResources(preview);
      expect(material.ready).toBe(true);
      expect(material.resourceVersion).toBe(key);
      material.updateSettings({ scale: 2, detail: 1, slopeRock: false });
      expect(material.uniforms.uSurfaceDetail.value).toBe(0);
      expect(doc.surfaceMaterial.scale).toBe(1);
      expect(doc.surface).toEqual(before);
    } finally {
      material.dispose();
    }
    expect(close).toHaveBeenCalledTimes(
      new Set(doc.surfaceMaterial.layers.map((layer) => layer.color.hash)).size,
    );
  });
  it('均衡与高画质保持 Standard 材质和原程序标识', () => {
    for (const quality of ['balanced', 'high'] as const) {
      const material = new SurfaceMaterial(() => {}, false, false, DISPLAY_QUALITIES[quality]);
      expect(material.material.type).toBe('MeshStandardMaterial');
      expect(material.material.customProgramCacheKey()).toBe('surface-exact-v3');
      material.dispose();
    }
  });
});
