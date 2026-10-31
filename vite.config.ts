import { defineConfig, normalizePath } from 'vite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineValidatorPlugin } from './dev-tools/engine-validator-plugin.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const manifests = new Set(
  ['models', 'surface', 'water'].map((kind) =>
    normalizePath(resolve(root, `editor-assets/${kind}/manifest.json`)),
  ),
);
const prefix = '\0builtin-manifest:';

export default defineConfig({
  publicDir: 'editor-assets',
  optimizeDeps: { include: ['ajv/dist/runtime/equal.js', 'ajv/dist/runtime/ucs2length.js'] },
  // 素材文件照常静态发布；仅将纯描述编译为模块，不在 src 复制清单。
  plugins: [
    engineValidatorPlugin(),
    {
      name: 'builtin-manifests',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer || !source.endsWith('/manifest.json')) return;
        const file = normalizePath(resolve(dirname(importer.split('?')[0]), source));
        if (manifests.has(file)) return prefix + file + '.js';
      },
      load(id) {
        if (!id.startsWith(prefix)) return;
        const file = id.slice(prefix.length, -3);
        this.addWatchFile(file);
        return `export default ${JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))};`;
      },
      handleHotUpdate(context) {
        const file = normalizePath(resolve(context.file));
        if (!manifests.has(file)) return;
        const module = context.server.moduleGraph.getModuleById(prefix + file + '.js');
        if (module) context.server.moduleGraph.invalidateModule(module);
        context.server.ws.send({ type: 'full-reload' });
        return [];
      },
    },
  ],
});
