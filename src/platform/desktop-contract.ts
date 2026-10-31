export interface DesktopProjectHandle {
  token: string;
  directory: string;
}
export interface RecentProject {
  id: string;
  name: string;
  directory: string;
  openedAt: number;
}
/** 仅提供用户通过原生对话框授予的工程能力，不暴露 Node 或任意 IPC。 */
export interface DesktopBridge {
  selectParent(): Promise<DesktopProjectHandle | null>;
  createProject(parentToken: string, name: string): Promise<DesktopProjectHandle>;
  recentList(): Promise<RecentProject[]>;
  recentOpen(id: string): Promise<DesktopProjectHandle>;
  recentRemove(id: string): Promise<void>;
  rememberProject(token: string): Promise<void>;
  selectProject(mode: 'create' | 'open'): Promise<DesktopProjectHandle | null>;
  releaseProject(token: string): Promise<void>;
  createRoot(token: string): Promise<void>;
  read(token: string, path: string, maxBytes: number): Promise<Uint8Array | undefined>;
  writeNew(token: string, path: string, bytes: Uint8Array): Promise<void>;
  replaceAtomic(
    token: string,
    path: string,
    bytes: Uint8Array,
    expected?: Uint8Array,
  ): Promise<void>;
  list(token: string, directory: string): Promise<string[]>;
  removeFile(token: string, path: string): Promise<void>;
  onCloseRequest(callback: (requestId: string) => void): () => void;
  finishClose(requestId: string, allow: boolean): Promise<void>;
}
declare global {
  interface Window {
    mapEditorDesktop?: DesktopBridge;
  }
}
