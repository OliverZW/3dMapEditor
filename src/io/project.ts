import { zipSync, unzipSync, strToU8 } from 'fflate';
import type { MapDocument } from '../core/types';
import { snapshot } from '../core/history';
import {
  encodeProjectFiles,
  decodeProjectFiles,
  parseJson,
  validateRelativePath,
} from './project-codec';

export { floatBytes, uintBytes } from './project-binary';
/** v4 的数据文件与目录工程共用；manifest 是独立的备份契约。 */
export function encodeProject(doc: MapDocument): Uint8Array {
  if (!doc.name.trim() || doc.name !== doc.name.trim() || doc.name.length > 128)
    throw new Error('工程名称无效');
  const files = encodeProjectFiles(snapshot(doc), true);
  files['manifest.json'] = strToU8(
    JSON.stringify({ format: 'map3d-backup', formatVersion: 4, name: doc.name }),
  );
  const bytes = zipSync(files, { level: 6 });
  if (bytes.length > 256 * 1024 * 1024) throw new Error('工程包超过 256 MiB');
  return bytes;
}
export function decodeProject(bytes: Uint8Array): MapDocument {
  if (bytes.length > 256 * 1024 * 1024) throw new Error('工程包超过 256 MiB');
  let total = 0,
    count = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (file) => {
      validateRelativePath(file.name);
      if (names.has(file.name)) throw new Error('工程包含重复路径');
      names.add(file.name);
      total += file.originalSize;
      if (!Number.isSafeInteger(total) || total > 512 * 1024 * 1024 || ++count > 4096)
        throw new Error('工程解压预算超限');
      return true;
    },
  });
  if (!files['manifest.json']) throw new Error('工程缺少 manifest.json');
  const manifest = parseJson(files['manifest.json'], 'manifest.json');
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('formatVersion' in manifest) ||
    manifest.formatVersion !== 4 ||
    !('format' in manifest) ||
    manifest.format !== 'map3d-backup'
  )
    throw new Error('不支持的工程版本：仅接受 v4 备份，不兼容旧版 .map3d');
  if (!('name' in manifest) || typeof manifest.name !== 'string') throw new Error('工程名称无效');
  return decodeProjectFiles(files, manifest.name, true);
}
