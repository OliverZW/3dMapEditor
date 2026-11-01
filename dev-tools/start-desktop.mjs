import { createServer } from 'vite';
import ts from 'typescript';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function startDesktopEnvironment() {
  const runtime = resolve(root, 'test-results/cache/desktop-runtime');
  await mkdir(runtime, { recursive: true });
  for (const file of await readdir(resolve(root, 'desktop'))) {
    if (!file.endsWith('.ts')) continue;
    const source = await readFile(resolve(root, 'desktop', file), 'utf8');
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      fileName: file,
    });
    await writeFile(resolve(runtime, file.replace(/\.ts$/, '.js')), result.outputText);
  }
  await writeFile(
    resolve(runtime, 'package.json'),
    JSON.stringify({ main: 'main.js', type: 'commonjs' }),
  );
  const server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 5173, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('无法取得桌面开发端口');
  }
  return { runtime, url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const environment = await startDesktopEnvironment();
  const require = createRequire(import.meta.url),
    variables = { ...process.env, MAP_EDITOR_DEV_URL: environment.url };
  delete variables.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [environment.runtime], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: variables,
  });
  const finish = async (code) => {
    await environment.close();
    process.exitCode = code ?? 1;
  };
  child.once('error', (error) => {
    console.error(error.message);
    void finish(1);
  });
  child.once('exit', (code) => void finish(code));
  process.once('SIGINT', () => {
    child.kill();
    void environment.close();
  });
  process.once('SIGTERM', () => {
    child.kill();
    void environment.close();
  });
}
