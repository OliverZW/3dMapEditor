const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const base = path.resolve('test-results', 'desktop-smoke-' + randomUUID());
  await fs.mkdir(base, { recursive: true });
  const directory = path.join(base, '桌面中文工程');
  const variables = { ...process.env, MAP_EDITOR_DEV_URL: environment.url };
  delete variables.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env: variables,
      timeout: 60000,
    });
    const page = await application.firstWindow();
    page.on('requestfailed', (request) =>
      console.log('桌面请求失败', request.url(), request.failure()?.errorText),
    );
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => 'invoke' in window.mapEditorDesktop), false);
    const makeDirty = async () => {
      await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
      const slider = page.getByRole('slider', { name: '细节强度', exact: true });
      await slider.press(Number(await slider.inputValue()) > 50 ? 'Home' : 'End');
    };
    // 关闭流程中取消目录选择，必须继续保留未保存地图和确认框。
    await application.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    await makeDirty();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const guard = page.getByRole('dialog', { name: '保留当前编辑？' });
    await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
    await guard.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'visible' });
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(application.windows().length, 1);
    // 测试中替代操作系统对话框的返回值；所有读写仍走真实 preload/IPC 和 Windows 适配器。
    await application.evaluate(({ dialog }, directory) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: directory });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory + '/project.map3dproj'],
      });
    }, directory);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.getByText('工程已保存：' + directory, { exact: true }).waitFor();
    const first = JSON.parse(await fs.readFile(path.join(directory, 'project.map3dproj'), 'utf8'));
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await page.getByText('已打开工程：' + directory, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(base, 'desktop-editor.png') });
    const rejectedPath = await page.evaluate(async () => {
      const bridge = window.mapEditorDesktop;
      const handle = await bridge.selectProject('open');
      try {
        await bridge.read(handle.token, '../outside', 4096);
        return false;
      } catch (error) {
        return error.message.includes('路径');
      } finally {
        await bridge.releaseProject(handle.token);
      }
    });
    assert(rejectedPath);
    await makeDirty();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await guard.waitFor();
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(application.windows().length, 1);
    // 注入真实的锁冲突，确认保存失败不会退出。
    await fs.writeFile(path.join(directory, '.map3d-write.lock'), '测试占用');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
    await page.getByText(/工程写入锁已存在/).waitFor();
    assert.equal(application.windows().length, 1);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(directory, 'project.map3dproj'), 'utf8')),
      first,
    );
    await fs.unlink(path.join(directory, '.map3d-write.lock'));
    const closed = page.waitForEvent('close');
    await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
    await closed;
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'project.map3dproj'), 'utf8'));
    assert.equal(saved.projectId, first.projectId);
    assert.notEqual(saved.dataRevision, first.dataRevision);
    assert.deepEqual(errors, []);
    await application.close().catch(() => undefined);
    application = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env: variables,
      timeout: 60000,
    });
    const discardPage = await application.firstWindow();
    discardPage.on('pageerror', (error) => errors.push(String(error)));
    discardPage.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await discardPage.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    await application.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory + '/project.map3dproj'],
      });
    }, directory);
    await discardPage.getByRole('button', { name: '打开', exact: true }).click();
    await discardPage.getByText('已打开工程：' + directory, { exact: true }).waitFor();
    await discardPage.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    await discardPage.getByRole('slider', { name: '细节强度', exact: true }).press('End');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const discarded = discardPage.waitForEvent('close');
    await discardPage
      .getByRole('dialog', { name: '保留当前编辑？' })
      .getByRole('button', { name: '放弃并继续', exact: true })
      .click();
    await discarded;
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(directory, 'project.map3dproj'), 'utf8')),
      saved,
    );
    assert.deepEqual(errors, []);
    console.log(
      'Electron 沙箱/隔离、路径授权、中文目录创建保存重开、取消选择与退出、保存失败保留窗口、保存成功退出和放弃退出：通过',
    );
  } catch (error) {
    if (application)
      console.error(
        '桌面窗口状态',
        await application
          .evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((window) => ({
              url: window.webContents.getURL(),
              loading: window.webContents.isLoadingMainFrame(),
            })),
          )
          .catch(() => []),
      );
    throw error;
  } finally {
    if (application) {
      await application
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
        )
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await environment.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
