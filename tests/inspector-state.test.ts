import { expect, it } from 'vitest';
import { EditorSession } from '../src/application/editor-session';
import { createDocument } from '../src/core/document';
import { inspectorState } from '../src/ui/inspector-state';

it('空树草图层隐藏全部属性，添加、删除及撤销后跟随有效默认选择', () => {
  const session = new EditorSession(createDocument());
  for (const tool of ['trees', 'grass'] as const) {
    session.setTool(tool);
    if (tool === 'trees') {
      for (const layer of [...(session.doc.treeLayers ?? [])]) session.deleteTreeLayer(layer.id);
    } else {
      for (const layer of [...session.doc.grass]) session.deleteGrassLayer(layer.id);
    }
    const label = tool === 'trees' ? '树木' : '草丛';
    expect(inspectorState(session)).toMatchObject({
      title: '工具属性',
      showActions: false,
      showProperties: false,
      showModelHelp: false,
    });
    expect(inspectorState(session).message).toContain(`暂无${label}图层`);
    const asset = session.doc.assets.find(
      (item) => item.kind === (tool === 'trees' ? 'tree' : 'grass'),
    )!;
    if (tool === 'trees') session.addTreeLayer(asset.id);
    else session.addGrassLayer(asset.id);
    const first = inspectorState(session).targetKey;
    expect(inspectorState(session)).toMatchObject({
      title: `${label}属性`,
      showActions: true,
      showProperties: true,
      showModelHelp: true,
    });
    if (tool === 'trees') {
      session.addTreeLayer(asset.id);
      session.deleteTreeLayer(session.treeLayer!.id);
    } else {
      session.addGrassLayer(asset.id);
      session.deleteGrassLayer(session.grassLayer!.id);
    }
    expect(inspectorState(session).targetKey).toBe(first);
    if (tool === 'trees') session.deleteTreeLayer(session.treeLayer!.id);
    else session.deleteGrassLayer(session.grassLayer!.id);
    expect(inspectorState(session).showProperties).toBe(false);
    session.undo();
    expect(inspectorState(session).showProperties).toBe(true);
    session.redo();
    expect(inspectorState(session).showProperties).toBe(false);
  }
});

it('对象工具区分空列表、未选择和有效选择，不泄漏其他工具的选中属性', () => {
  const session = new EditorSession();
  for (const tool of ['river', 'sites', 'factions'] as const) {
    session.setTool(tool);
    session.selectedRiver = session.selectedSite = session.selectedFaction = null;
    expect(inspectorState(session)).toMatchObject({
      title: '工具属性',
      showActions: false,
      showProperties: false,
    });
    expect(inspectorState(session).message).toContain('选择');
    if (tool === 'river') session.selectedRiver = session.doc.rivers[0].id;
    if (tool === 'sites') session.selectedSite = session.doc.sites[0].id;
    if (tool === 'factions') session.selectedFaction = session.doc.factions[0].id;
    expect(inspectorState(session).showProperties).toBe(true);
    if (tool === 'river') session.doc.rivers = [];
    if (tool === 'sites') session.doc.sites = [];
    if (tool === 'factions') session.doc.factions = [];
    expect(inspectorState(session).message).toContain('暂无');
    expect(inspectorState(session).showProperties).toBe(false);
  }
});

it('树木实例模式保留模式入口，只有命中有效实例才显示属性', () => {
  const session = new EditorSession();
  session.setTool('trees');
  session.setVegetationMode('select');
  expect(inspectorState(session)).toMatchObject({
    showActions: true,
    showProperties: false,
    message: '请在地图中选择树木实例。',
  });
  session.selectedTree = session.doc.trees[0].id;
  expect(inspectorState(session).showProperties).toBe(true);
  session.selectedTree = null;
  session.doc.trees = [];
  expect(inspectorState(session)).toMatchObject({ showActions: true, showProperties: false });
  expect(inspectorState(session).message).toContain('切换到“刷入”');
  session.setVegetationMode('paint');
  expect(inspectorState(session).showProperties).toBe(true);
  session.setVegetationMode('select');
  session.doc.treeLayers = [];
  expect(inspectorState(session).showActions).toBe(false);
});

it('概览地形直接可用，地表检查索引，河流与据点预览不依赖正式选择', () => {
  const session = new EditorSession(createDocument());
  for (const tool of ['overview', 'terrain', 'surface'] as const) {
    session.setTool(tool);
    expect(inspectorState(session).showProperties).toBe(true);
  }
  session.brush.surfaceLayer = 99;
  expect(inspectorState(session).showProperties).toBe(false);
  session.startRiver();
  expect(inspectorState(session)).toMatchObject({ showActions: true, showProperties: true });
  session.cancelPreview();
  session.setTool('sites');
  session.siteMode = 'place';
  expect(inspectorState(session)).toMatchObject({ showActions: true, showProperties: true });
  session.siteMode = 'move';
  expect(inspectorState(session)).toMatchObject({ showActions: true, showProperties: true });
});
