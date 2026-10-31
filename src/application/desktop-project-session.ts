import type { EditorSession } from './editor-session';
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
  async reset(): Promise<void> {
    const previous = this.current;
    this.current = null;
    if (previous) await this.bridge.releaseProject(previous.handle.token);
  }
  async open(): Promise<boolean> {
    const version = this.session.documentVersion,
      revision = this.session.revision;
    const handle = await this.bridge.selectProject('open');
    if (!handle) return false;
    try {
      const repository = this.repository(handle),
        result = await repository.open();
      if (version !== this.session.documentVersion || revision !== this.session.revision)
        throw new Error('打开期间地图已改变，请重新打开工程');
      this.session.replace(result.document, true);
      const previous = this.current;
      this.current = { handle, repository, entry: result.entry };
      if (previous) await this.bridge.releaseProject(previous.handle.token);
      this.session.message(`已打开工程：${handle.directory}`);
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
