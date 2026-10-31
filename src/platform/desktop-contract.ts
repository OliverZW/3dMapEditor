export interface DesktopProjectHandle {
  token: string;
  directory: string;
}
/** 仅提供用户通过原生对话框授予的工程能力，不暴露 Node 或任意 IPC。 */
export interface DesktopBridge {
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
