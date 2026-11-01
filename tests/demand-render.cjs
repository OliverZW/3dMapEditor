const { setup, launch } = require('./model-fixture.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    server: { host: '127.0.0.1', port: 5173, strictPort: false },
  });
  await server.listen();
  process.env.EDITOR_URL = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
  const output = path.resolve('test-results/tests/demand-render-' + Date.now());
  await fs.mkdir(output, { recursive: true });
  const report = { status: 'running', checks: [], errors: [] };
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => report.errors.push(String(e)));
    const state = () => page.evaluate(() => window.modelFixture.viewport.diagnosticScheduling);
    const idle = () =>
      page.waitForFunction(() => {
        const v = window.modelFixture.viewport;
        return v.diagnosticReady && v.stats.idle && !v.diagnosticScheduling.pending;
      });
    const stable = async (name) => {
      await page.waitForTimeout(120);
      await idle();
      const before = await state();
      await page.waitForTimeout(600);
      const after = await state();
      assert.equal(after.renderedFrames, before.renderedFrames, name + ' 不得持续提交');
      report.checks.push({ name, before, after });
    };
    await setup(page, { demo: false, displayQuality: 'fast' });
    await stable('空场景');
    let statusBefore = await state();
    await page.evaluate(() => {
      const s = window.modelFixture.session;
      for (let i = 0; i < 10; i++) s.message('测试状态栏通知 ' + i);
    });
    await stable('纯状态栏通知');
    assert.equal((await state()).renderedFrames, statusBefore.renderedFrames);
    // 无相机动画的滚轮、投影与真实拖动都必须从睡眠唤醒。
    let before = await state();
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -180);
    await stable('缩放后');
    assert.ok((await state()).renderedFrames > before.renderedFrames);
    before = await state();
    await page.mouse.down({ button: 'right' });
    await page.keyboard.down('w');
    await page.waitForTimeout(300);
    await page.keyboard.up('w');
    await page.mouse.move(680, 420);
    await page.mouse.up({ button: 'right' });
    await stable('观察与 WASD 后');
    assert.ok((await state()).renderedFrames - before.renderedFrames > 3);
    await page.evaluate(() => window.modelFixture.viewport.navigation.snap('+y'));
    await stable('方向动画后');
    await page.evaluate(() => {
      const { session: s, viewport: v } = window.modelFixture;
      s.setTool('terrain');
      v.frameMap();
    });
    await stable('定位后');
    before = await state();
    await page.mouse.move(620, 390);
    await page.mouse.down();
    await page.mouse.move(655, 405, { steps: 6 });
    await page.mouse.up();
    await stable('笔刷后');
    assert.ok((await state()).renderedFrames > before.renderedFrames);
    const undo = await page.evaluate(() => {
      const s = window.modelFixture.session;
      const edited = Array.from(s.doc.heights);
      s.undo();
      return { edited, label: s.history.redoLabel };
    });
    assert.ok(undo.label);
    await stable('撤销后');
    await page.evaluate(() => window.modelFixture.session.redo());
    await stable('重做后');
    assert.deepEqual(
      await page.evaluate(() => Array.from(window.modelFixture.session.doc.heights)),
      undo.edited,
    );
    // 已无输入时，迟到的贴图回调必须单独触发画面刷新。
    await page.evaluate(async () => {
      const { session: s } = window.modelFixture;
      const canvas = new OffscreenCanvas(8, 8);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff00aa';
      ctx.fillRect(0, 0, 8, 8);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      const { imageHash } = await import('/src/io/image-validation.ts');
      const original = window.createImageBitmap;
      window.bitmapGate = {};
      const gate = new Promise((resolve) => {
        window.bitmapGate.release = resolve;
      });
      window.createImageBitmap = async (...args) => {
        await gate;
        return original(...args);
      };
      window.bitmapGate.restore = () => {
        window.createImageBitmap = original;
      };
      s.previewSurfaceLayer(0, {
        ...s.doc.surfaceMaterial.layers[0],
        color: { width: 8, height: 8, hash: imageHash(bytes), bytes },
      });
    });
    await page.waitForFunction(() => window.modelFixture.viewport.stats.idle);
    before = await state();
    await page.waitForTimeout(350);
    assert.equal((await state()).renderedFrames, before.renderedFrames);
    await page.evaluate(() => {
      window.bitmapGate.release();
      window.bitmapGate.restore();
    });
    await idle();
    assert.ok((await state()).renderedFrames > before.renderedFrames, '贴图就绪必须唤醒');
    await page.evaluate(() => window.modelFixture.session.cancelSurfaceLayer());
    await stable('材质预览取消后');
    // 延迟据点模型：清理旧预览后睡眠，异步完成呈现幽灵，取消后无残留。
    await page.evaluate(() => {
      const { session: s, viewport: v } = window.modelFixture;
      const original = v.library.get.bind(v.library);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      window.ghostGate = {
        release,
        restore: () => {
          v.library.get = original;
        },
      };
      v.library.get = async (...args) => {
        await gate;
        return original(...args);
      };
      s.beginSite('city');
      s.hoverAt({ x: 80, z: 50 });
    });
    await page.waitForFunction(() => window.modelFixture.viewport.stats.idle);
    before = await state();
    await page.evaluate(() => {
      window.ghostGate.release();
      window.ghostGate.restore();
    });
    await page.waitForFunction(() => window.modelFixture.viewport.siteGhost.children.length > 0);
    await stable('异步据点预览后');
    assert.ok((await state()).renderedFrames > before.renderedFrames);
    await page.evaluate(() => window.modelFixture.session.cancelPreview());
    await stable('据点预览取消后');
    assert.equal(
      await page.evaluate(() => window.modelFixture.viewport.siteGhost.children.length),
      0,
    );
    await page.setViewportSize({ width: 1000, height: 700 });
    await stable('窗口调整后');
    await page.screenshot({ path: path.join(output, 'blank.png') });
    // 完整示例保留地图数据，分别检查水面/近景草、隐藏、视锥外及工程切换。
    await page.evaluate(() => {
      const { session: s, viewport: v, createDemo } = window.modelFixture;
      s.replace(createDemo());
      v.frameMap();
    });
    await page.waitForFunction(() => window.modelFixture.viewport.diagnosticReady);
    before = await state();
    await page.waitForTimeout(400);
    assert.ok((await state()).renderedFrames - before.renderedFrames > 3, '可见水面继续动画');
    report.checks.push({ name: '可见水面动画', before, after: await state() });
    await page.evaluate(() => {
      const { session: s, viewport: v } = window.modelFixture;
      s.setViewLayer('water', false);
      v.navigation.rig.target.set(0, 32, 0);
      v.camera.position.set(0, 45, 40);
      v.camera.lookAt(v.navigation.rig.target);
      v.requestRender();
    });
    await page.waitForFunction(
      () => window.modelFixture.viewport.diagnosticScheduling.visibleGrass,
    );
    before = await state();
    await page.waitForTimeout(400);
    assert.ok((await state()).renderedFrames - before.renderedFrames > 3, '近景草继续动画');
    report.checks.push({ name: '近景草动画', before, after: await state() });
    await page.evaluate(() => window.modelFixture.session.setViewLayer('grass', false));
    await stable('隐藏动画层后');
    await page.evaluate(() => {
      const { session: s, viewport: v } = window.modelFixture;
      s.setViewLayer('water', true);
      s.setViewLayer('grass', true);
      v.camera.position.set(0, 4000, 0);
      v.camera.lookAt(0, 8000, 0);
      v.requestRender();
    });
    await stable('动画在视锥外');
    await page.evaluate(() => {
      const { session: s, viewport: v, createDocument } = window.modelFixture;
      s.replace(createDocument(1025, 512, 256));
      v.frameMap();
    });
    await stable('切回 1025² 空场景');
    await page.evaluate(() => window.modelFixture.release());
    await page.waitForTimeout(400);
    const disposed = await state();
    assert.equal(disposed.pending, false);
    assert.equal(
      await page.evaluate(() => window.modelFixture.viewport.renderer.info.memory.geometries),
      0,
    );
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = error.stack;
    throw error;
  } finally {
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await server.close();
    console.log(output, report.status);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
