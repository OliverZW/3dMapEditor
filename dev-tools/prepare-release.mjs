import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const notes = await readFile(join(root, 'RELEASE_NOTES.txt'), 'utf8');
if (!notes.includes(`Version ${version} |`)) {
  throw new Error(`RELEASE_NOTES.txt is missing an entry for version ${version}`);
}

for (const [source, target] of [
  ['dev-tools/release/start-editor.bat', 'start-editor.bat'],
  ['dev-tools/release/release-server.ps1', 'release-server.ps1'],
  ['RELEASE_NOTES.txt', 'RELEASE_NOTES.txt'],
]) {
  await copyFile(join(root, source), join(root, 'dist', target));
}
