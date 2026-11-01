require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./surface-fixture.cjs');

async function fixture(
  page,
  { demo = false, samples = 513, width = 512, depth = 512, surfaceMode = 'optimized' } = {},
) {
  const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
  // 独立测试页面，避免后台应用占用另一套视口和自动草稿。
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>',
    }),
  );
  await page.goto(url);
  await page.unroute(url);
  await page.evaluate(
    async ({ demo, samples, width, depth, surfaceMode }) => {
      // 复用会话模块实际引用的资源版本，避免长时间运行的Vite热更新产生两份缓存。
      const sessionSource = await (await fetch('/src/application/editor-session.ts')).text();
      const resourceModule = sessionSource.match(
        /from\s*["']([^"']*\/builtin-resources\.ts(?:\?[^"']*)?)["']/,
      )?.[1];
      if (!resourceModule) throw Error('无法定位测试所需的内置资源模块');
      const [
        { createDocument },
        { createDemo },
        { EditorSession },
        { EditorViewport },
        { initializeBuiltinResources },
      ] = await Promise.all([
        import('/src/core/document.ts'),
        import('/src/core/demo.ts'),
        import('/src/application/editor-session.ts'),
        import('/src/renderer/editor-viewport.ts'),
        import(resourceModule),
      ]);
      await initializeBuiltinResources();
      const doc = demo ? createDemo() : createDocument(samples, width, depth);
      if (!demo) {
        doc.name = '水面固定渲染测试（程序构造）';
        for (let row = 0; row < samples; row++) {
          for (let col = 0; col < samples; col++) {
            const x = (col / (samples - 1) - 0.5) * width;
            const z = (row / (samples - 1) - 0.5) * depth;
            doc.heights[row * samples + col] = 30 + 3 * Math.sin(x / 80) * Math.cos(z / 55);
          }
        }
        doc.rivers = [
          {
            id: 1,
            name: '弯曲主河',
            width: 38,
            depth: 8,
            waterLevel: 29,
            points: [
              { x: -width * 0.5, z: -depth * 0.2 },
              { x: -width * 0.16, z: -depth * 0.12 },
              { x: width * 0.15, z: depth * 0.05 },
              { x: width * 0.5, z: depth * 0.16 },
            ],
          },
          {
            id: 2,
            name: '交汇支流',
            width: 16,
            depth: 4,
            waterLevel: 29,
            points: [
              { x: width * 0.03, z: -depth * 0.5 },
              { x: width * 0.05, z: -depth * 0.15 },
              { x: width * 0.12, z: depth * 0.04 },
            ],
          },
          {
            id: 3,
            name: '直河浅槽',
            width: 26,
            depth: 2,
            waterLevel: 29,
            interpolation: 'linear',
            points: [
              { x: -width * 0.35, z: depth * 0.34 },
              { x: width * 0.35, z: depth * 0.34 },
            ],
          },
        ];
        doc.nextId = 4;
      }
      const session = new EditorSession();
      session.replace(doc);
      session.view.hex = false;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;background:#a5b6af;z-index:10000';
      document.body.appendChild(host);
      const viewport = new EditorViewport(host, session, { surfaceMode });
      // 只在测试实例冻结时钟；应用没有测试开关或固定时间。
      viewport.clock.getDelta = () => 0;
      viewport.clock.elapsedTime = 7;
      window.waterFixture = { viewport, session, host };
    },
    { demo, samples, width, depth, surfaceMode },
  );
  await camera(page, demo ? 'demo' : 'oblique');
  await page.waitForTimeout(2200);
}

async function camera(page, view) {
  await page.evaluate((view) => {
    const { viewport, session } = window.waterFixture;
    const { width, depth } = session.doc.settings;
    const positions = {
      demo: [100, 260, 450],
      demoClose: [30, 85, 240],
      oblique: [width * 0.25, 260, depth * 0.6],
      top: [0, width * 1.12, 0.01],
      close: [25, 66, 110],
      far: [width * 0.5, width * 1.1, depth * 1.4],
      overview: [700, 870, 1050],
    };
    const target = view === 'demo' || view === 'demoClose' ? [0, 25, 120] : [0, 29, 0];
    viewport.navigation.rig.target.set(...target);
    viewport.camera.position.set(...positions[view]);
    viewport.camera.lookAt(viewport.navigation.rig.target);
    viewport.camera.updateMatrixWorld(true);
  }, view);
  await page.waitForTimeout(350);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const artifacts = path.resolve(__dirname, '../test-results/tests');
  fs.mkdirSync(artifacts, { recursive: true });
  const label = process.argv.includes('--baseline') ? 'before' : 'after';
  try {
    await fixture(page, { demo: true });
    await page.screenshot({ path: path.join(artifacts, `water-demo-${label}.png`) });
    await page.evaluate(() => window.waterFixture.viewport.dispose());
    await fixture(page);
    for (const view of ['oblique', 'top', 'close', 'far']) {
      await camera(page, view);
      await page.screenshot({ path: path.join(artifacts, `water-${view}-${label}.png`) });
    }
    await page.evaluate(() => window.waterFixture.viewport.dispose());
    assert.deepEqual(errors, []);
    console.log(`水面 ${label}：启动示例与固定场景四种镜头截图完成，错误0。`);
  } finally {
    await browser.close();
  }
}
module.exports = { fixture, camera };
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
