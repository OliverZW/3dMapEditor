const { _electron } = require('playwright');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const base = path.resolve('test-results', `backup-smoke-${randomUUID()}`);
  await fs.mkdir(base, { recursive: true });
  const backup = path.join(base, '备份.map3d');
  const restored = path.join(base, '恢复工程');
  const env = {
    ...process.env,
    MAP_EDITOR_DEV_URL: environment.url,
    MAP_EDITOR_PROFILE: path.join(base, 'profile'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env,
      timeout: 60000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await app.evaluate(
      ({ dialog }, values) => {
        globalThis.testBackupPath = values.backup;
        dialog.showOpenDialog = async (_window, options) => ({
          canceled: false,
          filePaths: [
            options.properties.includes('openDirectory') ? values.base : globalThis.testBackupPath,
          ],
        });
        dialog.showSaveDialog = async (_window, options) => ({
          canceled: false,
          filePath: options.filters ? values.backup : values.restored,
        });
      },
      { base, backup, restored },
    );
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('备份测试');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('button', { name: '导出备份' }).click();
    await page.locator('.status-message').filter({ hasText: '备份已保存' }).waitFor();
    const archive = unzipSync(await fs.readFile(backup));
    assert.equal(JSON.parse(strFromU8(archive['manifest.json'])).formatVersion, 4);
    const sourceDirectory = path.join(base, '备份测试');
    const source = JSON.parse(
      await fs.readFile(path.join(sourceDirectory, 'project.map3dproj'), 'utf8'),
    );
    const sourceData = await fs.readFile(
      path.join(sourceDirectory, 'data', source.dataRevision, 'terrain', 'surface.rgba'),
    );
    await page.getByRole('button', { name: '返回首页' }).click();
    await fs.rename(sourceDirectory, path.join(base, '已移动的原工程'));
    await page.getByRole('button', { name: '恢复备份' }).click();
    await page.locator('.status-message').filter({ hasText: '备份已恢复' }).waitFor();
    const result = JSON.parse(await fs.readFile(path.join(restored, 'project.map3dproj'), 'utf8'));
    assert.notEqual(source.projectId, result.projectId);
    const restoredData = await fs.readFile(
      path.join(restored, 'data', result.dataRevision, 'terrain', 'surface.rgba'),
    );
    assert.deepEqual(restoredData, sourceData);
    const old = JSON.parse(strFromU8(archive['manifest.json']));
    old.formatVersion = 3;
    archive['manifest.json'] = strToU8(JSON.stringify(old));
    const invalid = path.join(base, '旧备份.map3d');
    await fs.writeFile(invalid, zipSync(archive));
    await app.evaluate((_electron, file) => {
      globalThis.testBackupPath = file;
    }, invalid);
    await page.getByRole('button', { name: '恢复备份' }).click();
    await page.locator('.status-message').filter({ hasText: '不兼容旧版' }).waitFor();
    assert.equal(
      JSON.parse(await fs.readFile(path.join(restored, 'project.map3dproj'), 'utf8')).projectId,
      result.projectId,
    );
    assert.deepEqual(errors, []);
    console.log('桌面备份导出、独立目录恢复及旧备份拒绝通过');
  } finally {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
        )
        .catch(() => {});
      await app.close().catch(() => {});
    }
    await environment.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
