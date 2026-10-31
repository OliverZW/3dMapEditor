import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/platform/desktop-contract';

const bridge: DesktopBridge = {
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
    const listener = (_event: Electron.IpcRendererEvent, id: unknown) => {
      if (typeof id === 'string') callback(id);
    };
    ipcRenderer.on('editor:close-request', listener);
    void ipcRenderer.invoke('editor:close-ready');
    return () => ipcRenderer.removeListener('editor:close-request', listener);
  },
  finishClose: (id, allow) => ipcRenderer.invoke('editor:finish-close', id, allow),
};
contextBridge.exposeInMainWorld('mapEditorDesktop', bridge);
