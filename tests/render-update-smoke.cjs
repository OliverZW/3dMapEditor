require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { setup, launch } = require('./model-fixture.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const report = { editing: [], checks: [], errors: [] };
const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

(async () => {
  const browser = await launch();
  try {
    for (const samples of [513, 1025])
      for (const mode of ['baseline', 'optimized']) {
        const page = await browser.newPage({
          viewport: { width: 1200, height: 800 },
          deviceScaleFactor: 1,
        });
        page.on('pageerror', (error) => report.errors.push(String(error)));
        await setup(page, {
          demo: false,
          samples,
          performanceMode: mode === 'baseline' ? mode : undefined,
        });
        const idle = () =>
          page.waitForFunction(
            () => {
              const { viewport: v, session: s } = window.modelFixture;
              return (
                v.seenRevision === s.revision &&
                !v.instanceBuilds &&
                !v.instanceTimer &&
                !v.instancesDirty
              );
            },
            {},
            { timeout: 120000 },
          );
        await page.evaluate(() => {
          const { session: s } = window.modelFixture;
          s.setTool('terrain');
          Object.assign(s.brush, { radius: 4, strength: 0.15, terrainMode: 'raise' });
        });
        const rows = [];
        for (let step = 0; step < 12; step++) {
          const pointerMs = await page.evaluate((step) => {
            const s = window.modelFixture.session,
              t = performance.now();
            if (!step) s.pointerDown({ x: -8, z: 0 }, false);
            else s.pointerMove({ x: -8 + step, z: step * 0.5 }, false);
            return performance.now() - t;
          }, step);
          await idle();
          rows.push({
            pointerMs,
            ...(await page.evaluate(() => ({
              ...window.modelFixture.viewport.terrainGeometry.diagnostics,
            }))),
          });
        }
        const comparison = await page.evaluate(async () => {
          const { session: s, viewport: v, THREE } = window.modelFixture;
          const { TerrainGeometry } = await import('/src/renderer/terrain-geometry.ts');
          const { sampleHeight } = await import('/src/core/terrain.ts');
          const full = new TerrainGeometry();
          full.update(s.doc, s.heights);
          const equal = (name) =>
            full
              .getAttribute(name)
              .array.every((value, i) => value === v.terrainGeometry.getAttribute(name).array[i]);
          const ray = new THREE.Raycaster(
            new THREE.Vector3(0, 500, 0),
            new THREE.Vector3(0, -1, 0),
          );
          const picked = ray.intersectObject(v.ground)[0].point.y;
          const result = {
            positions: equal('position'),
            normals: equal('normal'),
            picked,
            expected: sampleHeight(s.doc, s.heights, 0, 0),
            heights: s.doc.heights.slice(),
          };
          window.editedHeights = result.heights;
          delete result.heights;
          full.dispose();
          s.endStroke();
          return result;
        });
        assert(comparison.positions && comparison.normals);
        assert(Math.abs(comparison.picked - comparison.expected) < 0.00001);
        await page.evaluate(() => window.modelFixture.session.undo());
        await idle();
        assert(
          await page.evaluate(() =>
            window.modelFixture.session.doc.heights.every((value) => value === 32),
          ),
        );
        await page.evaluate(() => window.modelFixture.session.redo());
        await idle();
        assert(
          await page.evaluate(() =>
            window.modelFixture.session.doc.heights.every(
              (value, i) => value === window.editedHeights[i],
            ),
          ),
        );
        await page.evaluate(() => {
          const s = window.modelFixture.session;
          s.pointerDown({ x: 40, z: 40 }, false);
          s.cancelStroke();
        });
        await idle();
        assert(
          await page.evaluate(() =>
            window.modelFixture.session.doc.heights.every(
              (value, i) => value === window.editedHeights[i],
            ),
          ),
        );
        const summary = {
          samples,
          mode,
          medianUpdateMs: median(rows.map((row) => row.updateMs)),
          medianPointerMs: median(rows.map((row) => row.pointerMs)),
          medianBytes: median(rows.map((row) => row.bytes)),
          medianVertices: median(rows.map((row) => row.vertices)),
          rows,
          comparison,
        };
        report.editing.push(summary);
        console.log('EDIT', JSON.stringify({ ...summary, rows: undefined }));
        await page.evaluate(() => {
          const { session: s, createDocument } = window.modelFixture;
          s.replace(createDocument(513, 512, 256));
          s.replace(createDocument(1025, 768, 384));
        });
        await idle();
        const reset = await page.evaluate(() => {
          const v = window.modelFixture.viewport;
          const result = {
            vertices: v.terrainGeometry.getAttribute('position').count,
            left: v.terrainGeometry.getAttribute('position').getX(0),
            fullUpdate: v.terrainGeometry.diagnostics.vertices,
          };
          window.modelFixture.release();
          return result;
        });
        assert.equal(reset.vertices, 1025 * 1025);
        assert.equal(reset.fullUpdate, reset.vertices);
        assert.equal(reset.left, -384);
        const released = await page.evaluate(async () => {
          await Promise.resolve();
          await Promise.resolve();
          return window.modelFixture.viewport.renderer.info.memory.geometries;
        });
        assert.equal(released, 0);
        report.checks.push({ samples, mode, reset, released });
        await page.close();
      }
    const page = await browser.newPage();
    await setup(page, { demo: false });
    const leases = await page.evaluate(async () => {
      const { viewport: v, session: s, THREE } = window.modelFixture;
      const asset = s.doc.assets.find((asset) => asset.id === 'tree-pine');
      const raw = await v.library.get(asset),
        derived = await v.library.getForRendering(asset);
      const geometry = new Set(),
        material = new Set();
      raw.traverse((object) => {
        if (object.isMesh) {
          geometry.add(object.geometry);
          material.add(object.material);
        }
      });
      derived.traverse((object) => {
        if (object.isMesh) geometry.add(object.geometry);
      });
      for (const owned of derived.userData.ownedMaterials) material.add(owned);
      const counts = [];
      for (const resource of [...geometry, ...material]) {
        const row = { type: resource.type, disposals: 0 };
        counts.push(row);
        resource.addEventListener('dispose', () => {
          row.disposals++;
        });
      }
      window.modelFixture.release();
      await Promise.resolve();
      await Promise.resolve();
      return counts;
    });
    assert(leases.length > 0 && leases.every((row) => row.disposals === 1));
    report.checks.push({ derivedCacheDisposals: leases });
    await page.close();
    assert.deepEqual(report.errors, []);
  } finally {
    fs.writeFileSync(
      'test-results/tests/render-update-smoke.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
