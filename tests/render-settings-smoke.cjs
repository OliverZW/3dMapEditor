const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const root = path.resolve('test-results/tests', `render-settings-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const env = {
    ...process.env,
    MAP_EDITOR_DEV_URL: environment.url,
    MAP_EDITOR_PROFILE: path.join(root, 'profile'),
    MAP_EDITOR_PERFORMANCE_PROBE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = async () => {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env,
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 720),
    );
    page.setDefaultTimeout(60000);
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, root);
    return page;
  };
  const stop = async () => {
    if (app) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      );
      await app.close();
      app = null;
    }
  };
  try {
    let page = await launch();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    const ready = () => page.waitForFunction(() => window.mapEditorPerformance?.snapshot().ready);
    const snap = () => page.evaluate(() => window.mapEditorPerformance.snapshot());
    await ready();
    const initial = await snap();
    const integrity = await page.evaluate(() => window.mapEditorPerformance.integrity());
    let settings = page.getByRole('dialog', { name: '设置', exact: true });
    for (const continuous of [true, false, true, false]) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await settings.getByLabel('显示档位', { exact: true }).selectOption('balanced');
      await settings
        .getByRole('checkbox', { name: '按需渲染', exact: false })
        .setChecked(!continuous);
      await settings.getByRole('checkbox', { name: '简化地表', exact: false }).check();
      await settings.getByRole('button', { name: '应用', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      await ready();
      const current = await snap();
      assert.deepEqual(current.camera, initial.camera);
      assert.deepEqual(
        await page.evaluate(() => window.mapEditorPerformance.integrity()),
        integrity,
      );
      assert.equal(current.shadow.enabled, true);
      assert.equal(current.display.normalDetail, 0);
      assert.equal(await page.getByTestId('map-canvas').count(), 1);
      await page.waitForTimeout(1500);
      const before = (await snap()).scheduling.renderedFrames;
      await page.waitForTimeout(600);
      const after = (await snap()).scheduling.renderedFrames;
      if (continuous) assert(after > before + 2);
      else assert.equal(after, before);
      if (continuous) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
        await page.waitForFunction(
          () => !window.mapEditorPerformance.snapshot().scheduling.hostVisible,
        );
        const hidden = (await snap()).scheduling.renderedFrames;
        await page.waitForTimeout(500);
        assert.equal((await snap()).scheduling.renderedFrames, hidden);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
        await page.waitForFunction(
          () => window.mapEditorPerformance.snapshot().scheduling.hostVisible,
        );
      }
    }
    // 光照自定义选项：精度、禁用但保留、取消和旧上下文回收。
    for (const size of [512, 2048, 1024, 512]) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await settings.getByLabel('阴影精度', { exact: true }).selectOption(String(size));
      await settings.getByRole('checkbox', { name: '树木投影', exact: false }).uncheck();
      await settings.getByRole('checkbox', { name: '阴影', exact: false }).uncheck();
      assert.equal(await settings.getByLabel('阴影精度', { exact: true }).isDisabled(), true);
      assert.equal(
        await settings.getByRole('checkbox', { name: '树木投影', exact: false }).isDisabled(),
        true,
      );
      assert.equal(
        await settings.getByLabel('阴影精度', { exact: true }).inputValue(),
        String(size),
      );
      await settings.getByRole('checkbox', { name: '阴影', exact: false }).check();
      await page.evaluate(() => {
        window.oldSettingsGl = document
          .querySelector('[data-testid="map-canvas"]')
          .getContext('webgl2');
      });
      await settings.getByRole('button', { name: '应用', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      await ready();
      await page.waitForFunction(() => window.oldSettingsGl.isContextLost());
      assert.equal((await snap()).display.shadowSize, size);
      assert.deepEqual((await snap()).camera, initial.camera);
      assert.deepEqual(
        await page.evaluate(() => window.mapEditorPerformance.integrity()),
        integrity,
      );
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await settings.getByLabel('阴影精度', { exact: true }).selectOption('2048');
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await snap()).display.shadowSize, 512);
    // 使用首页创建的示例副本验证真实树木和城池投影彼此独立。
    await page.getByRole('button', { name: '返回首页', exact: true }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('光照示例');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByLabel('导入示例工程').check();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await ready();
    const exampleIntegrity = await page.evaluate(() => window.mapEditorPerformance.integrity());
    const exampleCamera = (await snap()).camera;
    assert.equal((await snap()).display.treeShadowBatches, 0);
    assert((await snap()).display.siteShadowBatches > 0);
    for (const enabled of [true, false, true, false]) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await settings.getByRole('checkbox', { name: '树木投影', exact: false }).setChecked(enabled);
      await settings.getByRole('button', { name: '应用', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      await ready();
      const current = await snap();
      assert.equal(current.display.treeShadowBatches > 0, enabled);
      assert(current.display.siteShadowBatches > 0);
      assert(current.stats.trees > 0);
      assert.deepEqual(current.camera, exampleCamera);
      assert.deepEqual(
        await page.evaluate(() => window.mapEditorPerformance.integrity()),
        exampleIntegrity,
      );
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialogBounds = await settings.boundingBox();
    const applyBounds = await settings
      .getByRole('button', { name: '应用', exact: true })
      .boundingBox();
    const viewportSize =
      page.viewportSize() ||
      (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    assert(dialogBounds.y >= 0 && applyBounds.y + applyBounds.height <= viewportSize.height);
    await page.screenshot({ path: path.join(root, 'settings-1280.png') });
    await settings.getByLabel('显卡偏好').selectOption('integrated');
    await settings.getByRole('button', { name: '应用', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    await stop();
    page = await launch();
    settings = page.getByRole('dialog', { name: '设置', exact: true });
    await page.locator('.home-project').first().click();
    await ready();
    assert.equal(
      await page.evaluate(() => window.mapEditorDesktop.activeGpuPreference),
      'integrated',
    );
    await page.getByRole('button', { name: '设置', exact: true }).click();
    assert.equal(await settings.getByLabel('显示档位', { exact: true }).inputValue(), 'balanced');
    assert.equal(await settings.getByLabel('显卡偏好').inputValue(), 'integrated');
    assert.equal(await settings.getByLabel('阴影精度', { exact: true }).inputValue(), '512');
    assert.equal(
      await settings.getByRole('checkbox', { name: '树木投影', exact: false }).isChecked(),
      false,
    );
    await fs.writeFile(
      path.join(root, 'gpu-info.json'),
      JSON.stringify(await app.evaluate(({ app }) => app.getGPUInfo('complete')), null, 2),
    );
    console.log(
      `设置调度、窗口隐藏、阴影精度、树木与城池投影、相机与数据保持及重启偏好通过：${root}`,
    );
  } finally {
    await stop();
    await environment.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
