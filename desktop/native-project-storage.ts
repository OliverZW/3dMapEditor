import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectStorage } from '../src/io/project-storage';

const uuid = '[a-f0-9-]{36}';
const filePattern = new RegExp(
  `^(project\\.map3dproj|data/${uuid}/(map\\.json|objects\\.json|builtin-lock\\.json|terrain/(base\\.f32|surface\\.rgba)|logic/owners\\.u32|grass/[1-9][0-9]*\\.f32)|assets/(models/[a-f0-9]{64}\\.glb|textures/[a-f0-9]{64}\\.png)|\\.editor/(workspace\\.json|recovery/(current\\.json|${uuid}\\.map3d)))$`,
  'i',
);
const directoryPattern = new RegExp(`^data/${uuid}$`, 'i');
function code(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}
export function validateProjectPath(value: string, directory = false): void {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    /[\\:\x00-\x1f]/.test(value) ||
    !(directory ? directoryPattern : filePattern).test(value)
  )
    throw new Error(`不允许访问的工程路径：${value}`);
}
function same(a: Uint8Array | undefined, b: Uint8Array | undefined) {
  return a === undefined
    ? b === undefined
    : b !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 原生适配仅接受选定工程下的标准文件；拒绝目录链中的符号链接/junction。
 * 写入先同步文件内容，再在同目录 rename 提交。锁冲突不覆盖，遗留锁也不擅自抢占。
 */
export class NativeProjectStorage implements ProjectStorage {
  readonly root: string;
  constructor(root: string) {
    if (!path.isAbsolute(root) || path.parse(root).root === path.resolve(root))
      throw new Error('工程根目录无效');
    this.root = path.resolve(root);
  }
  private async checked(target: string, createParents = false): Promise<void> {
    const absolute = path.resolve(target),
      parsed = path.parse(absolute);
    let current = parsed.root;
    const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw new Error(`工程路径不允许符号链接或 junction：${current}`);
        if (index < parts.length - 1 && !stat.isDirectory())
          throw new Error('工程路径的父级不是目录');
      } catch (error) {
        if (code(error) !== 'ENOENT') throw error;
        if (createParents && index < parts.length - 1 && current.startsWith(this.root + path.sep)) {
          try {
            await fs.mkdir(current);
          } catch (failure) {
            if (code(failure) !== 'EEXIST') throw failure;
          }
          const stat = await fs.lstat(current);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('工程目录创建冲突');
        } else if (index < parts.length - 1) throw error;
      }
    }
  }
  private target(relative: string, directory = false) {
    validateProjectPath(relative, directory);
    const result = path.resolve(this.root, ...relative.split('/'));
    if (!result.startsWith(this.root + path.sep)) throw new Error('工程路径越界');
    return result;
  }
  async createRootExclusive(): Promise<void> {
    await this.checked(this.root);
    await fs.mkdir(this.root); // 禁止 recursive，已有空目录也拒绝。
  }
  async read(relative: string, maxBytes: number): Promise<Uint8Array | undefined> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 512 * 1024 * 1024)
      throw new Error('读取预算无效');
    const target = this.target(relative);
    try {
      await this.checked(target);
      const handle = await fs.open(target, constants.O_RDONLY);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxBytes)
          throw new Error(`文件超过读取预算或不是普通文件：${relative}`);
        const bytes = new Uint8Array(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!read.bytesRead) throw new Error(`文件读取期间长度改变：${relative}`);
          offset += read.bytesRead;
        }
        if ((await handle.stat()).size !== stat.size) throw new Error('文件读取期间长度改变');
        await this.checked(target);
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (code(error) === 'ENOENT') return undefined;
      throw error;
    }
  }
  async writeNew(relative: string, bytes: Uint8Array): Promise<void> {
    const target = this.target(relative);
    await this.checked(target, true);
    const handle = await fs.open(target, 'wx');
    let complete = false;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      complete = true;
    } finally {
      await handle.close();
      if (!complete) {
        // wx 已确认文件是本次创建的；失败候选不占用后续重试的不可变路径。
        try {
          await this.checked(target);
          await fs.unlink(target);
        } catch (error) {
          if (code(error) !== 'ENOENT') console.warn('未完成工程文件清理失败', error);
        }
      }
    }
  }
  async replaceAtomic(
    relative: string,
    bytes: Uint8Array,
    expected: Uint8Array | undefined,
  ): Promise<void> {
    if (
      !['project.map3dproj', '.editor/workspace.json', '.editor/recovery/current.json'].includes(
        relative,
      )
    )
      throw new Error('只允许原子提交工程入口或会话指针');
    const target = this.target(relative),
      lockPath = path.join(this.root, '.map3d-write.lock');
    await this.checked(target, true);
    await this.checked(lockPath);
    let lock: fs.FileHandle;
    try {
      lock = await fs.open(lockPath, 'wx');
    } catch (error) {
      if (code(error) === 'EEXIST')
        throw new Error(
          '工程写入锁已存在；请关闭其他编辑器。若上次异常退出，请确认无其他写入后移除 .map3d-write.lock',
        );
      throw error;
    }
    const temporary = path.join(path.dirname(target), `.map3d-${randomUUID()}.tmp`);
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }));
      if (!same(await this.read(relative, 16 * 1024 * 1024), expected))
        throw new Error('工程入口已变化，原子提交冲突');
      const handle = await fs.open(temporary, 'wx');
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.checked(target);
      await fs.rename(temporary, target); // Windows 同卷替换；失败不使用 unlink + rename 降级。
    } finally {
      // 入口一旦提交成功，辅助文件清理失败不能再将这次提交报告为失败。
      for (const cleanup of [
        () => lock.close(),
        () => fs.unlink(lockPath),
        () => fs.unlink(temporary),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          if (code(error) !== 'ENOENT') console.warn('工程提交辅助文件清理失败', error);
        }
      }
    }
  }
  async list(relative: string): Promise<string[]> {
    const base = this.target(relative, true),
      result: string[] = [];
    let directories = 0;
    const visit = async (directory: string): Promise<void> => {
      if (++directories > 4096) throw new Error('工程目录数量超限');
      await this.checked(directory);
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        await this.checked(fullPath);
        if (entry.isDirectory()) await visit(fullPath);
        else {
          if (!entry.isFile()) throw new Error('工程包含非普通文件');
          result.push(path.relative(this.root, fullPath).split(path.sep).join('/'));
          if (result.length > 4096) throw new Error('工程文件数量超限');
        }
      }
    };
    try {
      await visit(base);
    } catch (error) {
      if (code(error) !== 'ENOENT') throw error;
    }
    return result;
  }
  async removeFile(relative: string): Promise<void> {
    if (!relative.startsWith('data/')) throw new Error('仅允许清理工程数据版本文件');
    const target = this.target(relative);
    await this.checked(target);
    try {
      await fs.unlink(target);
    } catch (error) {
      if (code(error) !== 'ENOENT') throw error;
    }
  }
}
