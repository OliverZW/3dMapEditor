const { launch } = require('./surface-fixture.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await launch();
  try {
    for (const view of ['enlarged', 'actual', 'top']) {
      const page = await browser.newPage({
        viewport: { width: 1200, height: 1320 },
        deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(120000);
      const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
      await page.route(url, (r) =>
        r.fulfill({
          contentType: 'text/html',
          body: '<html><body style="margin:0;background:#263331;color:white;font:14px sans-serif"></body></html>',
        }),
      );
      await page.goto(url);
      await page.unroute(url);
      const report = await page.evaluate(async (view) => {
        const text = await (await fetch('/src/renderer/models.ts')).text();
        const resource = text.match(
          /from\s*["']([^"']*\/builtin-resources\.ts(?:\?[^"']*)?)["']/,
        )[1];
        const [{ initializeBuiltinResources }, { createDocument }, { ModelLibrary }, THREE] =
          await Promise.all([
            import(resource),
            import('/src/core/document.ts'),
            import('/src/renderer/models.ts'),
            import('/node_modules/three/build/three.module.js'),
          ]);
        await initializeBuiltinResources();
        const library = new ModelLibrary(),
          renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(1200, 1320);
        renderer.setScissorTest(true);
        document.body.append(renderer.domElement);
        const report = [];
        for (const [row, asset] of createDocument()
          .assets.filter((a) => ['tree', 'city'].includes(a.kind))
          .entries()) {
          const source = await library.get(asset),
            box = new THREE.Box3().setFromObject(source),
            center = box.getCenter(new THREE.Vector3()),
            size = box.getSize(new THREE.Vector3()),
            radius = box.getBoundingSphere(new THREE.Sphere()).radius;
          for (let level = 0; level < 3; level++) {
            const actual = view !== 'enlarged',
              pixels = [120, 48, 20][level],
              width = actual ? 200 : 400;
            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0x263331);
            scene.add(new THREE.HemisphereLight(0xd8e6de, 0x62634d, 2.3));
            const sun = new THREE.DirectionalLight(0xffe8bd, 3);
            sun.position.set(-400, 800, 300);
            scene.add(sun);
            const distance = Math.max(...size.toArray()) * 2.2,
              half = (radius * 220) / pixels;
            const camera = actual
              ? new THREE.OrthographicCamera(
                  (-half * width) / 220,
                  (half * width) / 220,
                  half,
                  -half,
                  0.01,
                  10000,
                )
              : new THREE.PerspectiveCamera(35, width / 220, 0.01, 10000);
            camera.position
              .copy(center)
              .add(
                view === 'top'
                  ? new THREE.Vector3(0, distance * 2, 0)
                  : new THREE.Vector3(distance * 0.65, distance * 0.65, distance * 0.8),
              );
            if (view === 'top') camera.up.set(0, 0, -1);
            camera.lookAt(center);
            const captures = [];
            let triangles = 0;
            for (const [variant, lod] of (actual ? [0, level] : [level]).entries()) {
              const model = (await library.get(asset, lod)).clone(true);
              scene.add(model);
              const x = level * 400 + variant * width,
                y = (5 - row) * 220;
              const captureX = level * 400;
              renderer.setViewport(captureX, y, width, 220);
              renderer.setScissor(captureX, y, width, 220);
              renderer.render(scene, camera);
              const gl = renderer.getContext(),
                capture = new Uint8Array(width * 220 * 4);
              gl.readPixels(captureX, y, width, 220, gl.RGBA, gl.UNSIGNED_BYTE, capture);
              captures.push(capture);
              if (!actual || variant === 1)
                model.traverse((p) => {
                  if (p.isMesh)
                    triangles +=
                      (p.geometry.index?.count ?? p.geometry.attributes.position.count) / 3;
                });
              if (actual && variant === 1) {
                renderer.setViewport(x, y, width, 220);
                renderer.setScissor(x, y, width, 220);
                renderer.render(scene, camera);
                scene.remove(model);
                const baseline = source.clone(true);
                scene.add(baseline);
                renderer.setViewport(captureX, y, width, 220);
                renderer.setScissor(captureX, y, width, 220);
                renderer.render(scene, camera);
                scene.remove(baseline);
              } else scene.remove(model);
            }
            let max = 0,
              changed = 0;
            if (actual) {
              for (let i = 0; i < captures[0].length; i += 4) {
                let diff = 0;
                for (let c = 0; c < 3; c++)
                  diff = Math.max(diff, Math.abs(captures[0][i + c] - captures[1][i + c]));
                max = Math.max(max, diff);
                if (diff > 2) changed++;
              }
            }
            report.push({
              id: asset.id,
              level,
              triangles,
              pixels: actual ? pixels : undefined,
              maxDifference: max,
              changedPixels: changed,
            });
            const label = document.createElement('div');
            label.textContent =
              asset.name +
              ' L' +
              level +
              (actual ? ` · ${pixels}px 原始 / 优化` : ` · ${triangles}面`);
            label.style.cssText = `position:absolute;left:${level * 400 + 8}px;top:${row * 220 + 4}px`;
            document.body.append(label);
          }
        }
        library.dispose();
        renderer.dispose();
        return report;
      }, view);
      fs.writeFileSync(`test-results/model-lod-${view}.json`, JSON.stringify(report, null, 2));
      if (view !== 'enlarged')
        assert(
          report.filter((r) => r.level === 0).every((r) => r.maxDifference === 0),
          '近景固定画面必须一致',
        );
      await page.screenshot({ path: `test-results/model-lod-${view}.png` });
      fs.writeFileSync(`test-results/model-lod-${view}.json`, JSON.stringify(report, null, 2));
      await page.close();
      console.log(view, '完成；近景固定画面差异为0');
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
