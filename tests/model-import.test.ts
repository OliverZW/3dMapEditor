import { describe, expect, it } from 'vitest';
import { EditorSession } from '../src/application/editor-session';
import { createDocument } from '../src/core/document';
import { assetReferenceLocations, isBuiltinAsset } from '../src/core/assets';
import { encodeProject, decodeProject } from '../src/io/project';
import { encodeProjectFiles } from '../src/io/project-codec';
import { builtinModelLods } from '../src/io/model-lods';
import { ModelLibrary } from '../src/renderer/models';
import type { AssetKind, ModelAsset } from '../src/core/types';

function custom(session: EditorSession, kind: AssetKind): ModelAsset {
  const source = session.doc.assets.find((asset) => asset.kind === 'tree')!;
  return {
    ...source,
    id: `custom-${kind}`,
    name: `自定义${kind}`,
    kind,
    builtin: undefined,
    resource: { origin: 'project', path: `assets/models/${source.hash}.glb` },
    scale: 2,
    yaw: Math.PI / 4,
    offset: 1.5,
  };
}
describe('工程自有模型与引用', () => {
  it('确认导入为单条历史，撤销重做保留同一资源身份和字节', () => {
    const session = new EditorSession(createDocument()),
      asset = custom(session, 'tree');
    session.addAsset(asset, session.documentVersion);
    expect(session.doc.assets.some((item) => item.id === asset.id)).toBe(true);
    session.undo();
    expect(session.doc.assets.some((item) => item.id === asset.id)).toBe(false);
    session.redo();
    const restored = session.doc.assets.find((item) => item.id === asset.id)!;
    expect(restored.bytes).toEqual(asset.bytes);
    expect([restored.id, restored.scale, restored.yaw, restored.offset]).toEqual([
      asset.id,
      2,
      Math.PI / 4,
      1.5,
    ]);
  });
  it('据点替换保留身份、位置、归属并可撤销重做，引用提示列出具体位置', () => {
    const session = new EditorSession(),
      site = session.doc.sites.find((item) => item.kind === 'city')!;
    const before = structuredClone(site),
      owners = session.doc.owners.slice();
    const asset = custom(session, 'city');
    session.addAsset(asset, session.documentVersion);
    session.selectedSite = site.id;
    session.replaceModel(asset.id);
    expect(session.doc.sites.find((item) => item.id === site.id)).toEqual({
      ...before,
      assetId: asset.id,
    });
    expect(session.doc.owners).toEqual(owners);
    expect(assetReferenceLocations(session.doc, asset.id)).toContain(
      `城池：${site.name}（ID ${site.id}）`,
    );
    expect(session.deleteAsset(asset.id)).toBe(false);
    session.undo();
    expect(session.doc.sites.find((item) => item.id === site.id)).toEqual(before);
    session.redo();
    expect(session.doc.sites.find((item) => item.id === site.id)?.assetId).toBe(asset.id);
    expect(session.doc.owners).toEqual(owners);
  });
  it('树木和草丛可选择工程模型，资源同哈希去重且备份恢复基础参数', () => {
    const session = new EditorSession(createDocument());
    const tree = custom(session, 'tree'),
      grass = custom(session, 'grass');
    session.addAsset(tree, session.documentVersion);
    session.addAsset(grass, session.documentVersion);
    session.setTool('trees');
    session.selectBrushAsset('tree', tree.id);
    session.pointerDown({ x: 0, z: 0 }, false);
    session.endStroke();
    expect(session.doc.trees.some((item) => item.assetId === tree.id)).toBe(true);
    session.setTool('grass');
    session.selectBrushAsset('grass', grass.id);
    session.pointerDown({ x: 200, z: 200 }, false);
    session.endStroke();
    expect(session.doc.grass.some((item) => item.assetId === grass.id)).toBe(true);
    expect(session.deleteAsset(tree.id)).toBe(false);
    expect(assetReferenceLocations(session.doc, grass.id)[0]).toContain('草丛图层');
    const files = encodeProjectFiles(session.doc);
    expect(Object.keys(files).filter((path) => path.startsWith('assets/models/'))).toEqual([
      `assets/models/${tree.hash}.glb`,
    ]);
    const restored = decodeProject(encodeProject(session.doc));
    const found = restored.assets.find((asset) => asset.id === tree.id)!;
    expect([found.scale, found.yaw, found.offset, found.kind]).toEqual([
      2,
      Math.PI / 4,
      1.5,
      'tree',
    ]);
    expect(restored.trees).toEqual(session.doc.trees);
    expect(restored.grass[0].density).toEqual(session.doc.grass[0].density);
  });
  it('失效工程版本和非法名称不进入历史，恢复的工程自有资源不使用共享 LOD', async () => {
    const session = new EditorSession(createDocument());
    const stale = session.documentVersion,
      asset = custom(session, 'tree');
    session.replace(createDocument());
    expect(() => session.addAsset(asset, stale)).toThrow('工程已切换');
    expect(() => session.addAsset({ ...asset, name: '  ' }, session.documentVersion)).toThrow(
      '资源描述无效',
    );
    expect(session.doc.assets.some((item) => item.id === asset.id)).toBe(false);
    expect(session.history.canUndo).toBe(false);
    const restoredBuiltin = {
      ...session.doc.assets.find((item) => item.kind === 'tree')!,
      resource: { origin: 'project' as const, path: `assets/models/${asset.hash}.glb` },
    };
    expect(isBuiltinAsset(restoredBuiltin)).toBe(false);
    expect(builtinModelLods(restoredBuiltin)).toBeUndefined();
    const library = new ModelLibrary();
    await expect(library.get({ ...restoredBuiltin, bytes: undefined })).rejects.toThrow('缺少 GLB');
    library.dispose();
  });
});
