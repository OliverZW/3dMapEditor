import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { expect, it } from 'vitest';
import { createDocument, validateDocument } from '../src/core/document';
import { addSurfaceLayer, deleteSurfaceLayer } from '../src/core/surface-layers';
import { EditorSession } from '../src/application/editor-session';
import { encodeProject, decodeProject } from '../src/io/project';
import { prepareResize } from '../src/core/map-resize';

it('八层增删合并、历史、工程往返和地形调整保持权重', () => {
  const session = new EditorSession(createDocument());
  for (let i = 4; i < 8; i++)
    session.change('添加地表', (doc) =>
      addSurfaceLayer(doc, { ...doc.surfaceMaterial.layers[0], name: `地表${i}` }, `layer-${i}`),
    );
  expect(session.error).toBe('');
  session.change('涂刷', (doc) => {
    doc.surface[0] = 100;
    doc.surface[7] = 155;
  });
  const old = session.doc.surface.slice();
  session.change('删除草地', (doc) => deleteSurfaceLayer(doc, 'grass', 'layer-7'));
  expect(session.doc.surface[6]).toBe(255);
  expect(session.doc.surfaceMaterial.layers).toHaveLength(7);
  session.undo();
  expect(session.doc.surface).toEqual(old);
  session.redo();
  expect(session.doc.surface[6]).toBe(255);
  const restored = decodeProject(encodeProject(session.doc));
  expect(restored.surface).toEqual(session.doc.surface);
  expect(restored.surfaceMaterial.layers.map((layer) => layer.id)).toEqual(
    session.doc.surfaceMaterial.layers.map((layer) => layer.id),
  );
  const resized = prepareResize(restored, 1024, 1024).document;
  expect(() => validateDocument(resized)).not.toThrow();
  expect(() =>
    addSurfaceLayer(restored, restored.surfaceMaterial.layers[0], 'layer-8'),
  ).not.toThrow();
  expect(() => addSurfaceLayer(restored, restored.surfaceMaterial.layers[0], 'layer-9')).toThrow(
    '8',
  );
}, 120000);

it('预设均可删除，显岩引用转移，最后一层受保护', () => {
  const doc = createDocument();
  deleteSurfaceLayer(doc, 'rock', 'grass');
  expect(doc.surfaceMaterial.slopeLayerId).toBe('grass');
  deleteSurfaceLayer(doc, 'soil', 'grass');
  deleteSurfaceLayer(doc, 'sand', 'grass');
  expect(doc.surfaceMaterial.layers).toHaveLength(1);
  expect(() => validateDocument(doc)).not.toThrow();
  expect(() => deleteSurfaceLayer(doc, 'grass', 'grass')).toThrow();
});

it('旧 v4 四层备份按原权重和贴图迁移，重新保存采用 v5', () => {
  const doc = createDocument();
  const files = unzipSync(encodeProject(doc));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  manifest.formatVersion = 4;
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const map = JSON.parse(strFromU8(files['map.json']));
  map.formatVersion = 3;
  files['map.json'] = strToU8(JSON.stringify(map));
  const restored = decodeProject(zipSync(files));
  expect(restored.surface).toEqual(doc.surface);
  expect(restored.surfaceMaterial.layers.map((layer) => layer.color.hash)).toEqual(
    doc.surfaceMaterial.layers.map((layer) => layer.color.hash),
  );
  expect(
    JSON.parse(strFromU8(unzipSync(encodeProject(restored))['manifest.json'])).formatVersion,
  ).toBe(5);
}, 120000);
