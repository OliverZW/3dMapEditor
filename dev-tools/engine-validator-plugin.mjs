import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';

/** 在开发/构建进程编译可信契约，渲染进程只执行静态函数，不需要 unsafe-eval。 */
export function engineValidatorPlugin() {
  const id = '\0engine-export-validators';
  const schemaPath = fileURLToPath(
    new URL('../.agent/docs/contracts/engine-export-v2.schema.json', import.meta.url),
  );
  return {
    name: 'engine-export-validators',
    resolveId(source) {
      if (source === 'virtual:engine-export-validators') return id;
    },
    load(source) {
      if (source !== id) return;
      this.addWatchFile(schemaPath);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      const ajv = new Ajv({
        allErrors: true,
        strict: true,
        strictTypes: false,
        strictRequired: false,
        code: { source: true, esm: true },
      });
      ajv.addSchema(schema);
      const definitions = ['', ...Object.keys(schema.definitions)];
      const references = Object.fromEntries(
        definitions.map((name, index) => [
          `validator${index}`,
          schema.$id + (name ? '#/definitions/' + name : ''),
        ]),
      );
      let code = standaloneCode(ajv, references);
      const helpers = new Map();
      code = code.replace(/require\("([^"]+)"\)(\.default)?/g, (_match, helper, defaultExport) => {
        if (!helpers.has(helper)) helpers.set(helper, `runtimeHelper${helpers.size}`);
        const name = helpers.get(helper);
        // Vite 浏览器环境可能把 CommonJS exports.default 包装成对象；Node 环境可能直接给出函数。
        return defaultExport ? `(${name}.default ?? ${name})` : name;
      });
      const imports = [...helpers]
        .map(
          ([helper, name]) =>
            `import ${name} from ${JSON.stringify(helper + (helper.endsWith('.js') ? '' : '.js'))};`,
        )
        .join('\n');
      return (
        imports +
        '\n' +
        code +
        '\nexport const validators = {' +
        definitions.map((name, index) => `${JSON.stringify(name)}:validator${index}`).join(',') +
        '};'
      );
    },
    handleHotUpdate(context) {
      if (context.file.replaceAll('\\', '/') !== schemaPath.replaceAll('\\', '/')) return;
      const module = context.server.moduleGraph.getModuleById(id);
      if (module) context.server.moduleGraph.invalidateModule(module);
      context.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
