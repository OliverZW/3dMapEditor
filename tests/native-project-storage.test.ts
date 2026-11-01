import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NativeProjectStorage } from '../desktop/native-project-storage';
import { CloseController } from '../desktop/close-controller';
import { createDocument } from '../src/core/document';
import { ProjectRepository } from '../src/io/project-storage';

const base = path.resolve('test-results/tests', `native-storage-${randomUUID()}`);
async function root(name: string) {
  await fs.mkdir(base, { recursive: true });
  return new NativeProjectStorage(path.join(base, name));
}
afterAll(async () => {
  if (!base.startsWith(path.resolve('test-results/tests') + path.sep))
    throw new Error('测试清理目录越界');
  await fs.rm(base, { recursive: true, force: true });
});
describe('Windows 原生工程存储适配', () => {
  it.skipIf(process.platform !== 'win32')('目录写权限被拒绝时保留已保存入口', async () => {
    const storage = await root('权限失败'),
      repository = new ProjectRepository(storage);
    const doc = createDocument(),
      created = await repository.create(doc);
    const original = await storage.read('project.map3dproj', 4096);
    const execute = promisify(execFile);
    const { stdout } = await execute('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    });
    const sid = stdout.match(/S-1-[0-9-]+/)?.[0];
    if (!sid) throw new Error('无法取得测试用户身份');
    // ACL 修改仅限本测试独占创建的目录，finally 恢复，不涉及用户工程。
    await execute('icacls.exe', [storage.root, '/deny', `*${sid}:(W)`], { windowsHide: true });
    try {
      doc.heights[0] = 80;
      await expect(repository.save(created.entry, doc, 1)).rejects.toThrow();
      expect(await storage.read('project.map3dproj', 4096)).toEqual(original);
    } finally {
      await execute('icacls.exe', [storage.root, '/remove:d', `*${sid}`], { windowsHide: true });
    }
  });
  it('中文目录创建、原子替换、移动后重开保留工程身份与数据', async () => {
    const storage = await root('中文山河工程'),
      repository = new ProjectRepository(storage);
    const doc = createDocument();
    doc.name = '江南山河';
    const first = await repository.create(doc);
    doc.heights[0] = 64;
    const second = await repository.save(first.entry, doc, 8);
    expect(second.entry.previousDataRevision).toBe(first.entry.dataRevision);
    const destination = path.join(base, '移动后的工程');
    await fs.rename(storage.root, destination);
    const reopened = await new ProjectRepository(new NativeProjectStorage(destination)).open();
    expect(reopened.entry.projectId).toBe(first.entry.projectId);
    expect(reopened.document.heights[0]).toBe(64);
    expect(
      (await fs.readdir(destination)).some(
        (name) => name.endsWith('.tmp') || name.endsWith('.lock'),
      ),
    ).toBe(false);
  });
  it('已有空目录拒绝覆盖；不可变数据拒绝重复写；读取先检查大小', async () => {
    const storage = await root('拒绝覆盖');
    await storage.createRootExclusive();
    await expect(storage.createRootExclusive()).rejects.toThrow();
    const file = 'assets/textures/' + '0'.repeat(64) + '.png';
    await storage.writeNew(file, new Uint8Array([1, 2, 3]));
    await expect(storage.writeNew(file, new Uint8Array([9]))).rejects.toThrow();
    await expect(storage.read(file, 2)).rejects.toThrow('预算');
    expect(await storage.read(file, 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.read('.editor/recovery/current.json', 4096)).toBeUndefined();
  });
  it('跨适配器旧入口比较失败，写入锁不抢占，之前数据不变', async () => {
    const storage = await root('提交冲突');
    await storage.createRootExclusive();
    const first = new Uint8Array([1]),
      second = new Uint8Array([2]);
    await storage.replaceAtomic('project.map3dproj', first, undefined);
    const another = new NativeProjectStorage(storage.root);
    await another.replaceAtomic('project.map3dproj', second, first);
    await expect(storage.replaceAtomic('project.map3dproj', first, first)).rejects.toThrow('冲突');
    expect(await storage.read('project.map3dproj', 8)).toEqual(second);
    await fs.writeFile(path.join(storage.root, '.map3d-write.lock'), '占用');
    await expect(storage.replaceAtomic('project.map3dproj', first, second)).rejects.toThrow(
      '写入锁',
    );
    expect(await storage.read('project.map3dproj', 8)).toEqual(second);
  });
  it('目录 junction、绝对路径、穿越及工程外文件操作拒绝', async () => {
    const storage = await root('路径隔离');
    await storage.createRootExclusive();
    const outside = path.join(base, '其他目录');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(storage.root, 'assets'), 'junction');
    const asset = 'assets/models/' + '0'.repeat(64) + '.glb';
    await expect(storage.writeNew(asset, new Uint8Array([1]))).rejects.toThrow('junction');
    expect(await fs.readdir(outside)).toEqual([]);
    for (const candidate of ['../outside', 'C:/outside', 'data/../../outside', 'user.txt'])
      await expect(storage.read(candidate, 4096)).rejects.toThrow('路径');
    await expect(storage.removeFile('project.map3dproj')).rejects.toThrow('仅允许');
  });
  it('恢复草稿和会话使用真实目录文件，正式工程不受影响', async () => {
    const storage = await root('草稿与会话'),
      repository = new ProjectRepository(storage);
    const doc = createDocument(),
      created = await repository.create(doc);
    doc.heights[0] = 70;
    await repository.saveRecovery(created.entry, doc);
    expect((await repository.loadRecovery(created.entry))?.document.heights[0]).toBe(70);
    expect((await repository.open()).document.heights[0]).toBe(32);
    const workspace = {
      camera: {
        position: [1, 2, 3] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
      },
      panels: {},
      display: {},
    };
    await repository.saveWorkspace(workspace);
    expect(await repository.loadWorkspace()).toEqual(workspace);
  });
});
describe('窗口关闭握手', () => {
  it('重复关闭只发一次请求，取消后可重试，过期批准不接受', () => {
    const controller = new CloseController(),
      requests: string[] = [];
    controller.request((id) => requests.push(id));
    controller.request((id) => requests.push(id));
    expect(requests).toHaveLength(1);
    controller.complete(requests[0], false);
    expect(controller.consumeApproval()).toBe(false);
    controller.request((id) => requests.push(id));
    expect(() => controller.complete(requests[0], true)).toThrow('失效');
    controller.complete(requests[1], true);
    expect(controller.consumeApproval()).toBe(true);
    expect(controller.consumeApproval()).toBe(false);
  });
});
