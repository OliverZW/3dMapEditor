const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// 最终便携版的交互回归；所有原生文件操作限于本次独立测试目录。
(async () => {
  const root = path.resolve('test-results/tests/windows-release-interaction-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const exe = path.resolve(
    `dist/mapEdtor-v${require('../package.json').version}/ShanheMapEditor.exe`,
  );
  const report = { status: 'running', cases: [], errors: [] };
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
    await app.evaluate(({ BrowserWindow, dialog }, folder) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1600, 1000);
      window.show();
      window.focus();
      globalThis.testOpenPath = folder;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [globalThis.testOpenPath],
      });
    }, root);
    const ready = () =>
      page.waitForFunction(() => window.mapEditorPerformance?.snapshot().ready, undefined, {
        timeout: 180000,
      });
    const snap = () => page.evaluate(() => window.mapEditorPerformance.snapshot());
    const contents = () => page.evaluate(() => window.mapEditorPerformance.integrity());
    for (const scene of ['blank-513', 'blank-1025', 'demo-513']) {
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
      await page.evaluate(() => window.mapEditorPerformance.configure('current'));
      await ready();
      const initial = await contents();
      const box = await page.getByTestId('map-canvas').boundingBox();
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      let camera = (await snap()).camera;
      await page.mouse.move(x, y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(x + 70, y + 25, { steps: 12 });
      await page.mouse.up({ button: 'middle' });
      assert.notDeepEqual((await snap()).camera.target, camera.target, '中键平移必须更新目标');
      camera = (await snap()).camera;
      await page.keyboard.down('Alt');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 70, y + 30, { steps: 12 });
      await page.mouse.up();
      await page.keyboard.up('Alt');
      assert.notDeepEqual(
        (await snap()).camera.quaternion,
        camera.quaternion,
        'Alt 环绕必须更新朝向',
      );
      camera = (await snap()).camera;
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(350);
      assert.notDeepEqual((await snap()).camera.position, camera.position, '滚轮必须缩放');
      assert.deepEqual((await contents()).files, initial.files, '镜头操作不得修改工程');
      await page.evaluate(() => window.mapEditorPerformance.configure('current'));
      await ready();
      await page.locator('.tool-rail button').filter({ hasText: '地形' }).click();
      await page.getByRole('button', { name: '抬高', exact: true }).click();
      const stroke = async (cancel) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(x + i * 3, y + 5 * Math.sin(i));
          await page.waitForTimeout(20);
        }
        if (cancel)
          await page
            .getByTestId('map-canvas')
            .dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
        await page.mouse.up();
        await ready();
      };
      await stroke(false);
      const edited = await contents();
      assert.notDeepEqual(edited.files, initial.files, '连续雕刻必须产生数据变化');
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await ready();
      assert.deepEqual((await contents()).files, initial.files);
      await page.getByRole('button', { name: '重做', exact: true }).click();
      await ready();
      assert.deepEqual((await contents()).files, edited.files);
      await stroke(true);
      assert.deepEqual((await contents()).files, edited.files, '指针取消必须完整回滚当前笔刷');
      await page.getByRole('button', { name: '保存工程', exact: true }).click();
      await page.waitForFunction(
        async () => !(await window.mapEditorPerformance.integrity()).dirty,
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent.trim() === '保存工程' && !b.disabled,
        ),
      );
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await page.locator('.home-screen').waitFor();
      await page.locator('.home-project').first().click();
      await ready();
      assert.deepEqual((await contents()).files, edited.files, '原生保存重开必须一致');
      report.cases.push({
        scene,
        pan: true,
        orbit: true,
        zoom: true,
        continuousBrush: true,
        undo: true,
        redo: true,
        pointerCancel: true,
        nativeSaveReopen: true,
      });
      if (scene.startsWith('demo')) {
        // 只延迟渲染端派生结果，不改写会话数据；验证旧结果晚于原生切图返回。
        await page.evaluate(() => {
          const host = document.querySelector('.viewport');
          let fiber = host[Object.keys(host).find((key) => key.startsWith('__reactFiber'))],
            view;
          for (; fiber && !view; fiber = fiber.return)
            for (let hook = fiber.memoizedState; hook; hook = hook.next) {
              const candidate = hook.memoizedState?.current;
              if (
                candidate?.renderer?.domElement ===
                document.querySelector('[data-testid=map-canvas]')
              )
                view = candidate;
            }
          if (!view) throw new Error('找不到诊断视口');
          const run = view.grassTasks.run.bind(view.grassTasks);
          let release,
            first = true;
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          window.oldGrassGate = { release, ready: false };
          view.grassTasks.run = async (...args) => {
            const result = await run(...args);
            if (first) {
              first = false;
              window.oldGrassGate.ready = true;
              await gate;
            }
            return result;
          };
          window.oldGrassBuild = view.rebuildInstances(true);
        });
        await page.waitForFunction(() => window.oldGrassGate.ready);
        await app.evaluate(
          (_, entry) => {
            globalThis.testOpenPath = entry;
          },
          path.join(root, 'blank-1025', 'project.map3dproj'),
        );
        await page.getByRole('button', { name: '打开', exact: true }).click();
        await page.waitForFunction(
          () => window.mapEditorPerformance?.snapshot().document.settings.samples === 1025,
        );
        await ready();
        const newMap = await contents();
        await page.evaluate(async () => {
          window.oldGrassGate.release();
          await window.oldGrassBuild;
        });
        await ready();
        assert.deepEqual((await contents()).files, newMap.files);
        const after = await snap();
        assert.equal(after.stats.grass, 0);
        assert.equal(after.stats.trees, 0);
        report.cases.push({
          operation: 'late-worker-result-after-native-open',
          passed: true,
          snapshot: after,
        });
      }
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await page.locator('.home-screen').waitFor();
    }
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = error.stack;
    throw error;
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
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
