import { expect, it } from 'vitest';
import { Vector4 } from 'three';
import { createDocument } from '../src/core/document';
import { EditorSession } from '../src/application/editor-session';
import { encodeProject, decodeProject } from '../src/io/project';
import { SurfaceMaterial } from '../src/renderer/surface-material';

it('各地表参数独立，预览取消、撤销、旧值继承与保存往返正确', () => {
  const doc = createDocument();
  doc.surfaceMaterial.scale = 2.78;
  doc.surfaceMaterial.detail = 0.5;
  const session = new EditorSession(doc),
    weights = doc.surface.slice();
  session.previewSurfaceParameters({ scale: 1.4 });
  session.previewSurfaceParameters({ detail: 0.7 });
  expect(session.doc.surfaceMaterial.layers[0].scale).toBeUndefined();
  expect(session.surfacePreview?.layers[0].scale).toBe(1.4);
  session.cancelSurface();
  expect(session.history.canUndo).toBe(false);
  session.previewSurfaceParameters({ scale: 1.4, detail: 0.7 });
  session.commitSurface();
  expect(session.doc.surfaceMaterial.layers[0]).toMatchObject({ scale: 1.4, detail: 0.7 });
  expect(session.doc.surfaceMaterial.layers[1].scale).toBeUndefined();
  expect(session.doc.surfaceMaterial.scale).toBe(2.78);
  session.undo();
  expect(session.doc.surfaceMaterial.layers[0].scale).toBeUndefined();
  session.redo();
  const restored = decodeProject(encodeProject(session.doc));
  expect(restored.surfaceMaterial.layers[0]).toMatchObject({ scale: 1.4, detail: 0.7 });
  expect(restored.surfaceMaterial.layers[1].scale ?? restored.surfaceMaterial.scale).toBe(2.78);
  expect(restored.surface).toEqual(weights);
  session.previewSurfaceParameters({ scale: 3 });
  session.change('另一项修改', (doc) => {
    doc.name = '较新名称';
  });
  session.commitSurface();
  expect(session.doc.surfaceMaterial.layers[0].scale).toBe(1.4);
}, 120000);

it('实际采样尺度与细节系数按层传入，零强度及画质限制正确', () => {
  const doc = createDocument();
  doc.surfaceMaterial.scale = 2;
  doc.surfaceMaterial.layers[0].scale = 3;
  doc.surfaceMaterial.layers[0].detail = 0;
  doc.surfaceMaterial.layers[1].detail = 0.8;
  const material = new SurfaceMaterial(() => {});
  try {
    material.updateSettings(doc.surfaceMaterial);
    expect((material.uniforms.uSurfaceMeters.value as Vector4).toArray()).toEqual([24, 16, 32, 24]);
    expect(material.uniforms.uSurfaceLayerMeters0.value).toBe(24);
    expect(material.uniforms.uSurfaceLayerDetail0.value).toBe(0);
    expect(material.uniforms.uSurfaceLayerDetail1.value).toBe(1);
    expect(material.uniforms.uSurfaceDetail.value).toBe(0.8);
  } finally {
    material.dispose();
  }
});
