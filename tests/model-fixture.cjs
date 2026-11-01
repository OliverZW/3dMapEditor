const { launch } = require('./surface-fixture.cjs');
async function setup(
  page,
  {
    mode = 'optimized',
    simple = false,
    demo = true,
    performanceMode,
    displayQuality,
    samples = 513,
  } = {},
) {
  const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>',
    }),
  );
  await page.goto(url);
  await page.unroute(url);
  await page.evaluate(
    async ({ mode, simple, demo, performanceMode, displayQuality, samples }) => {
      const source = await (await fetch('/src/renderer/models.ts')).text();
      const resource = source.match(
        /from\s*["']([^"']*\/builtin-resources\.ts(?:\?[^"']*)?)["']/,
      )[1];
      const [
        { initializeBuiltinResources },
        { EditorSession },
        { EditorViewport },
        { createDemo },
        { createDocument },
        THREE,
      ] = await Promise.all([
        import(resource),
        import('/src/application/editor-session.ts'),
        import('/src/renderer/editor-viewport.ts'),
        import('/src/core/demo.ts'),
        import('/src/core/document.ts'),
        import('/node_modules/three/build/three.module.js'),
      ]);
      await initializeBuiltinResources();
      const session = new EditorSession();
      if (!demo) session.replace(createDocument(samples, 256, 256));
      if (demo && samples !== 513) {
        const old = session.doc,
          doc = createDocument(samples, old.settings.width, old.settings.depth);
        const { sampleHeight } = await import('/src/core/terrain.ts');
        Object.assign(doc, {
          name: old.name,
          nextId: old.nextId,
          assets: old.assets,
          trees: old.trees,
          rivers: old.rivers,
          sites: old.sites,
          factions: old.factions,
          owners: old.owners,
          grid: old.grid,
          surfaceMaterial: old.surfaceMaterial,
        });
        doc.grass = old.grass.map((layer) => ({
          ...layer,
          density: new Float32Array(samples * samples),
        }));
        for (let row = 0; row < samples; row++)
          for (let col = 0; col < samples; col++) {
            const index = row * samples + col;
            doc.heights[index] = sampleHeight(
              old,
              old.heights,
              (col / (samples - 1) - 0.5) * old.settings.width,
              (row / (samples - 1) - 0.5) * old.settings.depth,
            );
            const nearest =
              Math.round((row * 512) / (samples - 1)) * 513 +
              Math.round((col * 512) / (samples - 1));
            doc.surface.set(old.surface.subarray(nearest * 4, nearest * 4 + 4), index * 4);
            doc.grass.forEach((layer, i) => {
              layer.density[index] = old.grass[i].density[nearest];
            });
          }
        session.replace(doc);
      }
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0';
      document.body.append(host);
      if (simple) {
        session.view.water = false;
        session.view.hex = false;
        session.view.grass = false;
        session.view.territories = false;
        session.view.factions = false;
      }
      const viewport = new EditorViewport(host, session, {
        modelMode: mode,
        performanceMode,
        displayQuality,
      });
      let plane, material;
      if (simple) {
        plane = new THREE.PlaneGeometry(2048, 2048);
        plane.rotateX(-Math.PI / 2);
        plane.translate(0, 25, 0);
        material = new THREE.MeshLambertMaterial({ color: 0x7f8863 });
        viewport.ground.material = material;
        requestAnimationFrame(() => {
          viewport.ground.geometry = plane;
        });
      }
      window.modelFixture = {
        viewport,
        session,
        host,
        THREE,
        createDemo,
        createDocument,
        release() {
          viewport.dispose();
          plane?.dispose();
          material?.dispose();
          host.remove();
        },
      };
    },
    { mode, simple, demo, performanceMode, displayQuality, samples },
  );
  await page.waitForFunction(
    () => {
      const v = window.modelFixture.viewport;
      return v.treeModelKey && v.siteModelKey && !v.instanceBuilds && !v.instanceTimer;
    },
    {},
    { timeout: 120000 },
  );
}
module.exports = { setup, launch };
