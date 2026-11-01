const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('test-results/tests/display-quality-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const exe = path.resolve(
    `dist/mapEdtor-v${require('../package.json').version}/ShanheMapEditor.exe`,
  );
  const report = { status: 'running', results: [], errors: [] };
  let app;
  const stop = async () => {
    if (!app) return;
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
      .catch(() => undefined);
    await app.close().catch(() => undefined);
    app = null;
  };
  try {
    const requestedScale = process.argv.find((value) => value.startsWith('--scale='))?.slice(8);
    const scales = requestedScale ? [Number(requestedScale)] : [1, 1.25, 2];
    assert.ok(scales.every((value) => [1, 1.25, 2].includes(value)));
    for (const scale of scales) {
      const profile = path.join(root, 'profile-' + scale);
      const launch = async () => {
        const env = {
          ...process.env,
          MAP_EDITOR_PROFILE: profile,
          MAP_EDITOR_PERFORMANCE_PROBE: '1',
        };
        delete env.ELECTRON_RUN_AS_NODE;
        app = await _electron.launch({
          executablePath: exe,
          args: ['--force_high_performance_gpu', `--force-device-scale-factor=${scale}`],
          env,
          timeout: 60000,
        });
        const page = await app.firstWindow();
        page.setDefaultTimeout(60000);
        page.on('pageerror', (error) => report.errors.push(String(error)));
        await page.evaluate(() => {
          const active = new Set();
          const request = window.requestAnimationFrame.bind(window),
            cancel = window.cancelAnimationFrame.bind(window);
          window.requestAnimationFrame = (callback) => {
            const id = request((time) => {
              active.delete(id);
              callback(time);
            });
            active.add(id);
            return id;
          };
          window.cancelAnimationFrame = (id) => {
            active.delete(id);
            cancel(id);
          };
          window.qualityActiveFrames = active;
          const NativeWorker = window.Worker,
            workers = new Set();
          window.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args);
              workers.add(this);
            }
            terminate() {
              workers.delete(this);
              super.terminate();
            }
          };
          window.qualityActiveWorkers = workers;
        });
        await app.evaluate(({ dialog, BrowserWindow }, root) => {
          BrowserWindow.getAllWindows()[0].setContentSize(1280, 720);
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
        }, root);
        return page;
      };
      const ready = (page) =>
        page.waitForFunction(
          () => window.mapEditorPerformance?.snapshot().ready,
          {},
          { timeout: 180000 },
        );
      let page = await launch();
      const readQuality = async () => {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const value = await page.getByLabel('显示档位', { exact: true }).inputValue();
        await page.getByRole('button', { name: '取消', exact: true }).click();
        return value;
      };
      const selectQuality = async (quality) => {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByLabel('显示档位', { exact: true }).selectOption(quality);
        await page.getByRole('button', { name: '应用', exact: true }).click();
        await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'hidden' });
      };

      console.log(`Windows scale ${scale}: 创建测试工程`);
      await page.getByRole('button', { name: '创建工程', exact: true }).click();
      await page.getByLabel('工程名称').fill('scale-' + scale);
      await page.getByRole('button', { name: '选择父目录' }).click();
      if (scale === 1.25) await page.getByLabel('导入示例工程').check();
      await page.getByRole('button', { name: '创建工程', exact: true }).click();
      await ready(page);
      assert.equal(await readQuality(), 'fast');
      if (scale === 1.25) {
        await page.locator('.left-panel .object-row').filter({ hasText: '临江城' }).click();
        for (const name of ['档位测试城一', '档位测试城二']) {
          await page.getByLabel('据点名称', { exact: true }).fill(name);
          await page.getByLabel('据点名称', { exact: true }).blur();
        }
        await page.getByRole('button', { name: '撤销', exact: true }).click();
      }
      await page.evaluate(() => window.mapEditorPerformance.configure('current'));
      await ready(page);
      for (const projection of ['perspective', 'orthographic']) {
        if (projection === 'orthographic')
          await page.getByRole('button', { name: '切换透视 / 正交' }).click();
        const content = await page.evaluate(() => window.mapEditorPerformance.integrity());
        if (scale === 1.25) {
          assert.ok(content.dirty);
          assert.ok(content.selection.site);
          assert.ok(content.redoLabel);
        }
        const camera = (await page.evaluate(() => window.mapEditorPerformance.snapshot())).camera;
        for (const quality of ['high', 'balanced', 'fast', 'high', 'fast']) {
          await page.evaluate(() => {
            const canvas = document.querySelector('[data-testid="map-canvas"]');
            window.qualityOldGl = canvas.getContext('webgl2');
          });
          await selectQuality(quality);
          await ready(page);
          await page.waitForFunction(() => window.qualityOldGl.isContextLost());
          const snap = await page.evaluate(() => window.mapEditorPerformance.snapshot());
          assert.deepEqual(snap.camera, camera, '切档必须保留相机');
          assert.deepEqual(
            await page.evaluate(() => window.mapEditorPerformance.integrity()),
            content,
            '切档必须保留数据、选择及历史',
          );
          assert.equal(await page.locator('[data-testid="map-canvas"]').count(), 1);
          assert.equal(snap.context.attributes.antialias, quality === 'high');
          assert.equal(snap.shadow.enabled, quality !== 'fast');
          assert.equal(snap.display.shadowSize, quality === 'high' ? 2048 : 1024);
          assert.equal(snap.display.anisotropy, quality === 'fast' ? 1 : 4);
          if (quality === 'fast') {
            assert.equal(snap.display.normalDetail, 0);
            assert.ok(snap.viewport.width * snap.viewport.height <= 921600);
          }
          const desiredRatio =
            quality === 'high'
              ? Math.min(scale, 1.75)
              : quality === 'balanced'
                ? Math.min(scale, 1)
                : 0.75;
          assert.ok(Math.abs(snap.viewport.pixelRatio - desiredRatio) < 0.001);
          assert.equal(snap.camera.projection, projection);
          if (scale !== 1.25) {
            const box = await page.locator('[data-testid="map-canvas"]').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForFunction(() => window.mapEditorPerformance.snapshot().hover !== null);
            const point = (await page.evaluate(() => window.mapEditorPerformance.snapshot())).hover;
            assert.ok(Math.abs(point.x) < 1 && Math.abs(point.z) < 1, '拾取必须使用 CSS 坐标');
          }
          await page.waitForTimeout(100);
          assert.ok(
            (await page.evaluate(() => window.qualityActiveFrames.size)) <= 1,
            '按需绘制最多只允许一个待执行帧',
          );
          assert.ok(
            (await page.evaluate(() => window.qualityActiveWorkers.size)) <= 1,
            '切档必须终止旧草计算线程',
          );
          report.results.push({
            scale,
            projection,
            quality,
            viewport: snap.viewport,
            memory: snap.memory,
          });
          console.log(`scale ${scale} ${projection} ${quality}: verified`);
        }
      }
      if (scale !== 1.25) {
        await page.locator('.tool-rail button').filter({ hasText: '地形' }).click();
        await page.getByRole('button', { name: '抬高', exact: true }).click();
        const beforeBrush = await page.evaluate(() => window.mapEditorPerformance.integrity());
        const box = await page.locator('[data-testid="map-canvas"]').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.up();
        await ready(page);
        const painted = await page.evaluate(() => window.mapEditorPerformance.integrity());
        assert.notDeepEqual(painted.files, beforeBrush.files, '流畅档真实笔刷必须修改地形');
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        assert.deepEqual(
          (await page.evaluate(() => window.mapEditorPerformance.integrity())).files,
          beforeBrush.files,
          '笔刷撤销必须恢复地形',
        );
      }
      await page.screenshot({ path: path.join(root, `scale-${scale}-1280.png`) });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000),
      );
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(root, `scale-${scale}-1600.png`) });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(3840, 2160),
      );
      await page.waitForTimeout(300);
      const large = await page.evaluate(() => window.mapEditorPerformance.snapshot());
      assert.ok(
        large.viewport.width * large.viewport.height <= 921600,
        '大窗口流畅档必须限制实际像素量',
      );
      report.results.push({ scale, largeViewport: large.viewport });
      await selectQuality('balanced');
      await ready(page);
      // 强制关闭只针对本工具生成的临时工程，验证偏好独立于保存状态持久化。
      await stop();
      page = await launch();
      await page.locator('.home-project').first().click();
      await ready(page);
      assert.equal(await readQuality(), 'balanced');
      await stop();
      console.log(
        `Windows scale ${scale}: 切档、投影、数据历史、拾取、资源释放、单循环及重启偏好通过`,
      );
    }
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(String(error));
    throw error;
  } finally {
    await stop();
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(root);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
