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
  const root = path.resolve('test-results/tests/editing-profile-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const report = {
    status: 'running',
    conditions: {
      kind: 'source-webgl',
      quality: 'fast',
      durationMs: 2500,
      scenes: '程序构造的固定示例；1025²为既有夹具重采样，不是用户地图',
    },
    cases: [],
    errors: [],
  };
  let browser;
  try {
    browser = await launch();
    for (const samples of [513, 1025])
      for (const demo of [false, true]) {
        const page = await browser.newPage({
          viewport: { width: 1038, height: 873 },
          deviceScaleFactor: 1.25,
        });
        page.on('pageerror', (e) => report.errors.push(String(e)));
        page.setDefaultTimeout(120000);
        await setup(page, { samples, demo, displayQuality: 'fast' });
        if (!demo)
          await page.evaluate((samples) => {
            const { session: s, viewport: v, createDocument } = window.modelFixture;
            s.replace(createDocument(samples, 2048, 2048));
            v.requestRender();
          }, samples);
        await page.waitForFunction(() => window.modelFixture.viewport.diagnosticReady);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
        for (const operation of ['terrain-away', 'terrain-river', 'camera', 'trees', 'site']) {
          if (!demo && operation === 'terrain-river') continue;
          await page.evaluate(() => {
            window.modelFixture.viewport.frameMap();
          });
          await page.waitForTimeout(500);
          await cdp.send('Profiler.start');
          const result = await page.evaluate(async (operation) => {
            const { session: s, viewport: v } = window.modelFixture;
            const { performanceDistribution: dist } = await import(
              '/src/renderer/performance-statistics.ts'
            );
            const stages = {},
              restores = [];
            const wrap = (obj, name, key) => {
              const old = obj[name];
              obj[name] = function (...args) {
                const t = performance.now();
                try {
                  return old.apply(this, args);
                } finally {
                  (stages[key] ??= []).push(performance.now() - t);
                }
              };
              restores.push(() => (obj[name] = old));
            };
            for (const [obj, name, key] of [
              [s, 'applyBrush', 'brushAndDerive'],
              [s, 'endStroke', 'endStroke'],
              [s.history, 'commit', 'historyCommit'],
              [v, 'rebuildTerrain', 'terrainMesh'],
              [v, 'rebuildLogic', 'logicOverlay'],
              [v, 'rebuildInstances', 'instanceSyncBeforeAwait'],
              [v.waterSurface, 'updateDepth', 'waterDepth'],
            ])
              wrap(obj, name, key);
            const longs = [];
            const obs = new PerformanceObserver((list) =>
              longs.push(
                ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
              ),
            );
            obs.observe({ type: 'longtask' });
            const frames = [];
            let active = true;
            const tick = (t) => {
              frames.push(t);
              if (active) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            const started = performance.now(),
              submitted = v.diagnosticScheduling.renderedFrames,
              events = [];
            let count = 0;
            s.setTool(
              operation.startsWith('terrain')
                ? 'terrain'
                : operation === 'trees'
                  ? 'trees'
                  : 'sites',
            );
            Object.assign(s.brush, { radius: 40, strength: 0.3, terrainMode: 'raise' });
            if (operation === 'trees') s.selectBrushAsset('tree', 'tree-pine');
            try {
              while (performance.now() - started < 2500) {
                const t = performance.now(),
                  i = count++;
                if (operation.startsWith('terrain') || operation === 'trees') {
                  const p = { x: -80 + i * 3, z: operation === 'terrain-river' ? 60 : -360 };
                  if (!i) s.pointerDown(p, false);
                  else s.pointerMove(p, false);
                } else if (operation === 'camera') {
                  v.camera.position.x = 700 + Math.sin(i * 0.08) * 80;
                  v.navigation.rig.target.x = Math.sin(i * 0.08) * 80;
                  v.camera.lookAt(v.navigation.rig.target);
                  v.requestRender();
                } else {
                  if (s.doc.sites.length) s.selectSite(s.doc.sites[i % s.doc.sites.length].id);
                  else {
                    s.beginSite('city');
                    s.hoverAt({ x: 80, z: 60 });
                    s.cancelPreview();
                  }
                }
                events.push(performance.now() - t);
                await new Promise((r) => setTimeout(r, 16));
              }
              s.endStroke();
              await new Promise((r) => setTimeout(r, 600));
            } finally {
              active = false;
              obs.disconnect();
              restores.reverse().forEach((fn) => fn());
            }
            const elapsed = performance.now() - started;
            return {
              operation,
              events: dist(events),
              elapsedMs: elapsed,
              submittedFrames: v.diagnosticScheduling.renderedFrames - submitted,
              frameMs: dist(frames.slice(1).map((t, i) => t - frames[i])),
              longTasks: longs,
              stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, dist(v)])),
              ready: v.diagnosticReady,
            };
          }, operation);
          const { profile } = await cdp.send('Profiler.stop');
          const name = `${demo ? 'demo' : 'blank'}-${samples}-${operation}`;
          await fs.writeFile(path.join(root, name + '.cpuprofile'), JSON.stringify(profile));
          const map = new Map(profile.nodes.map((n) => [n.id, n]));
          const times = new Map();
          (profile.samples || []).forEach((id, i) =>
            times.set(id, (times.get(id) || 0) + (profile.timeDeltas[i] || 0)),
          );
          result.topSelf = [...times]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 18)
            .map(([id, us]) => ({
              name: map.get(id).callFrame.functionName,
              url: map.get(id).callFrame.url,
              line: map.get(id).callFrame.lineNumber,
              ms: us / 1000,
            }));
          report.cases.push({ name, samples, demo, ...result });
          await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
          console.log(
            name,
            JSON.stringify({
              eventP95: result.events?.p95,
              frameP95: result.frameMs?.p95,
              longTasks: result.longTasks.length,
              stages: result.stages,
              top: result.topSelf.slice(0, 6),
            }),
          );
        }
        await page.evaluate(() => window.modelFixture.release());
        await page.close();
      }
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } catch (e) {
    report.status = 'failed';
    report.failure = e.stack;
    throw e;
  } finally {
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await server.close();
    console.log(root, report.status);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
