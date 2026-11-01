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
  const root = path.resolve('test-results/tests/editing-consistency-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const report = { status: 'running', checks: [], errors: [] };
  let browser;
  try {
    browser = await launch();
    for (const samples of [513, 1025]) {
      const page = await browser.newPage({ viewport: { width: 1038, height: 873 } });
      page.setDefaultTimeout(120000);
      page.on('pageerror', (e) => report.errors.push(String(e)));
      await setup(page, { samples, displayQuality: 'fast' });
      await page.waitForFunction(() => window.modelFixture.viewport.diagnosticReady);
      const data = await page.evaluate(async () => {
        const { session: s, viewport: v } = window.modelFixture;
        const { generateGrass } = await import('/src/core/vegetation.ts');
        const { deriveHeights } = await import('/src/core/terrain.ts');
        const { encodeProject, decodeProject } = await import('/src/io/project.ts');
        const exact = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
        const result = {};
        const center = { x: 0, z: 100 };
        let count = 0;
        const expected = s.doc.assets
          .filter((a) => a.kind === 'grass')
          .map((asset) => {
            const instances = [];
            for (const layer of s.doc.grass.filter((l) => l.assetId === asset.id))
              instances.push(
                ...generateGrass(
                  s.doc,
                  s.heights,
                  layer,
                  center,
                  80,
                  50000 - count - instances.length,
                ),
              );
            count += instances.length;
            return { assetId: asset.id, instances };
          });
        const actual = await v.grassTasks.run(s.doc, s.heights, center, {
          documentVersion: s.documentVersion,
          terrainRevision: s.terrainRevision,
          grassRevision: v.grassRevision,
        });
        result.grassExact = JSON.stringify(actual) === JSON.stringify(expected);
        result.grassCount = count;
        result.originalBuffersIntact =
          s.heights.byteLength > 0 && s.doc.grass[0].density.byteLength > 0;
        s.setTool('terrain');
        Object.assign(s.brush, { radius: 30, strength: 0.3, terrainMode: 'raise' });
        const before = s.doc.heights.slice();
        s.pointerDown({ x: -40, z: 60 }, false);
        for (let i = 0; i < 12; i++) s.pointerMove({ x: -40 + i * 5, z: 60 + i }, false);
        s.endStroke();
        const edited = s.doc.heights.slice();
        result.derivedExact = exact(s.heights, deriveHeights(s.doc));
        s.undo();
        result.undo = exact(s.doc.heights, before) && exact(s.heights, deriveHeights(s.doc));
        s.redo();
        result.redo = exact(s.doc.heights, edited) && exact(s.heights, deriveHeights(s.doc));
        s.pointerDown({ x: 400, z: 300 }, false);
        s.pointerMove({ x: 420, z: 320 }, false);
        s.cancelStroke();
        result.cancel = exact(s.doc.heights, edited) && exact(s.heights, deriveHeights(s.doc));
        const restored = decodeProject(encodeProject(s.doc));
        result.roundtrip =
          exact(restored.heights, s.doc.heights) &&
          exact(deriveHeights(restored), s.heights) &&
          exact(restored.surface, s.doc.surface) &&
          exact(restored.grass[0].density, s.doc.grass[0].density);
        return result;
      });
      assert.ok(Object.entries(data).every(([k, v]) => k === 'grassCount' || v === true));
      report.checks.push({ samples, ...data });
      await page.waitForFunction(() => window.modelFixture.viewport.diagnosticReady);
      const materials = await page.evaluate(async () => {
        const { viewport: v } = window.modelFixture;
        window.materialBefore = new Set(v.grassMaterials.values());
        window.materialDisposals = [];
        for (const material of [
          ...v.grassMaterials.values(),
          v.logicMaterials.fill,
          v.logicMaterials.grid,
          v.logicMaterials.boundary,
        ]) {
          const r = { id: material.id, count: 0 };
          window.materialDisposals.push(r);
          material.addEventListener('dispose', () => r.count++);
        }
        v.navigation.rig.target.x += 25;
        v.requestRender();
        return window.materialBefore.size;
      });
      await page.waitForFunction(() => window.modelFixture.viewport.diagnosticReady);
      await page.waitForTimeout(500);
      assert.ok(
        await page.evaluate(() =>
          [...window.modelFixture.viewport.grassMaterials.values()].every((m) =>
            window.materialBefore.has(m),
          ),
        ),
        '草材质应复用',
      );
      // 延迟旧草结果返回，在新工程加载后释放，不能覆盖新图。
      await page.evaluate(() => {
        const { viewport: v } = window.modelFixture;
        const run = v.grassTasks.run.bind(v.grassTasks);
        let release;
        const gate = new Promise((r) => (release = r));
        window.oldGrassGate = { release, ready: false };
        let first = true;
        v.grassTasks.run = async (...args) => {
          const result = await run(...args);
          if (first) {
            first = false;
            window.oldGrassGate.ready = true;
            await gate;
          }
          return result;
        };
        window.oldBuild = v.rebuildInstances(true);
      });
      await page.waitForFunction(() => window.oldGrassGate.ready);
      await page.evaluate(() => {
        const { session: s, viewport: v, createDocument } = window.modelFixture;
        s.replace(createDocument(513, 512, 256));
        v.frameMap();
        window.oldGrassGate.release();
      });
      await page.evaluate(() => window.oldBuild);
      await page.waitForFunction(() => window.modelFixture.viewport.diagnosticReady);
      assert.deepEqual(
        await page.evaluate(() => ({
          grass: window.modelFixture.viewport.stats.grass,
          trees: window.modelFixture.viewport.stats.trees,
          sites: window.modelFixture.session.doc.sites.length,
        })),
        { grass: 0, trees: 0, sites: 0 },
      );
      await page.evaluate(() => window.modelFixture.release());
      assert.ok(
        await page.evaluate(() => window.materialDisposals.every((r) => r.count === 1)),
        '持有材质最终恰好释放一次',
      );
      assert.equal(
        await page.evaluate(() => window.modelFixture.viewport.renderer.info.memory.geometries),
        0,
      );
      report.checks.push({
        samples,
        materials,
        staleGrassDiscarded: true,
        materialsReleasedOnce: true,
      });
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
