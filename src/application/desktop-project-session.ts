import type { EditorSession } from './editor-session';
import { createDocument } from '../core/document';
import { createDemo } from '../core/demo';
import { snapshot } from '../core/history';
import { ProjectRepository } from '../io/project-storage';
import type { ProjectEntry } from '../io/project-storage';
import { DesktopProjectStorage } from '../platform/desktop-project-storage';
import type { DesktopBridge, DesktopProjectHandle } from '../platform/desktop-contract';

export class DesktopProjectSession {
  private current: {
    handle: DesktopProjectHandle;
    repository: ProjectRepository;
    entry: ProjectEntry;
  } | null = null;
  constructor(
    private session: EditorSession,
    private bridge: DesktopBridge,
  ) {}
  private repository(handle: DesktopProjectHandle) {
    return new ProjectRepository(new DesktopProjectStorage(this.bridge, handle.token));
  }
  async open(handle?: DesktopProjectHandle | null): Promise<boolean> {
    const version = this.session.documentVersion,
      revision = this.session.revision;
    handle = handle === undefined ? await this.bridge.selectProject('open') : handle;
    if (!handle) return false;
    try {
      const repository = this.repository(handle),
        result = await repository.open();
      if (version !== this.session.documentVersion || revision !== this.session.revision)
        throw new Error('打开期间地图已改变，请重新打开工程');
      this.session.replace(result.document, true);
      const previous = this.current;
      this.current = { handle, repository, entry: result.entry };
      if (previous) {
        try {
          await this.bridge.releaseProject(previous.handle.token);
        } catch (error) {
          console.warn('旧工程授权释放失败', error);
        }
      }
      try {
        await this.bridge.rememberProject(handle.token);
        this.session.message(`已打开工程：${handle.directory}`);
      } catch (error) {
        this.session.message(`工程已打开，近期记录更新失败：${String(error)}`, true);
      }
      return true;
    } catch (error) {
      await this.bridge.releaseProject(handle.token);
      throw error;
    }
  }
  async create(
    parent: DesktopProjectHandle,
    name: string,
    samples: number,
    width: number,
    depth: number,
    example: boolean,
  ): Promise<boolean> {
    const version = this.session.documentVersion,
      revision = this.session.revision;
    const doc = example ? createDemo() : createDocument(samples, width, depth);
    doc.name = name.trim();
    const handle = await this.bridge.createProject(parent.token, doc.name);
    try {
      const repository = this.repository(handle),
        result = await repository.create(doc, revision);
      if (version !== this.session.documentVersion || revision !== this.session.revision)
        throw new Error('创建期间地图已改变，请重新打开已创建的工程');
      this.session.replace(result.document, true);
      const previous = this.current;
      this.current = { handle, repository, entry: result.entry };
      if (previous) {
        try {
          await this.bridge.releaseProject(previous.handle.token);
        } catch (error) {
          console.warn('旧工程授权释放失败', error);
        }
      }
      try {
        await this.bridge.rememberProject(handle.token);
        this.session.message(`工程已创建：${handle.directory}`);
      } catch (error) {
        this.session.message(`工程已创建，近期记录更新失败：${String(error)}`, true);
      }
      return true;
    } catch (error) {
      await this.bridge.releaseProject(handle.token);
      throw error;
    }
  }
  async save(): Promise<boolean> {
    const version = this.session.documentVersion,
      revision = this.session.revision;
    const doc = snapshot(this.session.doc),
      current = this.current;
    const handle = current?.handle ?? (await this.bridge.selectProject('create'));
    if (!handle) return false;
    const repository = current?.repository ?? this.repository(handle);
    try {
      const result = current
        ? await repository.save(current.entry, doc, revision)
        : await repository.create(doc, revision);
      if (version !== this.session.documentVersion) {
        throw new Error('已保存先前工程快照，当前工程已切换');
      }
      this.current = { handle, repository, entry: result.entry };
      const unchanged = this.session.revision === result.savedRevision;
      if (unchanged) this.session.dirty = false;
      this.session.message(
        result.warnings.length
          ? result.warnings.join('\n')
          : unchanged
            ? `工程已保存：${handle.directory}`
            : '已保存先前快照，仍有新的修改未保存',
      );
      return unchanged;
    } catch (error) {
      if (!current) await this.bridge.releaseProject(handle.token);
      throw error;
    }
  }
}
