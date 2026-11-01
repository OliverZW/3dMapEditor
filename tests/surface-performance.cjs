require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./surface-fixture.cjs');
const { fixture, camera } = require('./water-fixture.cjs');
const artifacts = path.resolve(__dirname, '../test-results/tests');
const full = process.argv.includes('--full');
const report = {
  conditions: {},
  quality: [],
  measurements: [],
  lifecycle: [],
  errors: [],
  cacheDefaultEnabled: false,
};
fs.mkdirSync(artifacts, { recursive: true });
const persist = () =>
  fs.writeFileSync(
    path.join(artifacts, 'surface-performance-report.json'),
    JSON.stringify(report, null, 2),
  );

async function installModes(page) {
  await page.evaluate(async () => {
    const v = window.waterFixture.viewport;
    const { SurfaceMaterial } = await import('/src/renderer/surface-material.ts');
    const original = new SurfaceMaterial((error) => {
      throw Error(error);
    }, true);
    const optimized = new SurfaceMaterial((error) => {
      throw Error(error);
    });
    original.update(window.waterFixture.session.doc);
    optimized.update(window.waterFixture.session.doc);
    await Promise.all(
      [original, optimized].map(
        (material) =>
          new Promise((resolve, reject) => {
            const start = performance.now();
            const poll = () =>
              material.ready
                ? resolve()
                : performance.now() - start > 20000
                  ? reject(Error('贴图未就绪'))
                  : setTimeout(poll, 30);
            poll();
          }),
      ),
    );
    window.performanceModes = { original, optimized, cached: v.surfaceMaterial, mode: 'cached' };
  });
}
async function mode(page, name) {
  await page.evaluate((name) => {
    const v = window.waterFixture.viewport,
      modes = window.performanceModes;
    v.ground.material = modes[name].material;
    v.renderer.shadowMap.autoUpdate = name === 'original';
    v.renderer.shadowMap.needsUpdate = true;
    modes.mode = name;
    v.surfaceCacheEnabled = name === 'cached';
  }, name);
}
async function quality(page, scene, view) {
  const result = await page.evaluate(() => {
    const v = window.waterFixture.viewport,
      modes = window.performanceModes;
    const canvas = document.createElement('canvas');
    canvas.width = v.renderer.domElement.width;
    canvas.height = v.renderer.domElement.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const capture = (material) => {
      v.ground.material = material;
      v.renderer.render(v.scene, v.camera);
      ctx.drawImage(v.renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const baseline = capture(modes.original.material),
      optimized = capture(modes.optimized.material),
      cached = capture(modes.cached.material);
    const diff = (image) => {
      const differences = [];
      let sum = 0,
        max = 0,
        changed = 0;
      for (let i = 0; i < image.length; i += 4) {
        let pixel = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(image[i + c] - baseline[i + c]);
          sum += d;
          max = Math.max(max, d);
          pixel = Math.max(pixel, d);
        }
        if (pixel > 2) changed++;
        differences.push(pixel);
      }
      differences.sort((a, b) => a - b);
      return {
        mean: sum / ((image.length / 4) * 3),
        p99: differences[Math.floor(differences.length * 0.99)],
        max,
        changedOver2Fraction: changed / differences.length,
      };
    };
    return { optimized: diff(optimized), cached: diff(cached), cache: v.surfaceCache.diagnostics };
  });
  assert(
    result.optimized.mean <= 0.05 && result.optimized.p99 <= 1,
    '无损优化固定画面对照超出浮点舍入误差',
  );
  report.quality.push({ scene, view, ...result });
  persist();
  console.log('画面对比', scene, view, JSON.stringify(result));
  await page.screenshot({ path: path.join(artifacts, `performance-${scene}-${view}-cached.png`) });
  await mode(page, 'original');
  await page.screenshot({
    path: path.join(artifacts, `performance-${scene}-${view}-original.png`),
  });
  await mode(page, 'optimized');
  await page.screenshot({
    path: path.join(artifacts, `performance-${scene}-${view}-optimized.png`),
  });
}
async function measure(page, label, duration = 10000) {
  return page.evaluate(
    async ({ label, duration }) => {
      const v = window.waterFixture.viewport,
        g = v.renderer.getContext(),
        ext = g.getExtension('EXT_disjoint_timer_query_webgl2');
      const original = v.renderer.render.bind(v.renderer),
        pending = [],
        gpu = [],
        submissions = [],
        timestamps = [],
        frameGpu = new Map();
      const cleanup = () => {
        v.diagnosticFrame = undefined;
        v.requestRender();
        v.renderer.render = original;
        for (const item of pending) g.deleteQuery(item.q);
      };
      v.renderer.render = (...args) => {
        while (pending.length && g.getQueryParameter(pending[0].q, g.QUERY_RESULT_AVAILABLE)) {
          const item = pending.shift();
          if (!g.getParameter(ext.GPU_DISJOINT_EXT)) {
            const elapsed = g.getQueryParameter(item.q, g.QUERY_RESULT) / 1e6;
            frameGpu.set(item.frame, (frameGpu.get(item.frame) || 0) + elapsed);
            if (item.main) {
              gpu.push(frameGpu.get(item.frame));
              frameGpu.delete(item.frame);
            }
          }
          g.deleteQuery(item.q);
        }
        const q = ext ? g.createQuery() : null,
          t = performance.now();
        if (q) g.beginQuery(ext.TIME_ELAPSED_EXT, q);
        original(...args);
        if (q) {
          g.endQuery(ext.TIME_ELAPSED_EXT);
          pending.push({
            q,
            frame: v.diagnosticScheduling.renderedFrames,
            main: args[0] === v.scene,
          });
        }
        submissions.push(performance.now() - t);
      };
      v.diagnosticFrame = { begin() {}, end() {} };
      v.requestRender();
      const start = performance.now();
      try {
        await new Promise((resolve) => {
          const tick = (t) => {
            timestamps.push(t);
            if (t - start < duration) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
      } finally {
        cleanup();
      }
      const dt = timestamps.slice(1).map((t, i) => t - timestamps[i]),
        sorted = dt.slice().sort((a, b) => a - b);
      return {
        label,
        fps: ((timestamps.length - 1) * 1000) / (timestamps.at(-1) - timestamps[0]),
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        gpuMs: gpu.length ? gpu.reduce((a, b) => a + b, 0) / gpu.length : null,
        gpuSamples: gpu.length,
        submissionMs: submissions.reduce((a, b) => a + b, 0) / submissions.length,
        cache: v.surfaceCache.diagnostics,
      };
    },
    { label, duration },
  );
}

async function main() {
  const browser = await launch(),
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  try {
    const scenes = full
      ? [
          { name: 'demo-513', demo: true },
          { name: 'mixed-513', samples: 513 },
          { name: 'mixed-1025', samples: 1025 },
        ]
      : [{ name: 'demo-513', demo: true }];
    for (const scene of scenes) {
      await fixture(page, { ...scene, width: 768, depth: 512, surfaceMode: 'cached' });
      if (!scene.demo)
        await page.evaluate(() => {
          const s = window.waterFixture.session;
          s.change('固定四层混合', (doc) => {
            const n = doc.settings.samples;
            for (let row = 0; row < n; row++)
              for (let col = 0; col < n; col++) {
                const i = (row * n + col) * 4,
                  x = (col / (n - 1)) * 3,
                  layer = Math.min(2, Math.floor(x)),
                  blend = Math.round((x - layer) * 255);
                doc.surface.fill(0, i, i + 4);
                doc.surface[i + layer] = 255 - blend;
                doc.surface[i + layer + 1] = blend;
              }
          });
        });
      await installModes(page);
      report.conditions = await page.evaluate((full) => {
        const v = window.waterFixture.viewport,
          g = v.renderer.getContext(),
          e = g.getExtension('WEBGL_debug_renderer_info');
        return {
          hardware: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
          size: [g.drawingBufferWidth, g.drawingBufferHeight],
          dpr: v.renderer.getPixelRatio(),
          msaaSamples: g.getParameter(g.SAMPLES),
          shadowMap: 2048,
          anisotropy: 4,
          frozenAnimationSeconds: 7,
          warmupMs: 12000,
          sampleMs: full ? 10000 : 1500,
          repeats: full ? 3 : 1,
        };
      }, full);
      for (const view of ['close', 'oblique', 'far']) {
        await camera(
          page,
          scene.demo
            ? view === 'close'
              ? 'demoClose'
              : view === 'oblique'
                ? 'overview'
                : 'far'
            : view,
        );
        await mode(page, 'cached');
        await page.waitForTimeout(full ? 12000 : 6000);
        await quality(page, scene.name, view);
        for (let repeat = 0; repeat < (full ? 3 : 1); repeat++)
          for (const name of ['original', 'optimized', 'cached']) {
            await mode(page, name);
            await page.waitForTimeout(800);
            const result = await measure(
              page,
              `${scene.name}/${view}/${name}/${repeat}`,
              full ? 10000 : 1500,
            );
            report.measurements.push(result);
            persist();
            console.log(
              result.label,
              'GPU',
              result.gpuMs?.toFixed(2),
              'ms FPS',
              result.fps.toFixed(2),
            );
          }
      }
      await mode(page, 'cached');
      const lifecycle = await page.evaluate(async () => {
        const { viewport: v, session: s } = window.waterFixture,
          cache = v.surfaceCache;
        let shadowDraws = 0;
        v.scene.traverse((o) => {
          if (o.isMesh && o.castShadow) {
            o.onBeforeShadow = () => {
              shadowDraws++;
            };
          }
        });
        v.renderer.render(v.scene, v.camera);
        shadowDraws = 0;
        v.renderer.render(v.scene, v.camera);
        const stationaryShadowDraws = shadowDraws;
        s.setViewLayer('trees', false);
        shadowDraws = 0;
        v.renderer.render(v.scene, v.camera);
        const hiddenShadowDraws = shadowDraws;
        s.setViewLayer('trees', true);
        v.renderer.render(v.scene, v.camera);
        s.setViewLayer('grass', false);
        shadowDraws = 0;
        v.renderer.render(v.scene, v.camera);
        const grassShadowDraws = shadowDraws;
        const before = cache.diagnostics;
        s.setTool('surface');
        s.brush.surfaceLayer = 1;
        s.pointerDown({ x: 0, z: 0 }, false);
        s.pointerMove({ x: 10, z: 10 }, false);
        s.endStroke();
        const painted = cache.diagnostics;
        s.undo();
        const undone = cache.diagnostics;
        s.redo();
        const redone = cache.diagnostics;
        s.setTool('terrain');
        s.pointerDown({ x: 0, z: 0 }, false);
        s.cancelStroke();
        s.previewSurface({ scale: 2 });
        s.cancelSurface();
        const canceled = cache.diagnostics;
        const versions = [];
        for (const samples of [1025, 513, 1025, 513]) {
          s.newMap(samples, 768, 384);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          versions.push(cache.diagnostics);
        }
        return {
          stationaryShadowDraws,
          hiddenShadowDraws,
          grassShadowDraws,
          before,
          painted,
          undone,
          redone,
          canceled,
          versions,
        };
      });
      assert.equal(lifecycle.stationaryShadowDraws, 0);
      assert.equal(lifecycle.grassShadowDraws, 0);
      assert(lifecycle.painted.generation > lifecycle.before.generation);
      assert.equal(lifecycle.undone.pages, 0);
      assert.equal(lifecycle.redone.pages, 0);
      assert(lifecycle.versions.every((v) => v.bytes <= 256 * 1024 * 1024));
      report.lifecycle.push({ scene: scene.name, ...lifecycle });
      await page.evaluate(() => {
        const v = window.waterFixture.viewport;
        window.performanceModes.original.dispose();
        window.performanceModes.optimized.dispose();
        v.dispose();
      });
      const disposed = await page.evaluate(() => ({
        memory: window.waterFixture.viewport.renderer.info.memory,
        lost: window.waterFixture.viewport.renderer.getContext().isContextLost(),
      }));
      report.lifecycle.push({ scene: scene.name, disposed });
      assert.equal(disposed.memory.geometries, 0);
      assert(disposed.lost);
    }
    const median = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    report.summary = [];
    for (const quality of report.quality) {
      const prefix = `${quality.scene}/${quality.view}/`,
        group = (name) =>
          report.measurements.filter((m) => m.label.startsWith(prefix + name + '/'));
      const original = group('original'),
        optimized = group('optimized'),
        cached = group('cached');
      report.summary.push({
        scene: quality.scene,
        view: quality.view,
        originalGpuMs: median(original.map((m) => m.gpuMs)),
        optimizedGpuMs: median(optimized.map((m) => m.gpuMs)),
        cachedGpuMs: median(cached.map((m) => m.gpuMs)),
        optimizedFps: median(optimized.map((m) => m.fps)),
        originalFps: median(original.map((m) => m.fps)),
        cacheQualityPassed:
          quality.cached.mean <= 0.5 && quality.cached.p99 <= 2 && quality.cached.max <= 8,
      });
    }
    report.cacheDefaultEnabled = false;
    report.cacheDecision =
      '保持默认关闭：缓存的固定画面对照存在可见局部差异，不能以平均误差小替代画质验收。';
    assert.deepEqual(report.errors, []);
    persist();
    console.log('性能与画面对照完成；缓存默认关闭，启用判定见报告。');
  } finally {
    persist();
    await browser.close();
  }
}
module.exports = { installModes, mode, measure };
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
