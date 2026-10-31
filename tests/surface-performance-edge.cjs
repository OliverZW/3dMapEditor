const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./surface-fixture.cjs');
const { fixture, camera } = require('./water-fixture.cjs');
const { installModes, mode, measure } = require('./surface-performance.cjs');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const errors = [],
    report = { lifecycle: {}, dense: [], errors };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    await fixture(page, { demo: true, surfaceMode: 'cached' });
    await page.waitForTimeout(2500);
    report.lifecycle = await page.evaluate(async () => {
      const { viewport: v, session: s } = window.waterFixture;
      let draws = 0;
      v.scene.traverse((o) => {
        if (o.isMesh && o.castShadow) o.onBeforeShadow = () => draws++;
      });
      v.renderer.shadowMap.needsUpdate = true;
      v.renderer.render(v.scene, v.camera);
      draws = 0;
      v.renderer.render(v.scene, v.camera);
      const staticDraws = draws;
      v.sun.position.x += 1;
      v.updateShadowState();
      draws = 0;
      v.renderer.render(v.scene, v.camera);
      const lightDraws = draws;
      s.setTool('surface');
      s.hoverAt({ x: 0, z: 0 });
      v.updateCursor();
      const geometry = v.cursor.geometry;
      for (let i = 0; i < 10; i++) v.updateCursor();
      const cursorReused = geometry === v.cursor.geometry;
      const frames = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      s.previewSurface({ scale: 2 });
      await frames();
      const preview = v.surfaceMaterial.uniforms.uSurfaceScale.value;
      s.cancelSurface();
      await frames();
      const canceled = v.surfaceMaterial.uniforms.uSurfaceScale.value;
      const width = s.doc.settings.width;
      s.change('故意无效的验证候选', (doc) => {
        doc.settings.width = 0;
        doc.surface[0] = 0;
      });
      await frames();
      const rollbackWidth = s.doc.settings.width;
      const rollbackWeights =
        v.surfaceMaterial.uniforms.uSurfaceWeights.value.image.data === s.doc.surface;
      const budget = v.surfaceCache.diagnostics;
      v.dispose();
      // 模型库通过已完成 Promise 的微任务回收共享几何。
      await Promise.resolve();
      await Promise.resolve();
      return {
        staticDraws,
        lightDraws,
        cursorReused,
        preview,
        canceled,
        width,
        rollbackWidth,
        rollbackWeights,
        budget,
        disposedCache: v.surfaceCache.diagnostics,
        geometryCount: v.renderer.info.memory.geometries,
      };
    });
    assert.equal(report.lifecycle.staticDraws, 0);
    assert(report.lifecycle.lightDraws > 0);
    assert(report.lifecycle.cursorReused);
    assert.equal(report.lifecycle.preview, 2);
    assert.equal(report.lifecycle.canceled, 1);
    assert.equal(report.lifecycle.width, report.lifecycle.rollbackWidth);
    assert(report.lifecycle.rollbackWeights);
    assert.equal(report.lifecycle.disposedCache.bytes, 0);
    assert.equal(report.lifecycle.geometryCount, 0);
    console.log('阴影灯光变化、轮廓复用、材质预览取消、失败回滚及缓存释放通过');

    await fixture(page, { samples: 513, width: 768, depth: 512, surfaceMode: 'cached' });
    await page.evaluate(() =>
      window.waterFixture.session.change('四层同时非零', (doc) => {
        for (let i = 0; i < doc.surface.length; i += 4) doc.surface.set([64, 64, 64, 63], i);
      }),
    );
    await installModes(page);
    await camera(page, 'oblique');
    await mode(page, 'optimized');
    await page.waitForTimeout(1500);
    for (let repeat = 0; repeat < 3; repeat++)
      for (const name of ['original', 'optimized']) {
        await mode(page, name);
        await page.waitForTimeout(800);
        const result = await measure(page, `dense/${name}/${repeat}`, 10000);
        report.dense.push(result);
        console.log(result.label, 'GPU', result.gpuMs?.toFixed(2), 'ms FPS', result.fps.toFixed(2));
      }
    assert.deepEqual(errors, []);
    await page.evaluate(() => {
      window.performanceModes.original.dispose();
      window.performanceModes.optimized.dispose();
      window.waterFixture.viewport.dispose();
    });
  } finally {
    fs.writeFileSync(
      path.resolve(__dirname, '../test-results/surface-performance-edge-report.json'),
      JSON.stringify(report, null, 2),
    );
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
