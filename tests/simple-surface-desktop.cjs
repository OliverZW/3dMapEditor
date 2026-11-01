const { _electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const previous = process.argv.find((arg) => arg.startsWith('--previous-exe='))?.slice(15);
  assert.ok(previous, '需要对照发布版的 --previous-exe 路径');
  const current = path.resolve(
    `dist/mapEdtor-v${require('../package.json').version}/ShanheMapEditor.exe`,
  );
  const root = path.resolve('test-results/tests/simple-surface-quality-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  let application;
  const report = { status: 'running', cases: [], errors: [] };
  try {
    for (const quality of process.argv
      .find((arg) => arg.startsWith('--qualities='))
      ?.slice(12)
      .split(',') ??
      (process.argv.includes('--all-qualities')
        ? ['fast', 'balanced', 'high']
        : ['balanced', 'high'])) {
      let before;
      for (const [label, exe] of [
        ['previous', path.resolve(previous)],
        ['current', current],
      ]) {
        const folder = path.join(root, quality + '-' + label);
        await fs.mkdir(folder);
        const env = {
          ...process.env,
          MAP_EDITOR_PROFILE: path.join(folder, 'profile'),
          MAP_EDITOR_PERFORMANCE_PROBE: '1',
        };
        delete env.ELECTRON_RUN_AS_NODE;
        application = await _electron.launch({
          executablePath: exe,
          args: ['--force_high_performance_gpu', '--force-device-scale-factor=1.25'],
          env,
          timeout: 60000,
        });
        const page = await application.firstWindow();
        page.setDefaultTimeout(60000);
        page.on('pageerror', (error) => report.errors.push(String(error)));
        await application.evaluate(({ BrowserWindow, dialog }, folder) => {
          BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000);
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
        }, folder);
        // 只用于固定画面对照；不进行 FPS 测量。水与草均冻结在初始时间。
        await page.evaluate(() => {
          performance.now = () => 1000;
        });
        await page.getByRole('button', { name: '创建工程', exact: true }).click();
        await page.getByLabel('工程名称').fill('固定画面对照');
        await page.getByRole('button', { name: '选择父目录' }).click();
        await page.getByLabel('导入示例工程').check();
        await page.getByRole('button', { name: '创建工程', exact: true }).click();
        await page.getByLabel('显示档位', { exact: true }).selectOption(quality);
        await page.waitForFunction(
          () => window.mapEditorPerformance?.snapshot().ready,
          {},
          { timeout: 180000 },
        );
        await page.evaluate(() => window.mapEditorPerformance.configure('current'));
        await page.waitForFunction(
          () => window.mapEditorPerformance.snapshot().ready,
          {},
          { timeout: 180000 },
        );
        await page.waitForTimeout(1000);
        const trace = await page.evaluate(() => {
          const host = document.querySelector('.viewport');
          let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber'))];
          let view;
          for (; f && !view; f = f.return)
            for (let h = f.memoizedState; h; h = h.next) {
              const v = h.memoizedState?.current;
              if (v?.renderer?.domElement === document.querySelector('[data-testid=map-canvas]')) {
                view = v;
                break;
              }
            }
          if (!view) return null;
          return {
            time: view.animationTime,
            waterTime: view.waterSurface.waterMaterial.time.value,
            sites: view.siteModels.group.children
              .filter((m) => m.visible && m.count)
              .map((m) => ({
                count: m.count,
                order: m.renderOrder,
                material: m.material.name,
                materialId: m.material.id,
                level: m.userData.modelLevel,
                geometry: m.geometry.index?.count,
                position: [...m.instanceMatrix.array.slice(0, 16)],
              })),
          };
        });
        const snap = await page.evaluate(() => window.mapEditorPerformance.snapshot());
        const input = await page.evaluate(() => window.mapEditorPerformance.integrity());
        const png = await page
          .getByTestId('map-canvas')
          .screenshot({ path: path.join(root, quality + '-' + label + '.png') });
        if (!before) before = { png: png.toString('base64'), snap, input, trace };
        else {
          assert.deepEqual(input.files, before.input.files, '前后构建地图内容必须一致');
          assert.deepEqual(snap.viewport, before.snap.viewport);
          assert.deepEqual(snap.camera, before.snap.camera);
          assert.equal(snap.context.unmaskedRenderer, before.snap.context.unmaskedRenderer);
          const difference = await page.evaluate(
            async ({ a, b }) => {
              const decode = async (base64) => {
                const bitmap = await createImageBitmap(
                  new Blob([Uint8Array.from(atob(base64), (v) => v.charCodeAt(0))], {
                    type: 'image/png',
                  }),
                );
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
                  context = canvas.getContext('2d');
                context.drawImage(bitmap, 0, 0);
                bitmap.close();
                return context.getImageData(0, 0, canvas.width, canvas.height).data;
              };
              const first = await decode(a),
                second = await decode(b);
              let max = 0,
                changed = 0;
              for (let i = 0; i < first.length; i += 4) {
                let pixel = 0;
                for (let k = 0; k < 3; k++)
                  pixel = Math.max(pixel, Math.abs(first[i + k] - second[i + k]));
                max = Math.max(max, pixel);
                if (pixel) changed++;
              }
              return { max, changed };
            },
            { a: before.png, b: png.toString('base64') },
          );
          report.cases.push({
            quality,
            beforeTrace: before.trace,
            trace,
            difference,
            viewport: snap.viewport,
            renderer: snap.context.unmaskedRenderer,
          });
          console.log(quality, difference);
          assert.ok(difference.max <= 1, '均衡／高画质出现超出1/255的像素差异');
        }
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
        );
        await application.close();
        application = null;
      }
    }
    assert.equal(report.errors.length, 0);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(String(error));
    throw error;
  } finally {
    if (application) {
      await application
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(root);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
