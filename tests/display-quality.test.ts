import { describe, it, expect } from 'vitest';
import { displayPixelRatio } from '../src/renderer/display-quality';
import { readDisplayPreference, writeDisplayPreference } from '../src/platform/display-preference';
import { CameraRig } from '../src/renderer/camera-rig';

describe('本机显示档位', () => {
  it('多种 Windows 缩放和超大窗口保持比例并限制流畅档像素预算', () => {
    for (const dpr of [0.8, 1, 1.25, 1.5, 1.75, 2, 3]) {
      for (const [width, height] of [
        [718, 600],
        [1600, 1000],
        [3840, 2160],
        [7680, 4320],
      ]) {
        const ratio = displayPixelRatio('fast', dpr, width, height);
        expect(ratio).toBeLessThanOrEqual(Math.min(dpr, 1) * 0.75);
        expect(Math.floor(width * ratio) * Math.floor(height * ratio)).toBeLessThanOrEqual(921600);
        expect(displayPixelRatio('balanced', dpr, width, height)).toBe(Math.min(dpr, 1));
        expect(displayPixelRatio('high', dpr, width, height)).toBe(Math.min(dpr, 1.75));
      }
    }
    expect(displayPixelRatio('fast', 1.25, 0, 0)).toBe(0.75);
  });
  it('首次默认流畅，记录可往返；损坏或不可用存储明确返回原因', () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    expect(readDisplayPreference(storage)).toEqual({ quality: 'fast' });
    writeDisplayPreference('balanced', storage);
    expect(readDisplayPreference(storage)).toEqual({ quality: 'balanced' });
    value = 'unknown';
    expect(readDisplayPreference(storage).warning).toContain('无效');
    const unavailable = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readDisplayPreference(unavailable).quality).toBe('fast');
    expect(readDisplayPreference(unavailable).warning).toContain('blocked');
    expect(() => writeDisplayPreference('high', unavailable)).toThrow('quota');
  });
  it('切换视口后恢复透视／正交、姿态、目标与缩放，并保持快照独立', () => {
    for (const orthographic of [false, true]) {
      const old = new CameraRig();
      old.resize(1038, 873);
      old.target.set(50, 70, -30);
      old.camera.position.set(400, 700, 600);
      old.camera.lookAt(old.target);
      if (orthographic) old.toggleProjection();
      old.camera.zoom = 1.7;
      old.camera.updateProjectionMatrix();
      const snapshot = old.captureView();
      const next = new CameraRig();
      next.resize(1038, 873);
      next.restoreView(snapshot);
      expect(next.projection).toBe(old.projection);
      expect(next.camera.position.toArray()).toEqual(old.camera.position.toArray());
      expect(next.camera.quaternion.toArray()).toEqual(old.camera.quaternion.toArray());
      expect(next.camera.projectionMatrix.toArray()).toEqual(old.camera.projectionMatrix.toArray());
      expect(next.target.toArray()).toEqual(old.target.toArray());
      expect(next.camera.zoom).toBe(1.7);
      old.target.x = 999;
      expect(snapshot.target.x).toBe(50);
    }
  });
});
