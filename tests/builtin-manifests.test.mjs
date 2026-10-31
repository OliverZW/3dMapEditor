import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { normalizePath } from 'vite';
import config from '../vite.config';

const plugin = config.plugins.find((entry) => entry.name === 'builtin-manifests');
const importer = fileURLToPath(new URL('../src/core/surface-material.ts', import.meta.url));
const manifest = fileURLToPath(new URL('../editor-assets/surface/manifest.json', import.meta.url));

describe('内置清单开发服务缓存', () => {
  it('解析、加载和热更新使用相同的规范路径，Windows 分隔符不导致旧模块残留', () => {
    const id = plugin.resolveId('../../editor-assets/surface/manifest.json', importer);
    expect(id).toBe('\0builtin-manifest:' + normalizePath(manifest) + '.js');
    expect(id).not.toContain('\\');
    const module = { id };
    const getModuleById = vi.fn((key) => (key === id ? module : undefined));
    const invalidateModule = vi.fn(),
      send = vi.fn();
    expect(
      plugin.handleHotUpdate({
        file: manifest,
        server: {
          moduleGraph: { getModuleById, invalidateModule },
          ws: { send },
        },
      }),
    ).toEqual([]);
    expect(getModuleById).toHaveBeenCalledWith(id);
    expect(invalidateModule).toHaveBeenCalledWith(module);
    expect(send).toHaveBeenCalledWith({ type: 'full-reload' });
    const addWatchFile = vi.fn();
    const code = plugin.load.call({ addWatchFile }, id);
    const data = JSON.parse(code.slice('export default '.length, -1));
    expect(data).toMatchObject({ scale: 1, detail: 0.25, slopeRock: true });
    expect(addWatchFile).toHaveBeenCalledWith(normalizePath(manifest));
  });
});
