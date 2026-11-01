require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function launch() {
  return chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ||
      path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    headless: true,
  });
}

async function fixture(page, samples = 513, width = 512, depth = 512) {
  // 固定材质场景独占视口，避免后台启动示例持续渲染密集树林。
  const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>',
    }),
  );
  await page.goto(url);
  await page.unroute(url);
  await page.evaluate(
    async ({ samples, width, depth }) => {
      const sessionSource = await (await fetch('/src/application/editor-session.ts')).text();
      const resourceModule = sessionSource.match(
        /from\s*["']([^"']*\/builtin-resources\.ts(?:\?[^"']*)?)["']/,
      )?.[1];
      if (!resourceModule) throw Error('无法定位内置资源模块');
      const [
        { createDocument },
        { EditorSession },
        { EditorViewport },
        { initializeBuiltinResources },
      ] = await Promise.all([
        import('/src/core/document.ts'),
        import('/src/application/editor-session.ts'),
        import('/src/renderer/editor-viewport.ts'),
        import(resourceModule),
      ]);
      await initializeBuiltinResources();
      const doc = createDocument(samples, width, depth);
      doc.name = '四类地表固定验收场景';
      for (let row = 0; row < samples; row++) {
        for (let col = 0; col < samples; col++) {
          const i = row * samples + col;
          const x = col / (samples - 1),
            z = row / (samples - 1);
          const ridge = 85 * Math.exp(-((x - 0.62) ** 2 / 0.005 + (z - 0.2) ** 2 / 0.035));
          doc.heights[i] = 32 + ridge + 8 * Math.sin(x * 8) * Math.cos(z * 7);
          const position = Math.min(3, x * 4);
          const layer = Math.min(3, Math.floor(position));
          doc.surface.fill(0, i * 4, i * 4 + 4);
          const transition = layer < 3 ? Math.max(0, (position - layer - 0.8) / 0.2) : 0;
          const next = Math.round(transition * 255);
          doc.surface[i * 4 + layer] = 255 - next;
          if (next) doc.surface[i * 4 + layer + 1] = next;
        }
      }
      doc.rivers.push({
        id: 1,
        name: '验收河岸',
        width: 12,
        depth: 5,
        waterLevel: 29,
        points: [
          { x: -width * 0.45, z: depth * 0.3 },
          { x: width * 0.45, z: depth * 0.27 },
        ],
      });
      doc.nextId = 2;
      const session = new EditorSession();
      session.replace(doc);
      session.view.hex = false;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;background:#a5b6af;z-index:10000';
      document.body.appendChild(host);
      const viewport = new EditorViewport(host, session);
      const camera = viewport.camera;
      camera.position.set(width * 0.25, 360, depth * 0.65);
      viewport.navigation.rig.target.set(0, 40, 0);
      camera.lookAt(viewport.navigation.rig.target);
      camera.updateMatrixWorld(true);
      window.surfaceFixture = { session, viewport, host };
    },
    { samples, width, depth },
  );
  await page.waitForTimeout(2500);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await fixture(page);
    if (process.argv.includes('--close')) {
      await page.evaluate(() => {
        const { viewport, session } = window.surfaceFixture;
        viewport.camera.position.set(80, 130, 180);
        viewport.navigation.rig.target.set(35, 40, 0);
        viewport.camera.lookAt(viewport.navigation.rig.target);
        viewport.camera.updateMatrixWorld(true);
        session.previewSurface({ detail: 1 });
        session.commitSurface();
      });
      await page.waitForTimeout(600);
    }
    fs.mkdirSync(path.resolve(__dirname, '../test-results/tests'), { recursive: true });
    const label = process.argv.includes('--baseline')
      ? 'before'
      : process.argv.includes('--close')
        ? 'closeup'
        : 'after';
    await page.screenshot({
      path: path.resolve(__dirname, `../test-results/tests/surface-${label}.png`),
    });
    assert.deepEqual(errors, []);
    console.log(`surface-${label}: captured; errors=0`);
  } finally {
    await browser.close();
  }
}

module.exports = { launch, fixture };
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
