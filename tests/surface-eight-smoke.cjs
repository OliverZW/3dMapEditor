const { _electron } = require('playwright');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const root = path.resolve('test-results/tests/surface-eight-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const env = {
    ...process.env,
    MAP_EDITOR_DEV_URL: environment.url,
    MAP_EDITOR_PROFILE: path.join(root, 'profile'),
    MAP_EDITOR_PERFORMANCE_PROBE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors = [];
  const launch = async () => {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    return page;
  };
  const stop = async () => {
    if (app) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      );
      await app.close();
      app = null;
    }
  };
  try {
    let page = await launch();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('八地表');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    for (let i = 4; i < 8; i++) {
      await page.getByRole('button', { name: /添加地表/ }).click();
      const modal = page.getByRole('dialog', { name: '地表材质', exact: true });
      await modal.getByLabel('材质名称', { exact: true }).fill('地表' + i);
      if (i === 7) {
        const color = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 32;
          const c = canvas.getContext('2d');
          c.fillStyle = '#c02010';
          c.fillRect(0, 0, 32, 32);
          return canvas.toDataURL('image/png').split(',')[1];
        });
        await modal.getByLabel('颜色贴图', { exact: true }).setInputFiles({
          name: 'red.png',
          mimeType: 'image/png',
          buffer: Buffer.from(color, 'base64'),
        });
        await modal.getByRole('button', { name: '预览导入', exact: true }).click();
        await modal.getByText('新导入：地表7', { exact: false }).waitFor({ state: 'attached' });
      }
      await modal.getByRole('button', { name: '确认使用', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
    }
    assert.equal(await page.locator('.surface-grid button').count(), 8);
    await page.waitForFunction(() => {
      try {
        return window.mapEditorPerformance?.snapshot().ready;
      } catch {
        return false;
      }
    });
    assert.equal(
      (await page.evaluate(() => window.mapEditorPerformance.snapshot())).display.surfaceProgram,
      'surface-multi-v1-true',
    );
    await page.locator('.surface-grid button').last().click();
    const canvas = await page.getByTestId('map-canvas').boundingBox();
    await page.mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
    let entry = JSON.parse(await fs.readFile(path.join(root, '八地表/project.map3dproj'), 'utf8'));
    let map = JSON.parse(
      await fs.readFile(path.join(root, '八地表/data', entry.dataRevision, 'map.json'), 'utf8'),
    );
    assert.equal(map.surfaceMaterial.layers.length, 8);
    assert.equal(map.formatVersion, 4);
    const weights = await fs.readFile(
      path.join(root, '八地表/data', entry.dataRevision, 'terrain/surface.rgba'),
    );
    assert.equal(weights.length, 513 * 513 * 8);
    assert(weights.some((v, i) => i % 8 === 7 && v > 0));
    // 高画质也须真正编译八层地表。
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('显示档位', { exact: true }).selectOption('high');
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.mapEditorPerformance.snapshot().ready);
    assert.equal(
      (await page.evaluate(() => window.mapEditorPerformance.snapshot())).display.surfaceProgram,
      'surface-multi-v1-false',
    );
    await page.screenshot({ path: path.join(root, 'eight-painted.png') });
    await page.getByRole('button', { name: '删除当前地表', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: '删除地表确认', exact: true });
    await deletion.waitFor();
    assert(await deletion.getByRole('button', { name: '确认删除地表', exact: true }).isDisabled());
    await page.keyboard.press('Escape');
    assert.equal(await deletion.count(), 0);
    await page.getByRole('button', { name: '删除当前地表', exact: true }).click();

    await page.getByLabel('删除后替换地表').selectOption(map.surfaceMaterial.layers[0].id);
    await page.getByRole('button', { name: '确认删除地表', exact: true }).click();
    assert.equal(await page.locator('.surface-grid button').count(), 7);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await page.locator('.surface-grid button').count(), 8);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal(await page.locator('.surface-grid button').count(), 7);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
    await page.screenshot({ path: path.join(root, 'eight-surfaces.png') });
    await stop();
    page = await launch();
    await page.locator('.home-project').first().click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    assert.equal(await page.locator('.surface-grid button').count(), 7);
    await page.waitForFunction(() => {
      try {
        return window.mapEditorPerformance?.snapshot().ready;
      } catch {
        return false;
      }
    });
    // 默认地表也可删除；最终只保留草地，显岩引用随岩石删除转移。
    while ((await page.locator('.surface-grid button').count()) > 1) {
      await page.locator('.surface-grid button').last().click();
      await page.getByRole('button', { name: '删除当前地表', exact: true }).click();
      await page.getByLabel('删除后替换地表').selectOption('grass');
      await page.getByRole('button', { name: '确认删除地表', exact: true }).click();
    }
    await page.waitForFunction(() => {
      try {
        return window.mapEditorPerformance?.snapshot().ready;
      } catch {
        return false;
      }
    });
    assert.equal(
      await page.getByRole('button', { name: '删除当前地表', exact: true }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('八层添加、流畅与高画质编译、真实涂刷、删除、撤销重做和重启恢复通过：' + root);
  } catch (e) {
    if (app) {
      const page = await app.firstWindow();
      console.error(await page.locator('body').innerText());
      console.error(errors);
    }
    throw e;
  } finally {
    await stop();
    await environment.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
