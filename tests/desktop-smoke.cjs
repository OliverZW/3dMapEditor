const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const base = path.resolve('test-results', 'desktop-home-' + randomUUID());
  await fs.mkdir(base, { recursive: true });
  const variables = {
    ...process.env,
    MAP_EDITOR_DEV_URL: environment.url,
    MAP_EDITOR_PROFILE: path.join(base, 'profile'),
  };
  delete variables.ELECTRON_RUN_AS_NODE;
  let application;
  const launch = async () => {
    application = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env: variables,
      timeout: 60000,
    });
    const page = await application.firstWindow();
    page.setDefaultTimeout(30000);
    await application.evaluate(({ dialog }, base) => {
      globalThis.testOpenPath = null;
      dialog.showOpenDialog = async (_window, options) =>
        options.properties.includes('openDirectory')
          ? { canceled: false, filePaths: [base] }
          : globalThis.testOpenPath
            ? { canceled: false, filePaths: [globalThis.testOpenPath] }
            : { canceled: true, filePaths: [] };
    }, base);
    return page;
  };
  try {
    let page = await launch();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.getByRole('heading', { name: '三维战略地图编辑器' }).waitFor();
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => 'invoke' in window.mapEditorDesktop), false);
    assert.equal(await page.getByText('近期工程').count(), 0);
    await page.getByRole('button', { name: '打开工程', exact: true }).click();
    assert.equal(await page.getByText('近期工程').count(), 0);
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('空白地图');
    await page.getByRole('button', { name: '选择父目录' }).click();
    assert.equal(await page.getByLabel('导入示例工程').isChecked(), false);
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    const blankPath = path.join(base, '空白地图');
    const blank = JSON.parse(await fs.readFile(path.join(blankPath, 'project.map3dproj'), 'utf8'));
    const blankObjects = JSON.parse(
      await fs.readFile(path.join(blankPath, 'data', blank.dataRevision, 'objects.json'), 'utf8'),
    );
    assert.deepEqual(blankObjects.trees, []);
    assert.deepEqual(blankObjects.sites, []);
    await page.getByRole('button', { name: '返回首页' }).click();
    await page.getByRole('heading', { name: '近期工程' }).waitFor();
    await application.evaluate(
      (_electron, file) => {
        globalThis.testOpenPath = file;
      },
      path.join(blankPath, 'project.map3dproj'),
    );
    const rejectedPath = await page.evaluate(async () => {
      const bridge = window.mapEditorDesktop,
        handle = await bridge.selectProject('open');
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
    await page
      .getByRole('button', { name: /空白地图/ })
      .first()
      .click();
    await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    await page.getByRole('slider', { name: '细节强度', exact: true }).press('End');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const guard = page.getByRole('dialog', { name: '保留当前编辑？' });
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    await fs.writeFile(path.join(blankPath, '.map3d-write.lock'), '测试占用');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
    await page.getByText(/工程写入锁已存在/).waitFor();
    assert.equal(application.windows().length, 1);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(blankPath, 'project.map3dproj'), 'utf8')),
      blank,
    );
    await fs.unlink(path.join(blankPath, '.map3d-write.lock'));
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '返回首页' }).click();
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    assert(await page.getByRole('button', { name: '保存工程', exact: true }).isVisible());
    await page.getByRole('button', { name: '返回首页' }).click();
    await guard.getByRole('button', { name: '放弃并继续', exact: true }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    // 已存在目录不能覆盖；失败后原工程和未保存编辑仍可返回。
    await page.getByLabel('工程名称').fill('空白地图');
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '返回编辑器', exact: true }).click();
    assert(await page.getByRole('button', { name: '保存工程', exact: true }).isVisible());
    await page.getByRole('button', { name: '返回首页' }).click();
    await guard.getByRole('button', { name: '放弃并继续', exact: true }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('示例副本');
    await page.getByLabel('导入示例工程').check();
    assert(await page.getByLabel('地形采样').isDisabled());
    assert.equal(await page.getByLabel('地面宽度（米）').inputValue(), '2048');
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    const examplePath = path.join(base, '示例副本');
    const example = JSON.parse(
      await fs.readFile(path.join(examplePath, 'project.map3dproj'), 'utf8'),
    );
    const objects = JSON.parse(
      await fs.readFile(
        path.join(examplePath, 'data', example.dataRevision, 'objects.json'),
        'utf8',
      ),
    );
    assert.notEqual(example.projectId, blank.projectId);
    assert(objects.trees.length > 0);
    await page.getByRole('button', { name: '返回首页' }).click();
    assert.equal(await page.locator('.home-recent-row').count(), 2);
    // 只移动本次测试创建的目录，模拟记录失效，重新定位指向同一工程。
    const moved = path.join(base, '移动后的空白地图');
    assert(blankPath.startsWith(base + path.sep) && moved.startsWith(base + path.sep));
    await fs.rename(blankPath, moved);
    await page
      .getByRole('button', { name: /空白地图/ })
      .first()
      .click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.home-recent-row').count(), 2);
    await application.evaluate(
      (_electron, file) => {
        globalThis.testOpenPath = file;
      },
      path.join(moved, 'project.map3dproj'),
    );
    const row = page.locator('.home-recent-row').filter({ hasText: '空白地图' });
    await row.getByRole('button', { name: '重新定位' }).click();
    await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    await page.getByRole('button', { name: '返回首页' }).click();
    assert.equal(await page.locator('.home-recent-row').count(), 2);
    const close = page.waitForEvent('close');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await close;
    await application.close().catch(() => undefined);
    page = await launch();
    await page.getByRole('heading', { name: '近期工程' }).waitFor();
    assert.equal(await page.locator('.home-recent-row').count(), 2);
    await page
      .locator('.home-recent-row')
      .filter({ hasText: '空白地图' })
      .getByRole('button', { name: '移除' })
      .click();
    await page.waitForFunction(() => document.querySelectorAll('.home-recent-row').length === 1);
    assert.equal((await fs.stat(path.join(moved, 'project.map3dproj'))).isFile(), true);
    assert.deepEqual(errors, []);
    await page
      .getByRole('button', { name: /示例副本/ })
      .first()
      .click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    await page.getByRole('slider', { name: '细节强度', exact: true }).press('End');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const savedClose = page.waitForEvent('close');
    await page
      .getByRole('dialog', { name: '保留当前编辑？' })
      .getByRole('button', { name: '保存后继续', exact: true })
      .click();
    await savedClose;
    const savedExample = JSON.parse(
      await fs.readFile(path.join(examplePath, 'project.map3dproj'), 'utf8'),
    );
    assert.notEqual(savedExample.dataRevision, example.dataRevision);
    await application.close().catch(() => undefined);
    page = await launch();
    await page
      .getByRole('button', { name: /示例副本/ })
      .first()
      .click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    await page.getByRole('slider', { name: '细节强度', exact: true }).press('Home');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const discarded = page.waitForEvent('close');
    await page
      .getByRole('dialog', { name: '保留当前编辑？' })
      .getByRole('button', { name: '放弃并继续', exact: true })
      .click();
    await discarded;
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(examplePath, 'project.map3dproj'), 'utf8')),
      savedExample,
    );
    await application.close().catch(() => undefined);
    const recentFile = path.join(base, 'profile', 'recent-projects.json');
    await fs.writeFile(recentFile, '[{"invalid":true}]');
    page = await launch();
    await page.getByRole('alert').filter({ hasText: '近期工程记录格式错误' }).waitFor();
    assert.equal(await fs.readFile(recentFile, 'utf8'), '[{"invalid":true}]');
    console.log(
      '首页空状态、创建空白和示例副本、未保存保护、近期记录持久化、失效重新定位与移除：通过',
    );
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
