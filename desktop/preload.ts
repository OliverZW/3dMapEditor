import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopProjectHandle } from '../src/platform/desktop-contract';

let windowVisible = true;
const visibilityCallbacks = new Set<(visible: boolean) => void>();
ipcRenderer.on('editor:window-visible', (_event, value: unknown) => {
  if (typeof value !== 'boolean') return;
  windowVisible = value;
  visibilityCallbacks.forEach((callback) => callback(value));
});
let closeCallback: ((id: string) => void) | undefined;
let pendingClose: string | undefined;
let projectCallback: ((handle: DesktopProjectHandle) => void) | undefined;
const pendingProjects: DesktopProjectHandle[] = [];
ipcRenderer.on('project:open-external', (_event, handle: unknown) => {
  if (
    !handle ||
    typeof handle !== 'object' ||
    !('token' in handle) ||
    !('directory' in handle) ||
    typeof handle.token !== 'string' ||
    typeof handle.directory !== 'string'
  )
    return;
  const value = { token: handle.token, directory: handle.directory };
  if (projectCallback) projectCallback(value);
  else pendingProjects.push(value);
});
ipcRenderer.on('editor:close-request', (_event, id: unknown) => {
  if (typeof id !== 'string') return;
  if (closeCallback) closeCallback(id);
  else pendingClose = id;
});
const bridge: DesktopBridge = {
  performanceProbeEnabled: process.argv.includes('--map-editor-performance-probe'),
  onWindowVisibility: (callback) => {
    visibilityCallbacks.add(callback);
    callback(windowVisible);
    return () => {
      visibilityCallbacks.delete(callback);
    };
  },
  selectParent: () => ipcRenderer.invoke('project:select-parent'),
  createProject: (token, name) => ipcRenderer.invoke('project:create', token, name),
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentOpen: (id) => ipcRenderer.invoke('recent:open', id),
  recentRemove: (id) => ipcRenderer.invoke('recent:remove', id),
  rememberProject: (token) => ipcRenderer.invoke('recent:remember', token),
  selectProject: (mode) => ipcRenderer.invoke('project:select', mode),
  releaseProject: (token) => ipcRenderer.invoke('project:release', token),
  createRoot: (token) => ipcRenderer.invoke('project:create-root', token),
  read: (token, path, budget) => ipcRenderer.invoke('project:read', token, path, budget),
  writeNew: (token, path, bytes) => ipcRenderer.invoke('project:write-new', token, path, bytes),
  replaceAtomic: (token, path, bytes, expected) =>
    ipcRenderer.invoke('project:replace', token, path, bytes, expected),
  list: (token, directory) => ipcRenderer.invoke('project:list', token, directory),
  removeFile: (token, path) => ipcRenderer.invoke('project:remove', token, path),
  onCloseRequest: (callback) => {
    closeCallback = callback;
    void ipcRenderer.invoke('editor:close-ready');
    if (pendingClose) {
      const id = pendingClose;
      pendingClose = undefined;
      callback(id);
    }
    return () => {
      if (closeCallback === callback) closeCallback = undefined;
    };
  },
  finishClose: (id, allow) => ipcRenderer.invoke('editor:finish-close', id, allow),
  onOpenProject: (callback) => {
    projectCallback = callback;
    while (pendingProjects.length) callback(pendingProjects.shift()!);
    return () => {
      if (projectCallback === callback) projectCallback = undefined;
    };
  },
  saveBackup: (name, bytes) => ipcRenderer.invoke('backup:save', name, bytes),
  selectBackup: () => ipcRenderer.invoke('backup:select'),
};
contextBridge.exposeInMainWorld('mapEditorDesktop', bridge);
