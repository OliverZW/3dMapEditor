const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
(async () => {
  const exe = path.resolve(
    process.argv.find((x) => x.startsWith('--exe='))?.slice(6) ||
      `dist/mapEdtor-v${require('../package.json').version}/ShanheMapEditor.exe`,
  );
  const label = process.argv.find((x) => x.startsWith('--label='))?.slice(8) || 'candidate';
  const root = path.resolve('test-results/tests/windows-editing-' + label + '-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const report = {
    status: 'running',
    conditions: {
      exe,
      label,
      quality: 'fast',
      contentSize: [1600, 1000],
      pointerMoves: 60,
      pointerDelayMs: 35,
      metrics:
        'browser RAF cadence; actual submitted count; actual long tasks; CPU profile. No idle FPS.',
    },
    cases: [],
    errors: [],
  };
  let app;
  try {
    report.asarSha256 = createHash('sha256')
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
    page.setDefaultTimeout(90000);
    page.on('pageerror', (e) => report.errors.push(String(e)));
    await app.evaluate(({ BrowserWindow, dialog }, root) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(1600, 1000);
      w.show();
      w.focus();
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    const snap = () => page.evaluate(() => window.mapEditorPerformance.snapshot());
    const ready = () =>
      page.waitForFunction(() => window.mapEditorPerformance?.snapshot().ready, undefined, {
        timeout: 180000,
      });
    const contents = () => page.evaluate(() => window.mapEditorPerformance.integrity());
    const persist = () =>
      fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    for (const scene of process.argv
      .find((x) => x.startsWith('--scenes='))
      ?.slice(9)
      .split(',') || ['blank-513', 'blank-1025', 'demo-513']) {
      await page.getByRole('button', { name: '创建工程', exact: true }).click();
      await page.getByLabel('工程名称').fill(scene);
      await page.getByRole('button', { name: '选择父目录' }).click();
      if (scene.startsWith('demo')) await page.getByLabel('导入示例工程').check();
      else
        await page
          .getByLabel('地形采样', { exact: true })
          .selectOption(scene.endsWith('1025') ? '1025' : '513');
      await page.getByRole('button', { name: '创建工程', exact: true }).click();
      await ready();
      if (!report.system)
        report.system = await app.evaluate(
          async ({ app, screen, BrowserWindow, powerMonitor }) => ({
            gpu: await app.getGPUInfo('complete'),
            gpuStatus: app.getGPUFeatureStatus(),
            display: screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()),
            onBattery: powerMonitor.isOnBatteryPower(),
          }),
        );
      for (const operation of ['terrain', 'camera', 'trees', 'site']) {
        await page.evaluate(() => window.mapEditorPerformance.configure('current'));
        await ready();
        await page
          .locator('.tool-rail button')
          .filter({
            hasText: operation === 'terrain' ? '地形' : operation === 'trees' ? '树木' : '据点',
          })
          .click();
        if (operation === 'terrain')
          await page.getByRole('button', { name: '抬高', exact: true }).click();
        if (operation === 'site' && !scene.startsWith('demo')) {
          await page.getByRole('button', { name: '新建城池', exact: true }).click();
          const box = await page.getByTestId('map-canvas').boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.keyboard.press('Enter');
          await ready();
        }
        if (operation === 'site') await page.locator('.left-panel .object-row').first().click();
        await page.mouse.move(20, 20);
        await page.waitForTimeout(1000);
        await ready();
        const before = await snap();
        assert.equal(before.displayQuality, 'fast');
        if (scene.startsWith('demo'))
          assert.ok(before.stats.grass > 0 && before.stats.trees > 0, '完整示例资源必须已经就绪');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
        await cdp.send('Profiler.start');
        await page.evaluate(() => {
          const m = { times: [], longs: [], active: true, started: performance.now() };
          m.observer = new PerformanceObserver((list) =>
            m.longs.push(
              ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
            ),
          );
          m.observer.observe({ type: 'longtask' });
          const tick = (t) => {
            m.times.push(t);
            if (m.active) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          window.editingMonitor = m;
        });
        const box = await page.getByTestId('map-canvas').boundingBox();
        if (operation === 'terrain' || operation === 'trees') {
          await page.mouse.move(box.x + box.width * 0.43, box.y + box.height * 0.55);
          await page.mouse.down();
          for (let i = 0; i < 60; i++) {
            await page.mouse.move(
              box.x + box.width * (0.43 + (0.15 * i) / 59),
              box.y + box.height * (0.55 + 0.025 * Math.sin(i * 0.15)),
            );
            await page.waitForTimeout(35);
          }
          await page.mouse.up();
        } else if (operation === 'camera') {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down({ button: 'right' });
          await page.keyboard.down('w');
          for (let i = 0; i < 60; i++) {
            await page.mouse.move(
              box.x + box.width / 2 + Math.sin(i * 0.04) * 40,
              box.y + box.height / 2,
            );
            await page.waitForTimeout(35);
          }
          await page.keyboard.up('w');
          await page.mouse.up({ button: 'right' });
        } else {
          for (let i = 0; i < 8; i++) {
            await page.getByLabel('据点名称', { exact: true }).fill('编辑性能测试城' + i);
            await page.getByLabel('据点名称', { exact: true }).blur();
            await page.waitForTimeout(180);
          }
        }
        await page.waitForTimeout(400);
        const result = await page.evaluate(() => {
          const m = window.editingMonitor;
          m.active = false;
          m.observer.disconnect();
          const dt = m.times
            .slice(1)
            .map((t, i) => t - m.times[i])
            .sort((a, b) => a - b);
          return {
            elapsedMs: performance.now() - m.started,
            uiFrameMs: {
              count: dt.length,
              p95: dt[Math.ceil(dt.length * 0.95) - 1],
              max: dt.at(-1),
            },
            longTasks: m.longs,
          };
        });
        const { profile } = await cdp.send('Profiler.stop');
        await cdp.detach();
        await fs.writeFile(
          path.join(root, scene + '-' + operation + '.cpuprofile'),
          JSON.stringify(profile),
        );
        const after = await snap();
        assert.equal(after.document.documentVersion, before.document.documentVersion);
        assert.ok(
          !before.context.lost &&
            !after.context.lost &&
            before.scheduling.hostVisible &&
            after.scheduling.hostVisible,
        );
        report.cases.push({
          scene,
          operation,
          ...result,
          submittedFrames: after.scheduling.renderedFrames - before.scheduling.renderedFrames,
          before,
          after,
        });
        await persist();
        console.log(
          label,
          scene,
          operation,
          JSON.stringify({
            p95: result.uiFrameMs.p95,
            max: result.uiFrameMs.max,
            longTasks: result.longTasks.length,
          }),
        );
        if (operation !== 'camera') {
          const edited = await contents();
          await page.getByRole('button', { name: '撤销', exact: true }).click();
          await ready();
          await page.getByRole('button', { name: '重做', exact: true }).click();
          await ready();
          assert.deepEqual((await contents()).files, edited.files, '重做必须恢复相同工程数据');
        }
      }
      // 真实保存与重开，不依赖备份代替原生目录工程。
      await page.getByRole('button', { name: '保存工程', exact: true }).click();
      await page.waitForFunction(
        async () => !(await window.mapEditorPerformance.integrity()).dirty,
        undefined,
        { polling: 250 },
      );
      await page.waitForFunction(
        () => {
          const button = [...document.querySelectorAll('button')].find(
            (b) => b.textContent.trim() === '保存工程',
          );
          return button && !button.disabled;
        },
        undefined,
        { polling: 100 },
      );
      const saved = await contents();
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await page.waitForTimeout(300);
      if (!(await page.locator('.home-screen').count()))
        throw new Error('返回首页受阻：' + (await page.locator('body').innerText()));
      await page.locator('.home-project').first().click();
      await ready();
      assert.deepEqual((await contents()).files, saved.files, '保存重开必须一致');
      report.cases.push({ scene, operation: 'save-reopen', passed: true });
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
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
        .catch(() => {});
      await app.close().catch(() => {});
    }
    console.log(root, report.status);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
