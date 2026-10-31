import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { createDocument } from '../src/core/document';
import { snapshot } from '../src/core/history';
import { ProjectRepository } from '../src/io/project-storage';
import type { ProjectStorage } from '../src/io/project-storage';
import { decodeProject, encodeProject } from '../src/io/project';
import {
  decodeProjectFiles,
  jsonBytes,
  parseJson,
  validateRelativePath,
} from '../src/io/project-codec';
import { resolveBuiltin } from '../src/io/project-resources';
import { imageHash } from '../src/io/image-validation';
import { captureSnapshot } from '../src/io/export-adapter';

/** 模拟适配器契约和故障点；真实 Windows 文件系统适配在第 2 步验收。 */
class MemoryStorage implements ProjectStorage {
  files = new Map<string, Uint8Array>();
  exists = false;
  fail: (operation: string, path: string) => boolean = () => false;
  writes: string[] = [];
  check(operation: string, path: string) {
    validateRelativePath(path);
    if (this.fail(operation, path)) throw new Error(`模拟失败 ${operation} ${path}`);
  }
  async createRootExclusive() {
    if (this.exists) throw new Error('目标目录已存在');
    this.exists = true;
  }
  async read(path: string, maxBytes: number) {
    this.check('read', path);
    const bytes = this.files.get(path);
    if (bytes && bytes.length > maxBytes) throw new Error('读取预算超限');
    return bytes?.slice();
  }
  async writeNew(path: string, bytes: Uint8Array) {
    this.check('write', path);
    if (this.files.has(path)) throw new Error('不可覆盖已有文件');
    this.writes.push(path);
    this.files.set(path, bytes.slice());
  }
  async replaceAtomic(path: string, bytes: Uint8Array, expected: Uint8Array | undefined) {
    this.check('commit', path);
    const current = this.files.get(path);
    if (
      expected === undefined
        ? current !== undefined
        : current === undefined ||
          current.length !== expected.length ||
          current.some((value, index) => value !== expected[index])
    )
      throw new Error('原子提交冲突');
    this.files.set(path, bytes.slice());
  }
  async list(directory: string) {
    this.check('list', directory);
    return [...this.files.keys()].filter((path) => path.startsWith(directory + '/'));
  }
  async removeFile(path: string) {
    this.check('remove', path);
    this.files.delete(path);
  }
}
function map() {
  const doc = createDocument();
  doc.name = '测试山河';
  const model = doc.assets.find((asset) => asset.kind === 'tree')!;
  doc.trees.push({ id: 1, assetId: model.id, x: 0, z: 0, yaw: 0.2, scale: 1.2 });
  doc.nextId = 2;
  return doc;
}

describe('文件夹工程与 v4 自包含备份', () => {
  it('创建、改名和保存往返；只锁定使用的内置模型，不复制共享库', async () => {
    const storage = new MemoryStorage(),
      repository = new ProjectRepository(storage),
      doc = map();
    const created = await repository.create(doc);
    expect(created.entry.previousDataRevision).toBeNull();
    expect([...storage.files.keys()].some((path) => path.startsWith('assets/'))).toBe(false);
    const lock = parseJson(
      storage.files.get(`data/${created.entry.dataRevision}/builtin-lock.json`),
      'lock',
    );
    expect(
      (lock.resources as { kind: string }[]).filter((value) => value.kind === 'model'),
    ).toHaveLength(1);
    const changed = snapshot(created.document);
    changed.name = '  新山河  ';
    changed.heights[0] = 60;
    const saved = await repository.save(created.entry, changed, 7);
    expect(saved.savedRevision).toBe(7);
    expect(saved.entry.projectId).toBe(created.entry.projectId);
    expect(saved.entry.name).toBe('新山河');
    expect(saved.entry.previousDataRevision).toBe(created.entry.dataRevision);
    const opened = await repository.open();
    expect(opened.document.heights[0]).toBe(60);
    expect(opened.document.trees).toEqual(doc.trees);
    expect(opened.document.surface).toEqual(doc.surface);
    await expect(repository.create(doc)).rejects.toThrow('已存在');
    await expect(repository.save(created.entry, changed, 8)).rejects.toThrow('其他会话');
  });

  it.each(['write', 'read', 'commit'])(
    '保存 %s 阶段失败保留上次入口和数据，失败后仍可保存',
    async (operation) => {
      const storage = new MemoryStorage(),
        repository = new ProjectRepository(storage);
      const original = await repository.create(map());
      const entry = storage.files.get('project.map3dproj')!.slice();
      const changed = snapshot(original.document);
      changed.heights[0] = 80;
      storage.fail = (op, path) =>
        op === operation &&
        (operation === 'commit' ? path === 'project.map3dproj' : path.startsWith('data/'));
      await expect(repository.save(original.entry, changed, 1)).rejects.toThrow('模拟失败');
      expect(storage.files.get('project.map3dproj')).toEqual(entry);
      storage.fail = () => false;
      expect((await repository.open()).document.heights[0]).toBe(32);
      await repository.save(original.entry, changed, 2);
      expect((await repository.open()).document.heights[0]).toBe(80);
    },
  );

  it('素材写入失败不产生工程入口；自有资源不会因内容等同内置而变为共享', async () => {
    const doc = decodeProject(encodeProject(map()));
    const failedStorage = new MemoryStorage();
    failedStorage.fail = (op, path) => op === 'write' && path.startsWith('assets/');
    await expect(new ProjectRepository(failedStorage).create(doc)).rejects.toThrow('模拟失败');
    expect(failedStorage.files.has('project.map3dproj')).toBe(false);
    const storage = new MemoryStorage(),
      repository = new ProjectRepository(storage, () => {
        throw new Error('共享库不可用');
      });
    const saved = await repository.create(doc);
    expect(saved.document.assets[0].resource?.origin).toBe('project');
    expect(saved.document.waterMaterial.normal.resource?.origin).toBe('project');
    const count = storage.writes.filter((path) => path.startsWith('assets/')).length;
    await repository.save(saved.entry, saved.document, 1);
    expect(storage.writes.filter((path) => path.startsWith('assets/'))).toHaveLength(count);
  });

  it('保存快照隔离后续编辑；保留两个版本，清理失败仅报告警告', async () => {
    const storage = new MemoryStorage(),
      repository = new ProjectRepository(storage);
    const first = await repository.create(map()),
      changed = snapshot(first.document);
    const pending = repository.save(first.entry, changed, 11);
    changed.heights[0] = 100;
    const second = await pending;
    expect(second.savedRevision).toBe(11);
    expect(second.document.heights[0]).toBe(32);
    storage.fail = (op) => op === 'remove';
    const third = await repository.save(second.entry, changed, 12);
    expect(third.warnings[0]).toContain('保存成功');
    expect((await repository.open()).entry.dataRevision).toBe(third.entry.dataRevision);
    storage.fail = () => false;
    const fourth = await repository.save(third.entry, changed, 13);
    expect(
      [...storage.files.keys()].some((path) =>
        path.startsWith(`data/${second.entry.dataRevision}/`),
      ),
    ).toBe(false);
    expect(fourth.entry.previousDataRevision).toBe(third.entry.dataRevision);
  });

  it('共享资源缺失、哈希不符、锁不一致、非法入口路径拒绝打开', async () => {
    const storage = new MemoryStorage(),
      repository = new ProjectRepository(storage);
    const created = await repository.create(map());
    await expect(
      new ProjectRepository(storage, () => {
        throw new Error('共享资源缺失');
      }).open(),
    ).rejects.toThrow('共享资源缺失');
    await expect(new ProjectRepository(storage, () => new Uint8Array(24)).open()).rejects.toThrow(
      '哈希',
    );
    const lockPath = `data/${created.entry.dataRevision}/builtin-lock.json`;
    storage.files.set(lockPath, jsonBytes({ version: 1, resources: [] }));
    await expect(repository.open()).rejects.toThrow('资源锁');
    storage.files.set(
      'project.map3dproj',
      jsonBytes({ ...created.entry, dataRevision: '../outside' }),
    );
    await expect(repository.open()).rejects.toThrow('路径');
  });

  it('备份无需共享库恢复模型、地表、水面，后续导出使用包内字节', () => {
    const repository = new ProjectRepository(new MemoryStorage());
    const source = map(),
      bytes = repository.backup(source),
      files = unzipSync(bytes);
    const restored = decodeProjectFiles(files, source.name, true, () => {
      throw new Error('禁止读取共享库');
    });
    expect(repository.restore(bytes).trees).toEqual(source.trees);
    expect(restored.assets[0].bytes?.length).toBeGreaterThan(0);
    expect(
      restored.surfaceMaterial.layers.every((layer) => layer.color.resource?.origin === 'project'),
    ).toBe(true);
    const exported = captureSnapshot(restored);
    expect(imageHash(exported.document.waterMaterial.normal.bytes!)).toBe(
      source.waterMaterial.normal.hash,
    );
    expect(restored.heights).toEqual(source.heights);
    expect(restored.trees).toEqual(source.trees);
  });

  it('草稿隔离身份和基线，恢复为未保存数据；会话损坏不影响正式数据', async () => {
    const storage = new MemoryStorage(),
      repository = new ProjectRepository(storage);
    const created = await repository.create(map()),
      changed = snapshot(created.document);
    changed.heights[0] = 90;
    await repository.saveRecovery(created.entry, changed);
    const recovered = await repository.loadRecovery(created.entry);
    expect(recovered?.dirty).toBe(true);
    expect(recovered?.document.heights[0]).toBe(90);
    expect((await repository.open()).document.heights[0]).toBe(32);
    expect(
      await repository.loadRecovery({ ...created.entry, projectId: crypto.randomUUID() }),
    ).toBeUndefined();
    expect(
      await repository.loadRecovery({ ...created.entry, dataRevision: crypto.randomUUID() }),
    ).toBeUndefined();
    const workspace = {
      camera: {
        position: [1, 2, 3] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
      },
      panels: { left: true },
      display: { grid: false },
    };
    await repository.saveWorkspace(workspace);
    expect(await repository.loadWorkspace()).toEqual(workspace);
    storage.files.set('.editor/workspace.json', jsonBytes({ invalid: true }));
    expect(await repository.loadWorkspace()).toBeUndefined();
    expect((await repository.open()).document.heights[0]).toBe(32);
  });

  it('非法资源路径、损坏贴图、未知备份版本和多余越界文件被拒绝', () => {
    const files = unzipSync(encodeProject(map()));
    const manifest = files['manifest.json'];
    files['manifest.json'] = jsonBytes({ format: 'map3d-backup', formatVersion: 9 });
    expect(() => decodeProject(zipSync(files))).toThrow('版本');
    files['manifest.json'] = manifest;
    const mapData = parseJson(files['map.json'], 'map');
    const models = mapData.assets as { resource: unknown }[];
    models[0].resource = { origin: 'project', path: '../escape.glb' };
    files['map.json'] = jsonBytes(mapData);
    expect(() => decodeProject(zipSync(files))).toThrow('路径');
    files['../escape'] = new Uint8Array(1);
    expect(() => decodeProject(zipSync(files))).toThrow('非法');
    for (const path of ['C:/escape', '/escape', 'a\\b', 'a/../b', 'a//b', 'a/./b'])
      expect(() => validateRelativePath(path)).toThrow('非法');
  });

  it('资源解析按标识和哈希匹配，不接受同名替换', () => {
    expect(() => resolveBuiltin('models/missing.glb', '0'.repeat(64))).toThrow('哈希');
  });
});
