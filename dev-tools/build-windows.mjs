import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
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
    throw new Error('MSI 构建需要 Windows x64');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('需要 Node.js 22.12 或更高版本');
  for (const name of ['candle.exe', 'light.exe']) {
    if (spawnSync('where.exe', [name], { stdio: 'ignore', windowsHide: true }).status !== 0)
      throw new Error(`未找到 ${name}；请安装 WiX Toolset 3.14 并将其 bin 目录加入 PATH`);
  }
  const forge = join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js');
  await access(forge).catch(() => {
    throw new Error('缺少 Electron Forge，先在项目目录运行 npm ci');
  });
  const notes = await readFile(join(root, 'RELEASE_NOTES.txt'), 'utf8');
  if (!notes.includes(`Version ${pkg.version} |`)) throw new Error('发布记录缺少当前版本');
  console.warn('注意：内置研究素材仅限本机使用，本构建不得公开分发。');
  const tmp = join(root, 'test-results');
  await mkdir(tmp, { recursive: true });
  const stage = await mkdtemp(join(tmp, 'windows-build-'));
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
  await cp(join(root, 'forge.config.cjs'), join(stage, 'forge.config.cjs'));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-b']);
  run(process.execPath, [
    join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--base=./',
    '--outDir',
    join(stage, 'renderer'),
  ]);
  run(process.execPath, [join(root, 'dev-tools/run-forge.cjs'), stage], { cwd: stage });
  const output = join(stage, 'out/make/wix/x64');
  const files = (await readdir(output)).filter((name) => name.toLowerCase().endsWith('.msi'));
  if (files.length !== 1) throw new Error('构建未生成唯一 MSI 文件');
  const dist = join(root, 'dist/windows');
  await mkdir(dist, { recursive: true });
  const target = join(dist, `ShanheMapEditor-${pkg.version}-x64.msi`);
  await copyFile(join(output, files[0]), target);
  await copyFile(join(root, 'RELEASE_NOTES.txt'), join(dist, 'RELEASE_NOTES.txt'));
  console.log(`Windows MSI 已生成：${target}`);
}
main().catch((error) => {
  console.error(`构建失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
