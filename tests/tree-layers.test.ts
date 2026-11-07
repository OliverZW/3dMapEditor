import { expect, it } from 'vitest';
import { EditorSession } from '../src/application/editor-session';
import { createDocument, validateDocument } from '../src/core/document';
import { prepareTreeLayers } from '../src/core/tree-layers';
import { encodeProject, decodeProject } from '../src/io/project';
import { assetReferenceCounts } from '../src/core/assets';

it('旧地图按模型归层，保留实例身份和位置', () => {
  const doc = createDocument();
  doc.trees = [{ id: doc.nextId++, assetId: 'tree-pine', x: 0, z: 0, yaw: 1, scale: 0.9 }];
  const original = { ...doc.trees[0] };
  prepareTreeLayers(doc);
  expect(doc.trees[0]).toMatchObject(original);
  expect(doc.treeLayers?.find((layer) => layer.id === doc.trees[0].layerId)?.assetId).toBe(
    'tree-pine',
  );
  expect(() => validateDocument(doc)).not.toThrow();
});

it('同模型独立图层替换、删除、历史和工程往返', () => {
  const session = new EditorSession(createDocument());
  session.addTreeLayer('tree-pine');
  const first = session.treeLayer!;
  session.addTreeLayer('tree-pine');
  const second = session.treeLayer!;
  session.change('放置测试树木', (doc) => {
    for (const layer of [first, second])
      doc.trees.push({
        id: doc.nextId++,
        layerId: layer.id,
        assetId: layer.assetId,
        x: 0,
        z: 0,
        yaw: 1,
        scale: 0.8,
      });
  });
  const ids = session.doc.trees.map((tree) => tree.id);
  session.replaceTreeLayerModel(first.id, 'tree-broad');
  expect(session.error).toBe('');
  expect(session.doc.trees.map((tree) => tree.assetId)).toEqual(['tree-broad', 'tree-pine']);
  expect(session.doc.trees.map((tree) => tree.id)).toEqual(ids);
  session.undo();
  expect(session.doc.trees.map((tree) => tree.assetId)).toEqual(['tree-pine', 'tree-pine']);
  session.redo();
  session.deleteTreeLayer(first.id);
  expect(session.doc.trees.map((tree) => tree.id)).toEqual([ids[1]]);
  session.undo();
  expect(session.doc.trees.map((tree) => tree.id)).toEqual(ids);
  const restored = decodeProject(encodeProject(session.doc));
  expect(restored.treeLayers).toEqual(session.doc.treeLayers);
  expect(restored.trees).toEqual(session.doc.trees);
  for (const layer of [...session.doc.treeLayers!]) session.deleteTreeLayer(layer.id);
  expect(session.brushAsset('tree')).toBeUndefined();
  const empty = new EditorSession(decodeProject(encodeProject(session.doc)));
  expect(empty.doc.treeLayers).toEqual([]);
  empty.replace(empty.doc, true);
  empty.addTreeLayer('tree-pine');
  expect(assetReferenceCounts(empty.doc).get('tree-pine')).toBe(1);
  expect(empty.deleteAsset('tree-pine')).toBe(false);
}, 120000);

it('拒绝悬空图层和非树木模型，失败保持文档', () => {
  const session = new EditorSession(createDocument());
  const original = structuredClone(session.doc.treeLayers);
  session.replaceTreeLayerModel(session.treeLayer!.id, 'grass-reed');
  expect(session.error).not.toBe('');
  expect(session.doc.treeLayers).toEqual(original);
  session.doc.trees.push({
    id: session.doc.nextId++,
    layerId: 'missing',
    assetId: 'tree-pine',
    x: 0,
    z: 0,
    yaw: 0,
    scale: 1,
  });
  expect(() => validateDocument(session.doc)).toThrow('图层引用');
});

it('刷入记录图层，Shift 擦除不影响同模型的其他图层', () => {
  const session = new EditorSession(createDocument());
  session.setTool('trees');
  const first = session.treeLayer!;
  session.addTreeLayer(first.assetId);
  const second = session.treeLayer!;
  session.change('相邻图层测试实例', (doc) => {
    for (const layer of [first, second])
      doc.trees.push({
        id: doc.nextId++,
        layerId: layer.id,
        assetId: layer.assetId,
        x: 0,
        z: 0,
        yaw: 0,
        scale: 1,
      });
  });
  session.selectTreeLayer(first.id);
  session.pointerDown({ x: 0, z: 0 }, true);
  session.endStroke();
  expect(session.doc.trees).toHaveLength(1);
  expect(session.doc.trees[0].layerId).toBe(second.id);
  session.undo();
  expect(session.doc.trees).toHaveLength(2);
  session.pointerDown({ x: 100, z: 100 }, false);
  session.endStroke();
  expect(session.doc.trees.length).toBeGreaterThan(2);
  expect(session.doc.trees.slice(2).every((tree) => tree.layerId === first.id)).toBe(true);
  expect(session.error).toBe('');
});
