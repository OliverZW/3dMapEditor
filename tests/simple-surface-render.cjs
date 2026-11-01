const { fixture, launch } = require('./surface-fixture.cjs');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    server: { host: '127.0.0.1', port: 5173, strictPort: false },
  });
  await server.listen();
  process.env.EDITOR_URL = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
  const output = path.resolve('test-results/tests/simple-surface-render-' + Date.now());
  await fs.mkdir(output, { recursive: true });
  let browser;
  const report = { status: 'running', checks: [], errors: [] };
  try {
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(60000);
    page.on('pageerror', (error) => report.errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text());
    });
    await fixture(page, 513, 512, 512, { displayQuality: 'fast' });
    await page.waitForFunction(() => window.surfaceFixture.viewport.diagnosticReady);
    await page.screenshot({ path: path.join(output, 'fast-builtins-ridge.png') });
    await page.evaluate(async () => {
      const { session: s, viewport: v } = window.surfaceFixture;
      const { imageHash } = await import('/src/io/image-validation.ts');
      const { sampleHeight } = await import('/src/core/terrain.ts');
      window.testImage = async (color) => {
        const canvas = new OffscreenCanvas(8, 8),
          context = canvas.getContext('2d');
        context.fillStyle = color;
        context.fillRect(0, 0, 8, 8);
        const bytes = new Uint8Array(
          await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
        );
        return { width: 8, height: 8, hash: imageHash(bytes), bytes };
      };
      const normal = await window.testImage('rgb(128,128,255)');
      const colors = await Promise.all(
        ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map(window.testImage),
      );
      s.change('测试纯色四层夹具', (doc) => {
        doc.heights.fill(32);
        doc.rivers = [];
        doc.surfaceMaterial.slopeRock = false;
        doc.surfaceMaterial.layers.forEach((layer, index) => {
          layer.color = colors[index];
          layer.normal = normal;
        });
      });
      if (s.error) throw new Error(s.error);
      v.navigation.toggleProjection();
      v.camera.position.set(0, 500, 0);
      v.camera.up.set(0, 0, -1);
      v.navigation.rig.target.set(0, 32, 0);
      v.camera.lookAt(v.navigation.rig.target);
      v.camera.zoom = 1800 / 512;
      v.camera.updateProjectionMatrix();
      v.camera.updateMatrixWorld(true);
      window.testPixel = (x, z) => {
        v.camera.updateMatrixWorld(true);
        const p = new v.camera.position.constructor(
          x,
          sampleHeight(s.doc, s.heights, x, z),
          z,
        ).project(v.camera);
        v.renderer.render(v.scene, v.camera);
        const gl = v.renderer.getContext(),
          bytes = new Uint8Array(4);
        gl.readPixels(
          Math.floor((p.x + 1) * 0.5 * gl.drawingBufferWidth),
          Math.floor((p.y + 1) * 0.5 * gl.drawingBufferHeight),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bytes,
        );
        return Array.from(bytes);
      };
    });
    const ready = () => page.waitForFunction(() => window.surfaceFixture.viewport.diagnosticReady);
    await ready();
    const colors = await page.evaluate(() =>
      [-192, -64, 64, 192, -140.8].map((x) => window.testPixel(x, 0)),
    );
    report.checks.push({ name: 'four-colors-and-continuous-blend', colors });
    assert.ok(colors[0][0] > colors[0][1] + 40 && colors[0][0] > colors[0][2] + 40);
    assert.ok(colors[1][1] > colors[1][0] + 40 && colors[1][1] > colors[1][2] + 40);
    assert.ok(colors[2][2] > colors[2][0] + 40 && colors[2][2] > colors[2][1] + 40);
    // 保留编辑器 ACES 色调映射；检查颜色贡献而非要求色调映射后某通道严格为零。
    assert.ok(colors[3][0] > colors[3][2] + 40 && colors[3][1] > colors[3][2] + 40);
    assert.ok(colors[4][0] > colors[4][2] + 30 && colors[4][1] > colors[4][2] + 30);
    await page.screenshot({ path: path.join(output, 'fast-four-color-blend.png') });
    await page.evaluate(() => {
      const { session: s } = window.surfaceFixture;
      s.change('测试陡坡夹具', (doc) => {
        const n = doc.settings.samples;
        for (let row = 0; row < n; row++)
          for (let col = 0; col < n; col++) {
            const i = row * n + col;
            doc.heights[i] = 32 + 200 * Math.max(0, Math.min(1, (col - 254) / 4));
            doc.surface.fill(0, i * 4, i * 4 + 4);
            doc.surface[i * 4] = 255;
          }
        doc.surfaceMaterial.slopeRock = true;
      });
      window.testWeights = s.doc.surface.slice();
    });
    await ready();
    const rock = await page.evaluate(() => window.testPixel(0, 0));
    await page.evaluate(() => {
      const s = window.surfaceFixture.session;
      s.previewSurface({ slopeRock: false });
      s.commitSurface();
    });
    await ready();
    const grass = await page.evaluate(() => window.testPixel(0, 0));
    assert.ok(rock[2] > rock[0] + 20, '坡面必须混入岩石层');
    assert.ok(grass[0] > grass[2] + 40, '关闭显岩必须恢复手绘颜色');
    assert.ok(
      await page.evaluate(() =>
        window.testWeights.every((v, i) => v === window.surfaceFixture.session.doc.surface[i]),
      ),
    );
    report.checks.push({ name: 'steep-slope-rock-without-writing-weights', rock, grass });
    await page.evaluate(async () => {
      const { session: s, viewport: v } = window.surfaceFixture;
      window.oldColor = v.surfaceMaterial.uniforms.uSurfaceColor0.value;
      window.colorDisposals = 0;
      window.oldColor.addEventListener('dispose', () => window.colorDisposals++);
      const image = await window.testImage('#ff00ff');
      s.change('替换测试颜色', (doc) => {
        doc.surfaceMaterial.layers[0].color = image;
      });
    });
    await ready();
    const replaced = await page.evaluate(() => window.testPixel(0, 0));
    assert.ok(replaced[0] > replaced[1] + 40 && replaced[2] > replaced[1] + 40);
    assert.equal(await page.evaluate(() => window.colorDisposals), 1);
    assert.equal(await page.evaluate(() => window.oldColor.image.width), 0);
    await page.evaluate(() => window.surfaceFixture.session.undo());
    await ready();
    const undone = await page.evaluate(() => window.testPixel(0, 0));
    assert.ok(undone[0] > undone[2] + 40);
    await page.evaluate(() => window.surfaceFixture.session.redo());
    await ready();
    const redone = await page.evaluate(() => window.testPixel(0, 0));
    assert.deepEqual(redone, replaced);
    report.checks.push({ name: 'replace-color-undo-redo-and-release', replaced, undone, redone });
    await page.evaluate(async () => {
      const { encodeProject, decodeProject } = await import('/src/io/project.ts');
      const s = window.surfaceFixture.session;
      s.replace(decodeProject(encodeProject(s.doc)));
    });
    await ready();
    assert.deepEqual(await page.evaluate(() => window.testPixel(0, 0)), redone);
    const released = await page.evaluate(() => {
      const v = window.surfaceFixture.viewport;
      const macro = v.surfaceMaterial.uniforms.uSurfaceMacro.value;
      let count = 0;
      macro.addEventListener('dispose', () => count++);
      v.dispose();
      return { macroDisposals: count, geometries: v.renderer.info.memory.geometries };
    });
    assert.deepEqual(released, { macroDisposals: 1, geometries: 0 });
    report.checks.push({ name: 'backup-round-trip-and-release', released });
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(String(error));
    throw error;
  } finally {
    if (browser) await browser.close();
    await server.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(output, report.status);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
