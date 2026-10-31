import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../editor-assets/models/manifest.json';
import { validateStaticGlb } from '../src/io/glb-validation';

it('离线 LOD 的原模型身份、面数、属性、材质与自包含图片有效', () => {
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  expect(manifest.assets.filter((asset) => asset.lod)).toHaveLength(6);
  for (const asset of manifest.assets.filter((asset) => asset.lod)) {
    const original = readFileSync(new URL('../editor-assets/' + asset.file, import.meta.url));
    expect(digest(original)).toBe(asset.lod.sourceHash);
    expect(asset.lod.sourceHash).toBe(asset.hash);
    for (const [level, entry] of asset.lod.levels.entries()) {
      const bytes = readFileSync(new URL('../editor-assets/' + entry.file, import.meta.url));
      expect(digest(bytes)).toBe(entry.hash);
      expect(() => validateStaticGlb(bytes)).not.toThrow();
      const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
      let triangles = 0;
      for (const mesh of json.meshes)
        for (const primitive of mesh.primitives) {
          triangles += json.accessors[primitive.indices].count / 3;
          expect(json.accessors[primitive.attributes.POSITION].count).toBeGreaterThan(0);
          expect(json.accessors[primitive.attributes.NORMAL].count).toBe(
            json.accessors[primitive.attributes.POSITION].count,
          );
          expect(primitive.material).toBeLessThan(json.materials.length);
        }
      expect(triangles).toBe(entry.triangles);
      expect(triangles).toBeLessThan(asset.triangles * (level === 0 ? 0.3 : 0.1));
    }
  }
});
