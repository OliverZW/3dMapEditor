import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export async function listFiles(dir, base = dir, rejectEmpty = false) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  if (rejectEmpty && entries.length === 0) throw new Error(`保留空目录：${dir}`);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path, base, rejectEmpty)));
    else if (entry.isFile()) files.push(relative(base, path).split(sep).join('/'));
    else throw new Error(`不支持的发布文件：${path}`);
  }
  return files;
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inventory(dir, exclude = [], rejectEmpty = false) {
  const files = (await listFiles(dir, dir, rejectEmpty))
    .filter((file) => !exclude.includes(file))
    .sort();
  const result = {};
  for (const file of files) result[file] = await digest(join(dir, file));
  return result;
}

async function matches(dir, expected, excluded = []) {
  const actual = await inventory(dir, excluded, true);
  const keys = Object.keys(expected).sort();
  return (
    JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(keys) &&
    keys.every((key) => actual[key] === expected[key])
  );
}

export async function cleanDist(dist, current, legacy) {
  const root = resolve(dist);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === current) continue;
    const path = resolve(root, entry.name);
    if (relative(root, path) !== entry.name || path === root) throw new Error('清理路径越界');
    const legacyFiles = Object.entries(legacy).filter(([key]) => key.split('/')[0] === entry.name);
    try {
      let safe = false;
      if (legacyFiles.length && entry.isFile()) {
        safe = legacyFiles.length === 1 && (await digest(path)) === legacyFiles[0][1];
      } else if (legacyFiles.length && entry.isDirectory()) {
        const expected = Object.fromEntries(
          legacyFiles.map(([key, hash]) => [key.slice(entry.name.length + 1), hash]),
        );
        safe = await matches(path, expected);
      } else if (
        entry.isDirectory() &&
        /^mapEdtor-v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(entry.name)
      ) {
        let inventoryPath = 'resources/build-inventory.json';
        let content;
        try {
          content = await readFile(join(path, inventoryPath), 'utf8');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          inventoryPath = 'app/build-inventory.json';
          content = await readFile(join(path, inventoryPath), 'utf8');
        }
        const manifest = JSON.parse(content);
        safe =
          manifest &&
          typeof manifest === 'object' &&
          !Array.isArray(manifest) &&
          (await matches(path, manifest, [inventoryPath]));
      }
      if (safe) {
        await rm(path, { recursive: entry.isDirectory(), force: false });
        console.log(`已清理旧构建：${path}`);
      } else console.warn(`保留未确认或已修改的文件：${path}`);
    } catch (error) {
      console.warn(`保留无法校验的文件：${path}（${error.message}）`);
    }
  }
}
