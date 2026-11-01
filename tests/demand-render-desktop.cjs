const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

(async () => {
  const root = path.resolve('test-results/tests/demand-render-desktop-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const exe = path.resolve(
    `dist/mapEdtor-v${require('../package.json').version}/ShanheMapEditor.exe`,
  );
  const report = {
    status: 'running',
    conditions: { executable: exe, idleDurationMs: 15000, idleRounds: 3 },
    checks: [],
    errors: [],
  };
  let app;
  try {
    report.conditions.asarSha256 = createHash('sha256')
      .update(await fs.readFile(path.join(path.dirname(exe), 'resources/app.asar')))
      .digest('hex');
    const env = {
      ...process.env,
      MAP_EDITOR_PROFILE: path.join(root, 'profile'),
      MAP_EDITOR_PERFORMANCE_PROBE: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: exe, env, timeout: 60000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => report.errors.push(String(e)));
    await app.evaluate(({ BrowserWindow, dialog }, root) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(1600, 1000);
      w.show();
      w.focus();
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    const snap = () => page.evaluate(() => window.mapEditorPerformance.snapshot());
    const ready = () => page.waitForFunction(() => window.mapEditorPerformance?.snapshot().ready);
    const idle = () =>
      page.waitForFunction(() => {
        const s = window.mapEditorPerformance?.snapshot();
        return s?.ready && s.scheduling.idle && !s.scheduling.pending;
      });
    const persist = () =>
      fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    for (const scene of ['blank', 'demo']) {
      await page.getByRole('button', { name: '创建工程', exact: true }).click();
      await page.getByLabel('工程名称').fill(scene);
      await page.getByRole('button', { name: '选择父目录' }).click();
      if (scene === 'demo') await page.getByLabel('导入示例工程').check();
      await page.getByRole('button', { name: '创建工程', exact: true }).click();
      await ready();
      if (scene === 'blank') {
        await page.mouse.move(20, 20);
        await idle();
        report.conditions.initial = await snap();
        report.conditions.system = await app.evaluate(
          async ({ app, screen, BrowserWindow, powerMonitor }) => ({
            packaged: app.isPackaged,
            gpuStatus: app.getGPUFeatureStatus(),
            gpu: await app.getGPUInfo('complete'),
            display: screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()),
            onBattery: powerMonitor.isOnBatteryPower(),
          }),
        );
        const original = await page.evaluate(() => window.mapEditorPerformance.integrity());
        for (let round = 1; round <= 3; round++) {
          const before = await snap();
          await page.waitForTimeout(15000);
          const after = await snap();
          report.lastIdleComparison = { before, after };
          assert.equal(after.scheduling.renderedFrames, before.scheduling.renderedFrames);
          assert.equal(after.scheduling.pending, false);
          assert.equal(after.stats.idle, true);
          await page.getByLabel('渲染统计').getByText('静止 · 按需刷新').waitFor();
          report.checks.push({ name: 'blank-idle', round, before, after });
          await persist();
          console.log('blank idle 15s round', round, ': 0 submissions');
        }
        assert.deepEqual(
          await page.evaluate(() => window.mapEditorPerformance.integrity()),
          original,
        );
        // 对睡眠中的真实发布版执行相机、投影、格线与笔刷操作。
        let before = await snap();
        const box = await page.getByTestId('map-canvas').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -140);
        await idle();
        assert.notDeepEqual((await snap()).camera.position, before.camera.position);
        await page.getByRole('button', { name: '切换透视 / 正交' }).click();
        await idle();
        assert.equal((await snap()).camera.projection, 'orthographic');
        await page.getByRole('button', { name: '切换透视 / 正交' }).click();
        await idle();
        const grid = page.getByRole('button', { name: '六边形格线', exact: true });
        await grid.click();
        await idle();
        await grid.click();
        await idle();
        await page.locator('.tool-rail button').filter({ hasText: '地形' }).click();
        await page.getByRole('button', { name: '抬高', exact: true }).click();
        const initial = await page.evaluate(() => window.mapEditorPerformance.integrity());
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 8, { steps: 8 });
        await page.mouse.up();
        await idle();
        assert.notDeepEqual(
          (await page.evaluate(() => window.mapEditorPerformance.integrity())).files,
          initial.files,
        );
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await idle();
        assert.deepEqual(
          (await page.evaluate(() => window.mapEditorPerformance.integrity())).files,
          initial.files,
        );
        // 取消画刷/离开画布不残留光标，调整窗口唤醒，切档后仍可休眠。
        await page.mouse.move(50, 50);
        await idle();
        assert.equal((await snap()).hover, null);
        before = await snap();
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setContentSize(1280, 800),
        );
        await page.waitForFunction(
          (width) => window.mapEditorPerformance.snapshot().viewport.cssWidth !== width,
          before.viewport.cssWidth,
        );
        await idle();
        assert.ok((await snap()).scheduling.renderedFrames > before.scheduling.renderedFrames);
        for (const quality of ['high', 'balanced', 'fast']) {
          await page.getByLabel('显示档位', { exact: true }).selectOption(quality);
          await idle();
          assert.equal((await snap()).displayQuality, quality);
        }
        await page.screenshot({ path: path.join(root, 'blank-idle.png') });
        report.checks.push({ name: 'blank-interaction-wakeup', after: await snap() });
      } else {
        await page.evaluate(() => window.mapEditorPerformance.configure('current'));
        await ready();
        let before = await snap();
        await page.waitForTimeout(1000);
        let after = await snap();
        assert.ok(
          after.scheduling.visibleWater &&
            after.scheduling.renderedFrames - before.scheduling.renderedFrames > 10,
        );
        report.checks.push({ name: 'visible-water-animated', before, after });
        const content = await page.evaluate(() => window.mapEditorPerformance.integrity());
        // Playwright 默认强制页面保持聚焦/可见；关闭该模拟后验证真实 Windows 最小化。
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
        await page.waitForFunction(
          () => !window.mapEditorPerformance.snapshot().scheduling.hostVisible,
          undefined,
          { polling: 100 },
        );
        await page.waitForTimeout(200);
        before = await snap();
        await page.waitForTimeout(1500);
        after = await snap();
        assert.equal(after.scheduling.renderedFrames, before.scheduling.renderedFrames);
        report.checks.push({ name: 'minimized-no-submissions', before, after });
        await app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows()[0];
          w.restore();
          w.show();
          w.focus();
        });
        await page.waitForFunction(
          () => window.mapEditorPerformance.snapshot().scheduling.hostVisible,
          undefined,
          { polling: 100 },
        );
        await page.waitForFunction(
          (count) => window.mapEditorPerformance.snapshot().scheduling.renderedFrames > count + 3,
          after.scheduling.renderedFrames,
        );
        report.checks.push({ name: 'restore-resumes-animation', after: await snap() });
        await cdp.detach();
        await page.getByRole('button', { name: '河流水面', exact: true }).click();
        await page
          .getByRole('toolbar', { name: '视口显示' })
          .getByRole('button', { name: '草丛', exact: true })
          .click();
        await idle();
        before = await snap();
        await page.waitForTimeout(15000);
        after = await snap();
        assert.equal(after.scheduling.renderedFrames, before.scheduling.renderedFrames);
        assert.deepEqual(
          await page.evaluate(() => window.mapEditorPerformance.integrity()),
          content,
        );
        report.checks.push({ name: 'hidden-animation-layers-idle', before, after });
        // 恢复全部内容，列表选择/取消即时刷新，不修改工程。
        await page.locator('.tool-rail button').filter({ hasText: '据点' }).click();
        await page.locator('.left-panel .object-row').filter({ hasText: '临江城' }).click();
        await idle();
        assert.ok(
          (await page.evaluate(() => window.mapEditorPerformance.integrity())).selection.site,
        );
        await page.getByRole('button', { name: '河流水面', exact: true }).click();
        await page
          .getByRole('toolbar', { name: '视口显示' })
          .getByRole('button', { name: '草丛', exact: true })
          .click();
        await page.waitForFunction(
          () => window.mapEditorPerformance.snapshot().scheduling.visibleWater,
        );
        await page.screenshot({ path: path.join(root, 'demo-restored.png') });
      }
      await persist();
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await page.waitForFunction(
        () =>
          !!document.querySelector('.home-screen') ||
          [...document.querySelectorAll('[role=dialog]')].some((el) =>
            el.textContent.includes('保留当前编辑'),
          ),
        undefined,
        { polling: 100 },
      );
      const discard = page.getByRole('button', { name: '放弃并继续', exact: true });
      if (await discard.isVisible()) await discard.click();
      await page.getByRole('button', { name: '创建工程', exact: true }).waitFor();
    }
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } catch (e) {
    report.status = 'failed';
    report.failure = e.stack;
    throw e;
  } finally {
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
        .catch(() => undefined);
      await app.close().catch(() => undefined);
    }
    console.log(root, report.status);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
