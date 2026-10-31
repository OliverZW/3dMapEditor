import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { NativeProjectStorage } from './native-project-storage';
import { CloseController } from './close-controller';

const location = new URL(process.env.MAP_EDITOR_DEV_URL ?? 'http://127.0.0.1:5173/');
if (
  location.protocol !== 'http:' ||
  location.hostname !== '127.0.0.1' ||
  location.pathname !== '/' ||
  location.username ||
  location.password ||
  location.search ||
  location.hash
)
  throw new Error('桌面开发入口只允许本机 Vite 服务');
const trustedUrl = location.href;
const profile = path.join(__dirname, 'profile');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const capabilities = new Map<string, NativeProjectStorage>();
let window: BrowserWindow;
let rendererReady = false;
const closeController = new CloseController();
function verify(event: Electron.IpcMainInvokeEvent) {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== trustedUrl
  )
    throw new Error('拒绝非编辑器主页面的工程请求');
}
function storage(token: unknown): NativeProjectStorage {
  if (typeof token !== 'string' || !capabilities.has(token))
    throw new Error('工程授权不存在或已失效');
  return capabilities.get(token)!;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) throw new Error('文件参数无效');
  return value;
}
function bytes(value: unknown, max = 512 * 1024 * 1024): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length > max) throw new Error('文件字节无效或超限');
  return value;
}
function handle(channel: string, operation: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    verify(event);
    try {
      return await operation(...args);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (['EACCES', 'EPERM'].includes(String(error.code)))
          throw new Error('工程文件权限不足，请检查所选目录是否允许读写');
        if (error.code === 'ENOSPC') throw new Error('磁盘空间不足，工程未能保存');
      }
      throw error;
    }
  });
}
function installHandlers() {
  handle('project:select', async (mode) => {
    if (!['create', 'open'].includes(String(mode))) throw new Error('工程选择模式无效');
    let root: string;
    if (mode === 'create') {
      const selected = await dialog.showSaveDialog(window, {
        title: '选择新工程文件夹的位置（目录必须尚不存在）',
        defaultPath: path.join(app.getPath('documents'), '新地图'),
      });
      if (selected.canceled || !selected.filePath) return null;
      root = selected.filePath;
    } else {
      const selected = await dialog.showOpenDialog(window, {
        title: '打开工程入口',
        properties: ['openFile'],
        filters: [{ name: '地图工程', extensions: ['map3dproj'] }],
      });
      if (selected.canceled || !selected.filePaths.length) return null;
      if (path.basename(selected.filePaths[0]) !== 'project.map3dproj')
        throw new Error('请选择 project.map3dproj 工程入口');
      root = path.dirname(selected.filePaths[0]);
    }
    const token = randomUUID(),
      adapter = new NativeProjectStorage(root);
    capabilities.set(token, adapter);
    return { token, directory: adapter.root };
  });
  handle('project:release', (token) => {
    storage(token);
    capabilities.delete(String(token));
  });
  handle('project:create-root', (token) => storage(token).createRootExclusive());
  handle('project:read', (token, file, budget) => {
    if (typeof budget !== 'number') throw new Error('读取预算无效');
    return storage(token).read(text(file), budget);
  });
  handle('project:write-new', (token, file, value) =>
    storage(token).writeNew(text(file), bytes(value)),
  );
  handle('project:replace', (token, file, value, expected) =>
    storage(token).replaceAtomic(
      text(file),
      bytes(value, 64 * 1024),
      expected === undefined ? undefined : bytes(expected, 64 * 1024),
    ),
  );
  handle('project:list', (token, directory) => storage(token).list(text(directory)));
  handle('project:remove', (token, file) => storage(token).removeFile(text(file)));
  handle('editor:close-ready', () => {
    rendererReady = true;
  });
  handle('editor:finish-close', (id, allow) => {
    if (typeof id !== 'string' || typeof allow !== 'boolean') throw new Error('关闭参数无效');
    closeController.complete(id, allow);
    if (allow) setImmediate(() => window.close());
  });
}

void app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      width: 1600,
      height: 1000,
      minWidth: 1280,
      minHeight: 720,
      show: false,
      title: '山河地图编辑器',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      // Vite 首次依赖预热可能重载；编辑器就绪后不允许导航绕过关闭保护。
      if (rendererReady || url !== trustedUrl) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))
        event.preventDefault();
    });
    const session = window.webContents.session;
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: ws://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'",
          ],
        },
      });
    });
    installHandlers();
    window.on('close', (event) => {
      if (!rendererReady || closeController.consumeApproval()) return;
      event.preventDefault();
      closeController.request((id) => window.webContents.send('editor:close-request', id));
    });
    window.on('closed', () => capabilities.clear());
    window.once('ready-to-show', () => window.show());
    await window.loadURL(trustedUrl);
  })
  .catch((error: unknown) => {
    dialog.showErrorBox('桌面启动失败', String(error));
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
