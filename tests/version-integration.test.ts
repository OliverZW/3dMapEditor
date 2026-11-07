import { expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { EditorSession } from '../src/application/editor-session';
import { snapshot } from '../src/core/history';
import { encodeProject, decodeProject } from '../src/io/project';
import { encodeProjectFiles, decodeProjectFiles } from '../src/io/project-codec';
import { resourcePath } from '../src/io/project-resources';
import { exportCocos } from '../src/io/cocos-export';
import { imageHash } from '../src/io/image-validation';
import { addTreeLayer } from '../src/core/tree-layers';

it('完整地图与自定义资源目录、备份及引擎导出一致', async () => {
  const session = new EditorSession();
  const source = session.doc.assets.find((asset) => asset.kind === 'tree')!;
  const model = {
    ...source,
    id: 'integration-tree',
    name: '集成树',
    builtin: undefined,
    resource: { origin: 'project' as const, path: resourcePath(source.hash, true) },
  };
  session.addAsset(model, session.documentVersion);
  const original = session.doc.surfaceMaterial.layers[0];
  const owned = (image: typeof original.color) => ({
    ...image,
    resource: { origin: 'project' as const, path: resourcePath(image.hash, false) },
  });
  const material = {
    id: 'surface-integration',
    name: '集成材质',
    meters: 18,
    color: owned(original.color),
    normal: owned(original.normal),
  };
  session.change('集成测试变更', (doc) => {
    doc.heights[0] = 45;
    doc.surface[0] = 50;
    doc.surface[1] = 205;
    doc.trees[0].assetId = model.id;
    doc.trees[0].layerId = addTreeLayer(doc, model.id).id;
    doc.surfaceMaterial.library = [material];
    doc.surfaceMaterial.layers[0] = { ...material, id: 'grass', materialId: material.id };
  });
  expect(session.error).toBe('');
  const before = snapshot(session.doc);
  session.undo();
  expect(session.doc.heights[0]).not.toBe(45);
  session.redo();
  const directory = decodeProjectFiles(encodeProjectFiles(session.doc), session.doc.name);
  const backupFiles = encodeProject(session.doc);
  const restored = decodeProject(backupFiles);
  for (const result of [directory, restored]) {
    expect(result.heights).toEqual(before.heights);
    expect(result.surface).toEqual(before.surface);
    expect(result.owners).toEqual(before.owners);
    expect(result.trees).toEqual(before.trees);
    expect(result.sites).toEqual(before.sites);
    expect(result.grass.map((item) => item.density)).toEqual(
      before.grass.map((item) => item.density),
    );
    expect(result.surfaceMaterial.library?.[0].color.hash).toBe(material.color.hash);
    expect(result.assets.find((asset) => asset.id === model.id)?.hash).toBe(model.hash);
  }
  const exported = unzipSync(
    (
      await exportCocos(restored, {
        trees: true,
        grass: true,
        sites: true,
        logic: true,
        water: true,
      })
    ).bytes,
  );
  const surface = JSON.parse(strFromU8(exported['materials/surface.json']));
  expect(imageHash(exported[surface.layers[0].color.path])).toBe(material.color.hash);
  expect(imageHash(exported[`models/${model.hash}.glb`])).toBe(model.hash);
}, 120000);
