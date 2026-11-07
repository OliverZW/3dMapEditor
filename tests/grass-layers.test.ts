import { expect, it } from 'vitest';
import { EditorSession } from '../src/application/editor-session';
import { createDocument } from '../src/core/document';
import { encodeProject, decodeProject } from '../src/io/project';
import { generateGrass } from '../src/core/vegetation';

it('同模型多草层涂刷隔离，替换保留密度、种子及生成位置，删除可撤销', () => {
  const session = new EditorSession(createDocument());
  const asset = session.doc.assets.find((item) => item.kind === 'grass')!;
  session.addGrassLayer(asset.id);
  const firstId = session.grassLayer!.id;
  session.setTool('grass');
  session.pointerDown({ x: 0, z: 0 }, false);
  session.endStroke();
  const density = session.grassLayer!.density.slice();
  const seed = session.grassLayer!.seed;
  const positions = generateGrass(
    session.doc,
    session.heights,
    session.grassLayer!,
    { x: 0, z: 0 },
    10,
  );
  expect(positions.length).toBeGreaterThan(0);
  session.addGrassLayer(asset.id);
  const secondId = session.grassLayer!.id;
  session.pointerDown({ x: 0, z: 0 }, true);
  session.endStroke();
  expect(session.doc.grass.find((layer) => layer.id === firstId)!.density).toEqual(density);
  expect(session.grassLayer!.density.every((value) => value === 0)).toBe(true);
  session.addAsset({ ...asset, id: 'grass-test', name: '替换草' }, session.documentVersion);
  session.replaceGrassLayerModel(firstId, 'grass-test');
  expect(session.error).toBe('');
  expect(session.grassLayer!.density).toEqual(density);
  expect(session.grassLayer!.seed).toBe(seed);
  expect(
    generateGrass(session.doc, session.heights, session.grassLayer!, { x: 0, z: 0 }, 10).map(
      ({ assetId: _, ...tree }) => tree,
    ),
  ).toEqual(positions.map(({ assetId: _, ...tree }) => tree));
  const restored = decodeProject(encodeProject(session.doc));
  expect(restored.grass.map((layer) => layer.id)).toEqual([firstId, secondId]);
  expect(restored.grass[0].density).toEqual(density);
  session.deleteGrassLayer(firstId);
  expect(session.doc.grass).toHaveLength(1);
  session.undo();
  expect(session.doc.grass[0].density).toEqual(density);
  expect(session.doc.grass[0].assetId).toBe('grass-test');
  session.redo();
  session.deleteGrassLayer(secondId);
  expect(session.brushAsset('grass')).toBeUndefined();
  session.pointerDown({ x: 0, z: 0 }, false);
  session.endStroke();
  expect(session.doc.grass).toHaveLength(0);
  session.addGrassLayer(asset.id);
  expect(session.error).toBe('');
}, 120000);

it('无效模型替换不污染密度和历史', () => {
  const session = new EditorSession();
  const layer = session.grassLayer!;
  const density = layer.density.slice();
  session.replaceGrassLayerModel(layer.id, 'tree-pine');
  expect(session.error).not.toBe('');
  expect(session.doc.grass[0].density).toEqual(density);
  expect(session.doc.grass[0].assetId).toBe(layer.assetId);
});
