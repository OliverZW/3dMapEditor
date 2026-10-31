import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import {
  builtinResourceEntries,
  builtinResourceBytes,
  installBuiltinResources,
  prepareModelDocument,
  assetUrl,
} from '../src/io/builtin-resources';
import { createDocument, validateDocument } from '../src/core/document';
import { encodeProject, decodeProject } from '../src/io/project';

const files = Object.fromEntries(
  builtinResourceEntries.map((entry) => [
    entry.file,
    new Uint8Array(readFileSync(new URL('../editor-assets/' + entry.file, import.meta.url))),
  ]),
);

describe('统一内置素材', () => {
  it('模型、贴图和缩略图路径跟随部署基础路径', () => {
    vi.stubEnv('BASE_URL', '/map-editor/');
    try {
      expect(assetUrl('models/pine-tree.glb')).toBe('/map-editor/models/pine-tree.glb');
      expect(assetUrl('surface/grass-thumb.png')).toBe('/map-editor/surface/grass-thumb.png');
      expect(assetUrl('water/ripple-mask.png')).toBe('/map-editor/water/ripple-mask.png');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('八个文件模型、地表与水面实际文件和清单哈希一致', () => {
    expect(createDocument().assets).toHaveLength(8);
    expect(createDocument().assets.filter((asset) => asset.kind === 'tree')).toHaveLength(5);
    expect(new Set(builtinResourceEntries.map((entry) => entry.file)).size).toBe(
      builtinResourceEntries.length,
    );
    for (const entry of builtinResourceEntries) {
      expect(createHash('sha256').update(files[entry.file]).digest('hex')).toBe(entry.hash);
      expect(createHash('sha256').update(builtinResourceBytes(entry.hash)).digest('hex')).toBe(
        entry.hash,
      );
    }
    expect(assetUrl('models/pine-tree.glb')).toBe('/models/pine-tree.glb');
    expect(() => assetUrl('../outside.glb')).toThrow('路径无效');
  });
  it('缺失或损坏不会发布半组素材，错误包含文件名', () => {
    const first = builtinResourceEntries[0];
    const original = builtinResourceBytes(first.hash);
    expect(() => installBuiltinResources({ ...files, [first.file]: undefined })).toThrow(
      first.file,
    );
    const damaged = files[first.file].slice();
    damaged[damaged.length - 1] ^= 1;
    expect(() => installBuiltinResources({ ...files, [first.file]: damaged })).toThrow(
      '内容哈希不符',
    );
    expect(builtinResourceBytes(first.hash)).toBe(original);
  });
  it('备份只携带使用中的内置模型，恢复资源归工程所有', () => {
    const doc = prepareModelDocument(createDocument());
    const tree = doc.assets.find((asset) => asset.kind === 'tree');
    tree.scale = 1.25;
    doc.trees.push({ id: 1, assetId: tree.id, x: 0, z: 0, yaw: 0, scale: 1 });
    doc.nextId = 2;
    const bytes = encodeProject(doc),
      packed = unzipSync(bytes);
    const map = JSON.parse(strFromU8(packed['map.json']));
    expect(map.assets).toHaveLength(1);
    expect(packed[`assets/models/${tree.hash}.glb`]).toEqual(tree.bytes);
    const restored = decodeProject(bytes);
    expect(restored.assets).toHaveLength(1);
    expect(restored.assets[0].scale).toBe(1.25);
    expect(restored.assets[0].resource.origin).toBe('project');
    expect(createHash('sha256').update(restored.assets[0].bytes).digest('hex')).toBe(tree.hash);
    const old = createDocument();
    old.assets[0].hash = 'builtin-city-v1';
    expect(() => prepareModelDocument(old)).toThrow('缺少 GLB');
    expect(() => validateDocument(old)).toThrow('资源描述无效');
  });
});
