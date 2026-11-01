require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./surface-fixture.cjs');
const { fixture } = require('./water-fixture.cjs');
const { installModes, mode } = require('./surface-performance.cjs');

(async () => {
  const browser = await launch(),
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const report = { frames: [], errors: [] };
  page.on('pageerror', (e) => report.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  try {
    await fixture(page, { demo: true, surfaceMode: 'cached' });
    await installModes(page);
    await mode(page, 'cached');
    await page.waitForTimeout(6000);
    const positions = [
      [30, 85, 240],
      [60, 85, 260],
      [100, 100, 300],
      [700, 870, 1050],
      [1024, 2252, 2867],
      [700, 870, 1050],
      [100, 100, 300],
      [60, 85, 260],
      [30, 85, 240],
    ];
    for (const position of positions) {
      await page.evaluate(async (position) => {
        const v = window.waterFixture.viewport;
        v.navigation.rig.target.set(0, 29, 0);
        v.camera.position.set(...position);
        v.camera.lookAt(v.navigation.rig.target);
        v.camera.updateMatrixWorld(true);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, position);
      const frame = await page.evaluate(() => {
        const v = window.waterFixture.viewport,
          m = window.performanceModes,
          canvas = document.createElement('canvas');
        canvas.width = v.renderer.domElement.width;
        canvas.height = v.renderer.domElement.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const capture = (material) => {
          v.ground.material = material;
          v.renderer.render(v.scene, v.camera);
          ctx.drawImage(v.renderer.domElement, 0, 0);
          return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const a = capture(m.original.material),
          b = capture(m.optimized.material),
          c = capture(m.cached.material);
        const diff = (image) => {
          let max = 0,
            sum = 0;
          for (let i = 0; i < image.length; i += 4)
            for (let k = 0; k < 3; k++) {
              const delta = Math.abs(image[i + k] - a[i + k]);
              max = Math.max(max, delta);
              sum += delta;
            }
          return { max, mean: sum / ((image.length / 4) * 3) };
        };
        return { optimized: diff(b), cached: diff(c), cache: v.surfaceCache.diagnostics };
      });
      report.frames.push({ position, ...frame });
      assert(
        frame.optimized.max <= 2 && frame.optimized.mean <= 0.05,
        '移动镜头时无损路径出现画面差异',
      );
      assert(frame.cache.bytes <= 256 * 1024 * 1024);
    }
    await page.evaluate(() => {
      window.performanceModes.original.dispose();
      window.performanceModes.optimized.dispose();
      window.waterFixture.viewport.dispose();
    });
    assert.deepEqual(report.errors, []);
    console.log('九个往返镜头的无损画面对照、页面过渡及预算检查通过');
  } finally {
    fs.writeFileSync(
      path.resolve(__dirname, '../test-results/tests/surface-motion-report.json'),
      JSON.stringify(report, null, 2),
    );
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
