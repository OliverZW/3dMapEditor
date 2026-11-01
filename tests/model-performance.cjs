require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { setup, launch } = require('./model-fixture.cjs');
const fs = require('node:fs');
(async () => {
  const browser = await launch();
  const report = { conditions: {}, measurements: [], errors: [] };
  const persist = () => {
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    report.summary = [];
    for (const scene of ['full-map', 'models-only'])
      for (const mode of ['original', 'optimized']) {
        const rows = report.measurements.filter((row) => row.scene === scene && row.mode === mode);
        if (!rows.length) continue;
        report.summary.push({
          scene,
          mode,
          fps: median(rows.map((row) => row.fps)),
          medianFrameMs: median(rows.map((row) => row.frameMedianMs)),
          p95FrameMs: median(rows.map((row) => row.frameP95Ms)),
          modelTriangles: rows[0].modelTriangles,
          draws: rows[0].draws,
          memory: rows[0].memory,
        });
      }
    const original = report.summary.find(
      (row) => row.scene === 'full-map' && row.mode === 'original',
    );
    const optimized = report.summary.find(
      (row) => row.scene === 'full-map' && row.mode === 'optimized',
    );
    if (original && optimized)
      report.modelTriangleReduction = 1 - optimized.modelTriangles / original.modelTriangles;
    fs.writeFileSync(
      'test-results/tests/model-performance.json',
      JSON.stringify(report, null, 2) + '\n',
    );
  };
  try {
    for (const simple of [false, true])
      for (const mode of ['original', 'optimized']) {
        const page = await browser.newPage({
          viewport: { width: 1600, height: 1000 },
          deviceScaleFactor: 1,
        });
        page.setDefaultTimeout(120000);
        page.on('pageerror', (e) => report.errors.push(String(e)));
        await setup(page, { mode, simple });
        await page.waitForTimeout(4000);
        if (!report.conditions.hardware)
          report.conditions = await page.evaluate(() => {
            const v = window.modelFixture.viewport,
              g = v.renderer.getContext(),
              e = g.getExtension('WEBGL_debug_renderer_info');
            return {
              hardware: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
              viewport: [innerWidth, innerHeight],
              dpr: devicePixelRatio,
              antialias: true,
              shadowMap: 2048,
              samples: 513,
              condition:
                '独占浏览器；同一启动示例、全部存储对象；模型模式切换；独立模型场景仅测试时以简单平面替代地表并隐藏草、水与逻辑叠加。',
            };
          });
        for (let round = 1; round <= 3; round++) {
          const measurement = await page.evaluate(async () => {
            const { viewport: v, session: s } = window.modelFixture;
            const times = [],
              start = performance.now();
            let previous = start;
            v.diagnosticFrame = { begin() {}, end() {} };
            v.requestRender();
            await new Promise((resolve) => {
              const frame = (now) => {
                times.push(now - previous);
                previous = now;
                if (now - start >= 6000) resolve();
                else requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            });
            const elapsed = performance.now() - start;
            v.diagnosticFrame = undefined;
            v.requestRender();
            times.sort((a, b) => a - b);
            return {
              fps: (times.length / elapsed) * 1000,
              frameMedianMs: times[Math.floor(times.length * 0.5)],
              frameP95Ms: times[Math.floor(times.length * 0.95)],
              frames: times.length,
              elapsedMs: elapsed,
              trees: s.doc.trees.length,
              sites: s.doc.sites.length,
              eligibleTrees: v.stats.trees,
              visibleTrees: v.treeModels.diagnostics.visible,
              modelTriangles:
                v.treeModels.diagnostics.triangles + v.siteModels.diagnostics.triangles,
              draws: v.renderer.info.render.calls,
              totalTriangles: v.renderer.info.render.triangles,
              memory: { ...v.renderer.info.memory },
              treeUpdates: { ...v.treeModels.diagnostics },
              siteUpdates: { ...v.siteModels.diagnostics },
            };
          });
          report.measurements.push({
            scene: simple ? 'models-only' : 'full-map',
            mode,
            round,
            ...measurement,
          });
          persist();
          console.log(JSON.stringify(report.measurements.at(-1)));
        }
        await page.screenshot({
          path: `test-results/tests/model-performance-${simple ? 'models-only' : 'full-map'}-${mode}.png`,
        });
        await page.evaluate(() => window.modelFixture.release());
        await page.close();
      }
    if (report.errors.length) throw Error(report.errors.join('\n'));
  } finally {
    persist();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
