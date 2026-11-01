import { it, expect } from 'vitest';
import { EditorSession } from '../src/application/editor-session';
import {
  surfaceTextures,
  replaceSurfaceTexture,
  textureLocations,
} from '../src/core/surface-textures';
import { encodeProject, decodeProject } from '../src/io/project';

it('单张替换保留其他参数和权重，历史与贴图库可往返', () => {
  const session = new EditorSession();
  const original = session.doc.surfaceMaterial.layers[0];
  const originalColor = original.color.hash;
  const normal = original.normal.hash;
  const color = session.doc.surfaceMaterial.layers[1].color;
  const weights = session.doc.surface.slice();
  session.change('单张替换', (doc) => replaceSurfaceTexture(doc, original.id, 'color', color));
  expect(session.error).toBe('');
  expect(session.doc.surfaceMaterial.layers[0].normal.hash).toBe(normal);
  expect(session.doc.surfaceMaterial.layers[0].name).toBe(original.name);
  expect(session.doc.surface).toEqual(weights);
  session.undo();
  expect(session.doc.surfaceMaterial.layers[0].color.hash).toBe(originalColor);
  session.redo();
  expect(session.doc.surfaceMaterial.layers[0].color.hash).toBe(color.hash);
  session.change('保存贴图库', (doc) => {
    doc.surfaceMaterial.textures = [
      { id: 'texture-test', name: '测试颜色', kind: 'color', image: { ...color } },
    ];
  });
  const restored = decodeProject(encodeProject(session.doc));
  expect(restored.surfaceMaterial.textures?.[0].image.bytes).toEqual(color.bytes);
  expect(
    surfaceTextures(restored).filter(
      (item) => item.kind === 'color' && item.image.hash === color.hash,
    ),
  ).toHaveLength(1);
  expect(textureLocations(restored, 'color', color.hash)).toContain(original.name);
  expect(() =>
    replaceSurfaceTexture(restored, original.id, 'color', { ...color, width: 2, height: 2 }),
  ).toThrow('尺寸');
  expect(() => replaceSurfaceTexture(restored, 'missing', 'color', color)).toThrow('不存在');
}, 120000);
