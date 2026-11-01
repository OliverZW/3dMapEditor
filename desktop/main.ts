import { configureWindowsGpu } from './windows-gpu';
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { RecentProject } from '../src/platform/desktop-contract';
import { NativeProjectStorage } from './native-project-storage';
import { CloseController } from './close-controller';

configureWindowsGpu(process.platform, app.commandLine);
protocol.registerSchemesAsPrivileged([
  { scheme: 'shanhe', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const production = app.isPackaged;
const location = new URL(
  production ? 'shanhe://editor/' : (process.env.MAP_EDITOR_DEV_URL ?? 'http://127.0.0.1:5173/'),
);
if (
  !production &&
  (location.protocol !== 'http:' ||
    location.hostname !== '127.0.0.1' ||
    location.pathname !== '/' ||
    location.username ||
    location.password ||
    location.search ||
    location.hash)
)
  throw new Error('桌面开发入口只允许本机 Vite 服务');
const trustedUrl = location.href;
const profile =
  process.env.MAP_EDITOR_PROFILE ?? path.join(app.getPath('appData'), 'ShanheMapEditor');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const capabilities = new Map<string, NativeProjectStorage>();
const parents = new Map<string, string>();
const recentFile = path.join(profile, 'recent-projects.json');
let recentQueue: Promise<unknown> = Promise.resolve();
function recentSerial<T>(operation: () => Promise<T>): Promise<T> {
  const result = recentQueue.then(operation);
  recentQueue = result.catch(() => undefined);
  return result;
}
async function readRecent(): Promise<RecentProject[]> {
  try {
    if ((await fs.stat(recentFile)).size > 64 * 1024) throw new Error('近期工程记录超过大小限制');
    const data: unknown = JSON.parse(await fs.readFile(recentFile, 'utf8'));
    if (!Array.isArray(data)) throw new Error('近期工程记录格式错误');
    const valid = data.filter(
      (v): v is RecentProject =>
        v &&
        typeof v.id === 'string' &&
        /^[0-9a-f-]{36}$/i.test(v.id) &&
        typeof v.name === 'string' &&
        typeof v.directory === 'string' &&
        path.isAbsolute(v.directory) &&
        Number.isFinite(v.openedAt),
    );
    if (valid.length !== data.length) throw new Error('近期工程记录格式错误');
    return valid.slice(0, 10);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`近期工程记录读取失败：${recentFile}：${String(error)}`);
  }
}
async function writeRecent(items: RecentProject[]) {
  const temporary = path.join(profile, `recent-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(items), { flag: 'wx' });
    await fs.rename(temporary, recentFile);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('近期记录临时文件清理失败', error);
    });
  }
}
let window: BrowserWindow;
let rendererReady = false;
let pageReady = false;
let pendingProject: string | undefined;
function queueProject(args: string[]) {
  const candidate = args.find(
    (arg) => path.isAbsolute(arg) && path.basename(arg).toLowerCase() === 'project.map3dproj',
  );
  if (!candidate) return;
  pendingProject = path.resolve(candidate);
  if (pageReady) deliverProject();
}
function deliverProject() {
  if (!pendingProject || !window || window.isDestroyed()) return;
  const directory = path.dirname(pendingProject);
  pendingProject = undefined;
  const token = randomUUID();
  capabilities.set(token, new NativeProjectStorage(directory));
  window.webContents.send('project:open-external', { token, directory });
}
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
  queueProject(process.argv);
  app.on('second-instance', (_event, args) => {
    queueProject(args);
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
}
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
  handle('backup:save', async (name, data) => {
    const filename = text(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const value = bytes(data, 256 * 1024 * 1024);
    const selected = await dialog.showSaveDialog(window, {
      title: '保存自包含备份',
      defaultPath: path.join(app.getPath('documents'), `${filename}.map3d`),
      filters: [{ name: '地图备份', extensions: ['map3d'] }],
    });
    if (selected.canceled || !selected.filePath) return false;
    const target = path.resolve(selected.filePath);
    const temporary = path.join(path.dirname(target), `.shanhe-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, value, { flag: 'wx' });
      await fs.rename(temporary, target);
    } finally {
      await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') console.warn('备份临时文件清理失败', error);
      });
    }
    return true;
  });
  handle('backup:select', async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: '选择 v4 备份',
      properties: ['openFile'],
      filters: [{ name: '地图备份', extensions: ['map3d'] }],
    });
    if (selected.canceled || !selected.filePaths.length) return null;
    const file = selected.filePaths[0];
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 256 * 1024 * 1024)
      throw new Error('备份文件无效或超过 256 MiB');
    const data = await fs.readFile(file);
    if (data.length > 256 * 1024 * 1024) throw new Error('备份文件超过 256 MiB');
    return new Uint8Array(data);
  });
  handle('project:select-parent', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '选择工程父目录',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const directory = path.resolve(result.filePaths[0]),
      token = randomUUID();
    parents.set(token, directory);
    return { token, directory };
  });
  handle('project:create', (parentToken, name) => {
    const parent = parents.get(text(parentToken));
    if (!parent) throw new Error('工程父目录授权已失效');
    const folder = text(name).trim();
    if (
      !folder ||
      folder.length > 128 ||
      /[<>:"/\\|?*\x00-\x1f]/.test(folder) ||
      /[. ]$/.test(folder) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)
    )
      throw new Error('工程名称不能用作文件夹名称');
    const token = randomUUID(),
      adapter = new NativeProjectStorage(path.join(parent, folder));
    capabilities.set(token, adapter);
    return { token, directory: adapter.root };
  });
  handle('recent:list', () => recentSerial(readRecent));
  handle('recent:remove', (id) =>
    recentSerial(async () => {
      await writeRecent((await readRecent()).filter((item) => item.id !== text(id)));
    }),
  );
  handle('recent:open', (id) =>
    recentSerial(async () => {
      const item = (await readRecent()).find((item) => item.id === text(id));
      if (!item) throw new Error('近期工程记录不存在');
      const token = randomUUID(),
        adapter = new NativeProjectStorage(item.directory);
      capabilities.set(token, adapter);
      return { token, directory: adapter.root };
    }),
  );
  handle('recent:remember', (token) =>
    recentSerial(async () => {
      const adapter = storage(token),
        bytes = await adapter.read('project.map3dproj', 4096);
      if (!bytes) throw new Error('工程入口不存在');
      const entry: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('projectId' in entry) ||
        typeof entry.projectId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(entry.projectId) ||
        !('name' in entry) ||
        typeof entry.name !== 'string'
      )
        throw new Error('工程入口无效');
      const previous = await readRecent();
      const existing = previous.find(
        (item) => item.directory.toLowerCase() === adapter.root.toLowerCase(),
      );
      const items = previous.filter(
        (item) => item.directory.toLowerCase() !== adapter.root.toLowerCase(),
      );
      items.unshift({
        id: existing?.id ?? randomUUID(),
        name: entry.name,
        directory: adapter.root,
        openedAt: Date.now(),
      });
      await writeRecent(items.slice(0, 10));
    }),
  );
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
    if (parents.delete(String(token))) return;
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

if (ownsInstance)
  void app
    .whenReady()
    .then(async () => {
      if (production) {
        const root = path.join(app.getAppPath(), 'renderer');
        protocol.handle('shanhe', (request) => {
          const url = new URL(request.url);
          if (url.hostname !== 'editor' || url.search || url.hash)
            return new Response('Not found', { status: 404 });
          let pathname: string;
          try {
            pathname = decodeURIComponent(url.pathname);
          } catch {
            return new Response('Bad path', { status: 400 });
          }
          if (pathname.includes('\\') || pathname.split('/').includes('..'))
            return new Response('Bad path', { status: 400 });
          const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
          const relative = path.relative(root, file);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
            return new Response('Bad path', { status: 400 });
          return net.fetch(pathToFileURL(file).toString());
        });
      }
      Menu.setApplicationMenu(null);
      window = new BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 1280,
        minHeight: 720,
        show: false,
        title: '山河地图编辑器',
        webPreferences: {
          additionalArguments:
            process.env.MAP_EDITOR_PERFORMANCE_PROBE === '1'
              ? ['--map-editor-performance-probe']
              : [],
          preload: path.join(__dirname, 'preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        },
      });
      const publishWindowVisibility = () => {
        if (!window.isDestroyed())
          window.webContents.send(
            'editor:window-visible',
            window.isVisible() && !window.isMinimized(),
          );
      };
      window.on('show', publishWindowVisibility);
      window.on('hide', publishWindowVisibility);
      window.on('minimize', publishWindowVisibility);
      window.on('restore', publishWindowVisibility);
      window.webContents.on('did-finish-load', publishWindowVisibility);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        // Vite 首次依赖预热可能重载；编辑器就绪后不允许导航绕过关闭保护。
        if (rendererReady || url !== trustedUrl) event.preventDefault();
      });
      window.webContents.on('will-redirect', (event) => event.preventDefault());
      window.webContents.on('did-finish-load', () => {
        pageReady = true;
        deliverProject();
      });
      window.webContents.on('before-input-event', (event, input) => {
        if (
          input.key === 'F5' ||
          ((input.control || input.meta) && input.key.toLowerCase() === 'r')
        )
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
