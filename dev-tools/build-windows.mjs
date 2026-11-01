import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { cleanDist, inventory } from './clean-dist.mjs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败，退出码 ${result.status}`);
}
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('构建需要 Windows x64');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('需要 Node.js 22.12 或更高版本');
  const notes = await readFile(join(root, '.agent/docs/RELEASE_NOTES.txt'), 'utf8');
  if (!notes.includes(`Version ${pkg.version} |`)) throw new Error('发布记录缺少当前版本');
  await mkdir(join(root, 'test-results/builds'), { recursive: true });
  const stage = await mkdtemp(join(root, 'test-results/builds/windows-build-'));
  await mkdir(join(stage, 'desktop'), { recursive: true });
  for (const file of await readdir(join(root, 'desktop'))) {
    if (!file.endsWith('.ts')) continue;
    const source = await readFile(join(root, 'desktop', file), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      fileName: file,
    });
    await writeFile(join(stage, 'desktop', file.replace(/\.ts$/, '.js')), compiled.outputText);
  }
  await writeFile(
    join(stage, 'package.json'),
    JSON.stringify(
      {
        name: 'shanhe-map-editor',
        productName: 'ShanheMapEditor',
        version: pkg.version,
        description: 'Shanhe Map Editor',
        author: 'Shanhe Map Studio',
        main: 'desktop/main.js',
        type: 'commonjs',
        config: { forge: './forge.config.cjs' },
        devDependencies: { electron: pkg.devDependencies.electron },
      },
      null,
      2,
    ),
  );
  await cp(join(root, 'dev-tools/forge.config.cjs'), join(stage, 'forge.config.cjs'));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-b']);
  run(process.execPath, [
    join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--base=./',
    '--outDir',
    join(stage, 'renderer'),
  ]);
  run(process.execPath, [join(root, 'dev-tools/run-forge.cjs'), stage]);
  const packaged = join(stage, 'out/ShanheMapEditor-win32-x64');
  await access(join(packaged, 'ShanheMapEditor.exe'));
  const portable = join(stage, 'portable');
  await cp(packaged, portable, { recursive: true });
  await writeFile(
    join(portable, 'resources/build-inventory.json'),
    JSON.stringify(await inventory(portable), null, 2) + '\n',
  );
  const dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(pkg.version))
    throw new Error('版本号不适合用于发布目录');
  const releaseName = `mapEdtor-v${pkg.version}`;
  const target = join(dist, releaseName);
  const backup = join(stage, 'previous-release');
  let hadPrevious = false;
  try {
    await rename(target, backup);
    hadPrevious = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(portable, target);
  } catch (error) {
    if (hadPrevious) await rename(backup, target);
    throw error;
  }
  if (hadPrevious) console.log(`旧发布目录已保留：${backup}`);
  const legacy = JSON.parse(
    await readFile(join(root, 'dev-tools/legacy-dist-inventory.json'), 'utf8'),
  );
  await cleanDist(dist, releaseName, legacy);
  console.log(`Windows 便携版已生成：${target}`);
}
main().catch((error) => {
  console.error(`构建失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
