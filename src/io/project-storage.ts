import type { MapDocument } from '../core/types';
import { snapshot } from '../core/history';
import { decodeProject, encodeProject } from './project';
import {
  decodeProjectFiles,
  encodeProjectFiles,
  jsonBytes,
  parseJson,
  validateRelativePath,
} from './project-codec';
import type { ProjectFiles } from './project-codec';
import { resolveBuiltin } from './project-resources';
import type { BuiltinResolver } from './project-resources';

/** 所有路径相对已选根目录；适配器必须拒绝越界链接并在读取前执行 maxBytes 预算。
 * replaceAtomic 必须原子比较并替换，失败保留原文件；不可用时须拒绝，禁止降级为覆盖写。
 * createRootExclusive 必须拒绝已存在目录（包括空目录）。writeNew 不得覆盖任何文件。
 */
export interface ProjectStorage {
  createRootExclusive(): Promise<void>;
  read(path: string, maxBytes: number): Promise<Uint8Array | undefined>;
  writeNew(path: string, bytes: Uint8Array): Promise<void>;
  replaceAtomic(path: string, bytes: Uint8Array, expected: Uint8Array | undefined): Promise<void>;
  list(directory: string): Promise<string[]>;
  removeFile(path: string): Promise<void>;
}
export interface ProjectEntry {
  format: 'map3d-project';
  projectVersion: 1;
  projectId: string;
  name: string;
  dataRevision: string;
  previousDataRevision: string | null;
}
export interface OpenProject {
  entry: ProjectEntry;
  document: MapDocument;
}
export interface SavedProject extends OpenProject {
  savedRevision: number;
  warnings: string[];
}
export interface WorkspaceState {
  camera: { position: [number, number, number]; target: [number, number, number] };
  panels: Record<string, boolean>;
  display: Record<string, boolean>;
}
const entryPath = 'project.map3dproj';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function projectName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 128) throw new Error('工程名称无效');
  return trimmed;
}
function entryFrom(bytes: Uint8Array): ProjectEntry {
  const entry = parseJson(bytes, entryPath);
  if (entry.format !== 'map3d-project' || entry.projectVersion !== 1)
    throw new Error('不支持的工程入口版本');
  if (
    typeof entry.name !== 'string' ||
    projectName(entry.name) !== entry.name ||
    ![entry.projectId, entry.dataRevision].every(
      (id) => typeof id === 'string' && uuidPattern.test(id),
    ) ||
    !(
      entry.previousDataRevision === null ||
      (typeof entry.previousDataRevision === 'string' &&
        uuidPattern.test(entry.previousDataRevision))
    ) ||
    entry.previousDataRevision === entry.dataRevision
  )
    throw new Error('工程入口身份或版本路径无效');
  return entry as unknown as ProjectEntry;
}
function same(a: Uint8Array | undefined, b: Uint8Array | undefined) {
  return a === undefined
    ? b === undefined
    : b !== undefined && a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 同一服务内保存串行；跨服务覆盖通过入口 compare-and-swap 拒绝。
 * 返回候选工程供应用层整体切换，不操作当前编辑会话。
 */
export class ProjectRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: ProjectStorage,
    private resolver: BuiltinResolver = resolveBuiltin,
  ) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async open(): Promise<OpenProject> {
    const bytes = await this.storage.read(entryPath, 4096);
    if (!bytes) throw new Error('工程缺少 project.map3dproj');
    const entry = entryFrom(bytes);
    const files = await this.readRevision(entry.dataRevision);
    const document = decodeProjectFiles(files, entry.name, false, this.resolver);
    if (!same(bytes, await this.storage.read(entryPath, 4096)))
      throw new Error('打开期间工程已被其他会话保存，请重试');
    return { entry, document };
  }
  private async readRevision(revision: string): Promise<ProjectFiles> {
    if (!uuidPattern.test(revision)) throw new Error('保存版本无效');
    const prefix = `data/${revision}/`,
      files: ProjectFiles = {};
    const paths = await this.storage.list(`data/${revision}`);
    const unique = new Set(paths);
    if (unique.size !== paths.length || paths.length > 4096)
      throw new Error('工程文件数量或路径重复');
    let total = 0;
    const read = async (fullPath: string, key: string) => {
      validateRelativePath(fullPath);
      const bytes = await this.storage.read(fullPath, 512 * 1024 * 1024 - total);
      if (!bytes) throw new Error(`工程缺少 ${fullPath}`);
      total += bytes.length;
      if (total > 512 * 1024 * 1024) throw new Error('工程数据预算超限');
      files[key] = bytes;
    };
    for (const path of paths) {
      if (!path.startsWith(prefix)) throw new Error('保存版本目录路径越界');
      await read(path, path.slice(prefix.length));
    }
    const map = parseJson(files['map.json'], 'map.json');
    const assets = new Set<string>();
    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ('origin' in value && value.origin === 'project') {
        if (!('path' in value) || typeof value.path !== 'string')
          throw new Error('工程资源路径无效');
        validateRelativePath(value.path);
        if (!/^assets\/(models|textures)\/[a-f0-9]{64}\.(glb|png)$/.test(value.path))
          throw new Error('工程资源路径无效');
        assets.add(value.path);
      }
      for (const child of Object.values(value)) collect(child);
    };
    collect(map);
    if (assets.size + paths.length > 4096) throw new Error('工程文件数量超限');
    for (const path of assets) await read(path, path);
    return files;
  }
  create(doc: MapDocument, revision = 0): Promise<SavedProject> {
    const candidate = snapshot(doc);
    candidate.name = projectName(candidate.name);
    return this.serial(async () => {
      // 先验证候选内容，再创建目录；首次提交失败也不会生成有效入口。
      const files = encodeProjectFiles(candidate, false, this.resolver);
      await this.storage.createRootExclusive();
      return this.commit(candidate, files, undefined, revision);
    });
  }
  save(opened: ProjectEntry, doc: MapDocument, revision: number): Promise<SavedProject> {
    const candidate = snapshot(doc),
      expectedEntry = { ...opened };
    candidate.name = projectName(candidate.name);
    return this.serial(async () => {
      const expected = await this.storage.read(entryPath, 4096);
      if (!expected) throw new Error('工程入口已丢失');
      const current = entryFrom(expected);
      if (
        current.projectId !== expectedEntry.projectId ||
        current.dataRevision !== expectedEntry.dataRevision
      )
        throw new Error('工程已被其他会话保存，请重新打开');
      return this.commit(
        candidate,
        encodeProjectFiles(candidate, false, this.resolver),
        expected,
        revision,
      );
    });
  }
  private async commit(
    doc: MapDocument,
    files: ProjectFiles,
    expected: Uint8Array | undefined,
    revision: number,
  ): Promise<SavedProject> {
    const previous = expected ? entryFrom(expected) : undefined;
    const entry: ProjectEntry = {
      format: 'map3d-project',
      projectVersion: 1,
      projectId: previous?.projectId ?? crypto.randomUUID(),
      name: doc.name,
      dataRevision: crypto.randomUUID(),
      previousDataRevision: previous?.dataRevision ?? null,
    };
    for (const [path, bytes] of Object.entries(files)) {
      const target = path.startsWith('assets/') ? path : `data/${entry.dataRevision}/${path}`;
      const existing = path.startsWith('assets/')
        ? await this.storage.read(target, 32 * 1024 * 1024)
        : undefined;
      if (existing) {
        if (!same(existing, bytes)) throw new Error(`工程素材哈希路径已被损坏：${target}`);
      } else await this.storage.writeNew(target, bytes);
    }
    const verified = decodeProjectFiles(
      await this.readRevision(entry.dataRevision),
      entry.name,
      false,
      this.resolver,
    );
    await this.storage.replaceAtomic(entryPath, jsonBytes(entry), expected);
    const warnings: string[] = [];
    // 只清理由本次之前入口明确指向、且已退出双版本保留范围的数据。
    if (previous?.previousDataRevision) {
      try {
        const prefix = `data/${previous.previousDataRevision}/`;
        for (const path of await this.storage.list(`data/${previous.previousDataRevision}`)) {
          validateRelativePath(path);
          if (!path.startsWith(prefix)) throw new Error('清理路径越界');
          if (
            /^(map\.json|objects\.json|builtin-lock\.json|terrain\/(base\.f32|surface\.rgba)|logic\/owners\.u32|grass\/[1-9][0-9]*\.f32)$/.test(
              path.slice(prefix.length),
            )
          )
            await this.storage.removeFile(path);
        }
      } catch (error) {
        warnings.push(`保存成功，旧版本清理失败：${String(error)}`);
      }
    }
    return { entry, document: verified, savedRevision: revision, warnings };
  }
  backup(doc: MapDocument): Uint8Array {
    return encodeProject(doc);
  }
  restore(bytes: Uint8Array): MapDocument {
    return decodeProject(bytes);
  }
  saveRecovery(entry: ProjectEntry, doc: MapDocument): Promise<void> {
    entry = { ...entry };
    const bytes = encodeProject(doc);
    return this.serial(async () => {
      const current = await this.open();
      if (
        current.entry.projectId !== entry.projectId ||
        current.entry.dataRevision !== entry.dataRevision
      )
        throw new Error('恢复草稿的工程基线已改变');
      const path = `.editor/recovery/${crypto.randomUUID()}.map3d`;
      await this.storage.writeNew(path, bytes);
      const pointer = '.editor/recovery/current.json';
      const expected = await this.storage.read(pointer, 4096);
      await this.storage.replaceAtomic(
        pointer,
        jsonBytes({ projectId: entry.projectId, baseline: entry.dataRevision, path }),
        expected,
      );
    });
  }
  async loadRecovery(
    entry: ProjectEntry,
  ): Promise<{ document: MapDocument; dirty: true } | undefined> {
    const current = await this.storage.read(entryPath, 4096);
    if (!current) return undefined;
    const active = entryFrom(current);
    if (active.projectId !== entry.projectId || active.dataRevision !== entry.dataRevision)
      return undefined;
    const bytes = await this.storage.read('.editor/recovery/current.json', 4096);
    if (!bytes) return undefined;
    const record = parseJson(bytes, '恢复草稿');
    if (record.projectId !== entry.projectId || record.baseline !== entry.dataRevision)
      return undefined;
    if (
      typeof record.path !== 'string' ||
      !/^\.editor\/recovery\/[a-f0-9-]{36}\.map3d$/.test(record.path)
    )
      throw new Error('恢复草稿路径无效');
    const backup = await this.storage.read(record.path, 256 * 1024 * 1024);
    if (!backup) throw new Error('恢复草稿数据缺失');
    return { document: decodeProject(backup), dirty: true };
  }
  saveWorkspace(state: WorkspaceState): Promise<void> {
    validateWorkspace(state);
    const bytes = jsonBytes(state);
    if (bytes.length > 64 * 1024) return Promise.reject(new Error('会话状态预算超限'));
    return this.serial(async () => {
      const path = '.editor/workspace.json';
      await this.storage.replaceAtomic(path, bytes, await this.storage.read(path, 64 * 1024));
    });
  }
  async loadWorkspace(): Promise<WorkspaceState | undefined> {
    try {
      const bytes = await this.storage.read('.editor/workspace.json', 64 * 1024);
      if (!bytes) return undefined;
      const state = parseJson(bytes, '会话状态') as unknown as WorkspaceState;
      validateWorkspace(state);
      return state;
    } catch {
      return undefined;
    } // 可丢弃会话状态损坏时回退，不影响正式工程。
  }
}
function validateWorkspace(state: WorkspaceState): void {
  if (
    !state?.camera ||
    ![state.camera.position, state.camera.target].every(
      (values) => Array.isArray(values) && values.length === 3 && values.every(Number.isFinite),
    ) ||
    ![state.panels, state.display].every(
      (values) =>
        values &&
        typeof values === 'object' &&
        !Array.isArray(values) &&
        Object.values(values).every((value) => typeof value === 'boolean'),
    )
  )
    throw new Error('会话状态无效');
}
