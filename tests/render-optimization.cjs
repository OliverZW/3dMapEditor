const { setup, launch } = require('./model-fixture.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

// 第二轮独立报告，保留此前的模型/地表性能记录。
const quick = process.argv.includes('--quick');
const qualityOnly = process.argv.includes('--quality-only');
const shader = process.argv.includes('--shader');
const mergeProbe = process.argv.includes('--merge-trees')
  ? 'trees'
  : process.argv.includes('--merge-city')
    ? 'city'
    : '';
const fullProbe = process.argv.includes('--full-probe');
const singleCase = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
const caseParts = singleCase?.match(/^(full|surface|models)-(513|1025)-(close|middle|far)$/);
if (singleCase && !caseParts) throw Error('无效的性能复测场景');
const output = path.resolve(
  'test-results',
  `render-optimization${singleCase ? '-' + singleCase : ''}${mergeProbe ? '-' + mergeProbe : ''}${shader ? '-shader' : ''}${qualityOnly ? '-quality' : quick ? '-quick' : ''}`,
);
const report = { conditions: {}, quality: [], measurements: [], motion: [], errors: [] };
const persist = () => fs.writeFileSync(output + '.json', JSON.stringify(report, null, 2) + '\n');
const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function configure(page, scene, view) {
  await page.evaluate(
    ({ scene, view }) => {
      const { viewport: v, session: s } = window.modelFixture;
      v.clock.getDelta = () => 0;
      v.clock.elapsedTime = 7;
      if (scene === 'surface') {
        Object.assign(s.view, {
          trees: false,
          sites: false,
          grass: false,
          water: false,
          territories: false,
          factions: false,
          hex: false,
        });
        v.updateVisibility();
        v.logic.visible = false;
      }
      v.navigation.rig.interrupt();
      const positions =
        scene === 'surface'
          ? { close: [25, 66, 110], middle: [192, 260, 230.4], far: [384, 844.8, 537.6] }
          : { close: [30, 85, 240], middle: [700, 870, 1050], far: [1100, 2200, 2800] };
      v.navigation.rig.target.set(0, 32, scene !== 'surface' && view === 'close' ? 120 : 0);
      v.camera.position.set(...positions[view]);
      v.camera.lookAt(v.navigation.rig.target);
      v.camera.updateMatrixWorld(true);
    },
    { scene, view },
  );
  await page.waitForTimeout(quick || qualityOnly ? 1500 : 4000);
  // 先完成该视角的惰性层级和草生成，再固定截图/采样。
  await page.waitForFunction(
    () => {
      const v = window.modelFixture.viewport;
      return (
        !v.instanceBuilds &&
        !v.instanceTimer &&
        [...v.treeModels.assets, ...v.siteModels.assets].every((batch) =>
          [...batch.pending].every((level) => batch.levels.has(level)),
        )
      );
    },
    {},
    { timeout: 120000 },
  );
}

async function difference(page, before, after) {
  return page.evaluate(
    async ({ before, after }) => {
      const canvas = document.createElement('canvas');
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const decode = async (data) => {
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/png' }),
        );
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = await decode(before),
        b = await decode(after);
      let max = 0,
        sum = 0,
        over1 = 0;
      const histogram = new Uint32Array(256);
      for (let i = 0; i < a.length; i += 4) {
        let pixel = 0;
        for (let channel = 0; channel < 3; channel++) {
          const value = Math.abs(a[i + channel] - b[i + channel]);
          sum += value;
          pixel = Math.max(pixel, value);
        }
        histogram[pixel]++;
        max = Math.max(max, pixel);
        if (pixel > 1) over1++;
      }
      let cumulative = 0,
        p99 = 0;
      for (; p99 < 255; p99++) {
        cumulative += histogram[p99];
        if (cumulative >= canvas.width * canvas.height * 0.99) break;
      }
      return {
        max,
        p99,
        mean: sum / (canvas.width * canvas.height * 3),
        pixelsOver1: over1,
        passed: p99 === 0 && max <= 1,
      };
    },
    { before: before.toString('base64'), after: after.toString('base64') },
  );
}

async function measure(page, duration, motion = false) {
  return page.evaluate(
    async ({ duration, motion }) => {
      const { viewport: v } = window.modelFixture;
      const g = v.renderer.getContext(),
        ext = g.getExtension('EXT_disjoint_timer_query_webgl2');
      const render = v.renderer.render,
        pending = [],
        gpu = [],
        cpu = [],
        times = [];
      const beforeBytes =
        v.treeModels.diagnostics.uploadBytes + v.siteModels.diagnostics.uploadBytes;
      const beforeUploads = v.treeModels.diagnostics.uploads + v.siteModels.diagnostics.uploads;
      v.renderer.render = function (...args) {
        while (pending.length && g.getQueryParameter(pending[0], g.QUERY_RESULT_AVAILABLE)) {
          const q = pending.shift();
          if (!g.getParameter(ext.GPU_DISJOINT_EXT))
            gpu.push(g.getQueryParameter(q, g.QUERY_RESULT) / 1e6);
          g.deleteQuery(q);
        }
        const q = ext ? g.createQuery() : null,
          started = performance.now();
        if (q) g.beginQuery(ext.TIME_ELAPSED_EXT, q);
        render.apply(this, args);
        if (q) {
          g.endQuery(ext.TIME_ELAPSED_EXT);
          pending.push(q);
        }
        cpu.push(performance.now() - started);
      };
      const start = performance.now(),
        x = v.camera.position.x;
      try {
        await new Promise((resolve) => {
          const tick = (t) => {
            times.push(t);
            if (motion) {
              const offset = Math.sin((t - start) / 1000) * 8;
              v.camera.position.x = x + offset;
              v.navigation.rig.target.x = offset;
            }
            if (t - start >= duration) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      } finally {
        v.renderer.render = render;
        for (const q of pending) g.deleteQuery(q);
        v.camera.position.x = x;
      }
      const intervals = times
        .slice(1)
        .map((t, i) => t - times[i])
        .sort((a, b) => a - b);
      const mean = (values) =>
        values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      return {
        fps: ((times.length - 1) * 1000) / (times.at(-1) - times[0]),
        p95Ms: intervals[Math.ceil(intervals.length * 0.95) - 1],
        gpuMs: mean(gpu),
        gpuSamples: gpu.length,
        submissionMs: mean(cpu),
        draws: v.renderer.info.render.calls,
        triangles: v.renderer.info.render.triangles,
        uploadBytes:
          v.treeModels.diagnostics.uploadBytes + v.siteModels.diagnostics.uploadBytes - beforeBytes,
        uploads:
          v.treeModels.diagnostics.uploads + v.siteModels.diagnostics.uploads - beforeUploads,
        memory: { ...v.renderer.info.memory },
      };
    },
    { duration, motion },
  );
}

async function selectMode(page, mode, scene) {
  await page.evaluate(
    async ({ mode, scene, mergeProbe }) => {
      const { viewport: v, session: s } = window.modelFixture;
      if (!window.modeMaterials) {
        const { SurfaceMaterial } = await import('/src/renderer/surface-material.ts');
        const candidate = new SurfaceMaterial(
          (error) => {
            throw Error(error);
          },
          false,
          true,
        );
        candidate.update(s.doc);
        window.modeMaterials = { baseline: v.surfaceMaterial, candidate };
      }
      const performanceMode = mode === 'optimized' ? undefined : mode;
      v.renderOptions.performanceMode = performanceMode;
      v.treeModels.performanceMode = performanceMode;
      v.siteModels.performanceMode = performanceMode;
      const material = window.modeMaterials[mode === 'candidate' ? 'candidate' : 'baseline'];
      v.surfaceMaterial = material;
      if (scene !== 'models') v.ground.material = material.material;
      if (mergeProbe && !window.mergeProbeInstalled) {
        const original = v.library.getForRendering.bind(v.library);
        v.library.getForRendering = (asset, level) =>
          (mergeProbe === 'trees' ? asset.kind === 'city' : asset.kind === 'tree')
            ? v.library.get(asset, level)
            : original(asset, level);
        window.mergeProbeInstalled = true;
      }
      v.treeModelKey = '';
      v.siteModelKey = '';
      v.grassModelKey = '';
      await v.rebuildInstances();
      // 同一上下文、同一相机和同一资源；强制两侧使用相同的完整阴影刷新。
      v.terrainDirty = true;
      v.terrainBounds = undefined;
      v.rebuildTerrain();
      v.renderer.shadowMap.needsUpdate = true;
    },
    { mode, scene, mergeProbe },
  );
  await page.waitForFunction(
    () => {
      const v = window.modelFixture.viewport;
      return (
        v.surfaceMaterial.ready &&
        !v.instanceBuilds &&
        !v.instanceTimer &&
        [...v.treeModels.assets, ...v.siteModels.assets].every((batch) =>
          [...batch.pending].every((level) => batch.levels.has(level)),
        )
      );
    },
    {},
    { timeout: 120000 },
  );
  await page.waitForTimeout(quick || qualityOnly ? 1500 : 4000);
}

(async () => {
  const browser = await launch();
  const scenes = caseParts
    ? [caseParts[1]]
    : fullProbe
      ? ['full']
      : process.argv.includes('--probe')
        ? ['surface']
        : ['full', 'surface', 'models'];
  const samples = caseParts
    ? [Number(caseParts[2])]
    : fullProbe || process.argv.includes('--probe')
      ? [513]
      : [513, 1025];
  const views = caseParts ? [caseParts[3]] : ['close', 'middle', 'far'];
  const modes = shader || mergeProbe ? ['baseline', 'candidate'] : ['baseline', 'optimized'];
  try {
    for (const scene of scenes)
      for (const count of samples) {
        const page = await browser.newPage({
          viewport: { width: 1600, height: 1000 },
          deviceScaleFactor: 1,
        });
        page.on('pageerror', (error) => report.errors.push(String(error)));
        page.on('console', (message) => {
          if (message.type() === 'error' && !message.text().includes('favicon'))
            report.errors.push(message.text());
        });
        await setup(page, {
          simple: scene === 'models',
          demo: scene !== 'surface',
          samples: count,
          performanceMode: 'baseline',
        });
        if (scene === 'surface')
          await page.evaluate(() => {
            const { session: s, createDocument } = window.modelFixture;
            const n = s.doc.settings.samples,
              doc = createDocument(n, 768, 384);
            doc.name = '第二轮四层地表性能测试（程序构造）';
            for (let row = 0; row < n; row++)
              for (let col = 0; col < n; col++) {
                const x = col / (n - 1),
                  z = row / (n - 1),
                  i = row * n + col;
                doc.heights[i] =
                  32 +
                  85 * Math.exp(-((x - 0.62) ** 2 / 0.005 + (z - 0.2) ** 2 / 0.035)) +
                  8 * Math.sin(x * 8) * Math.cos(z * 7);
                const position = Math.min(3, x * 4),
                  layer = Math.min(3, Math.floor(position));
                doc.surface.fill(0, i * 4, i * 4 + 4);
                const next =
                  layer < 3 ? Math.round(Math.max(0, (position - layer - 0.8) / 0.2) * 255) : 0;
                doc.surface[i * 4 + layer] = 255 - next;
                if (next) doc.surface[i * 4 + layer + 1] = next;
              }
            s.replace(doc);
          });
        if (!report.conditions.gpu)
          report.conditions = await page.evaluate(
            ({ quick, qualityOnly }) => {
              const v = window.modelFixture.viewport,
                g = v.renderer.getContext(),
                e = g.getExtension('WEBGL_debug_renderer_info');
              return {
                gpu: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
                viewport: [innerWidth, innerHeight],
                dpr: devicePixelRatio,
                antialias: g.getContextAttributes().antialias,
                shadowMap: v.sun.shadow.mapSize.x,
                anisotropy: 4,
                animationSeconds: 7,
                warmupMs: quick || qualityOnly ? 1500 : 4000,
                sampleMs: quick ? 2000 : 10000,
                repeats: quick ? 1 : 3,
                comparison:
                  '同一WebGL上下文、相机和原始资源内切换模式，各自刷新完整阴影；不跨实例比较。',
                baseline: '保留既有LOD、裁剪及静态阴影，只关闭第二轮更新优化。',
                fixture:
                  '程序测试；完整/四层地表/简单平面模型场景；1025通过同一示例重采样，保留全部对象。',
              };
            },
            { quick, qualityOnly },
          );
        for (const view of views) {
          await configure(page, scene, view);
          let baseline;
          for (const mode of modes) {
            await selectMode(page, mode, scene);
            const key = `${scene}-${count}-${view}`;
            const png = await page.screenshot({ path: `${output}-${key}-${mode}.png` });
            if (mode === 'baseline') baseline = png;
            else {
              const result = await difference(page, baseline, png);
              report.quality.push({ scene, samples: count, view, mode, ...result });
              console.log('QUALITY', key, mode, JSON.stringify(result));
              persist();
            }
            if (!qualityOnly)
              for (let round = 1; round <= (quick ? 1 : 3); round++) {
                const row = {
                  scene,
                  samples: count,
                  view,
                  mode,
                  round,
                  ...(await measure(page, quick ? 2000 : 10000)),
                };
                report.measurements.push(row);
                persist();
                console.log('MEASURE', JSON.stringify(row));
              }
          }
        }
        if (!qualityOnly && !caseParts)
          for (const mode of modes) {
            await configure(page, scene, 'middle');
            await selectMode(page, mode, scene);
            const row = {
              scene,
              samples: count,
              mode,
              ...(await measure(page, quick ? 1500 : 10000, true)),
            };
            report.motion.push(row);
            persist();
            console.log('MOTION', JSON.stringify(row));
          }
        await page.evaluate(() => {
          const { viewport: v } = window.modelFixture;
          for (const material of Object.values(window.modeMaterials))
            if (material !== v.surfaceMaterial) material.dispose();
          window.modelFixture.release();
        });
        await page.close();
        persist();
      }
    report.summary = [];
    for (const scene of scenes)
      for (const count of samples)
        for (const view of views) {
          const row = { scene, samples: count, view };
          for (const mode of modes) {
            const rows = report.measurements.filter(
              (item) =>
                item.scene === scene &&
                item.samples === count &&
                item.view === view &&
                item.mode === mode,
            );
            if (rows.length)
              row[mode] = {
                gpuMs: median(rows.map((item) => item.gpuMs)),
                fps: median(rows.map((item) => item.fps)),
                p95Ms: median(rows.map((item) => item.p95Ms)),
                draws: rows[0].draws,
              };
          }
          report.summary.push(row);
        }
    report.qualityPassed = report.quality.every((row) => row.passed);
    persist();
    assert.deepEqual(report.errors, [], '浏览器错误');
    if (!shader) assert(report.qualityPassed, '默认优化未通过严格画面对照');
  } finally {
    persist();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
