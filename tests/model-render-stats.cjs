require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { setup, launch } = require('./model-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await launch();
  const report = { checks: [], errors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.setDefaultTimeout(120000);
    page.on('pageerror', (error) => report.errors.push(String(error)));
    const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
    await page.route(url, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
    );
    await page.goto(url);
    await page.unroute(url);
    const draws = await page.evaluate(async () => {
      const source = await (await fetch('/src/renderer/model-batches.ts')).text();
      const threeModule = source.match(/import \* as THREE from ["']([^"']+)["']/)[1];
      const [THREE, { ModelRenderCounter }] = await Promise.all([
        import(threeModule),
        import('/src/renderer/model-render-counter.ts'),
      ]);
      const renderer = new THREE.WebGLRenderer();
      renderer.setSize(96, 96);
      renderer.shadowMap.enabled = true;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 10);
      const light = new THREE.DirectionalLight();
      light.position.set(0, 5, 5);
      light.castShadow = true;
      light.shadow.mapSize.set(64, 64);
      scene.add(light);
      const geometry = new THREE.BoxGeometry();
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.InstancedMesh(geometry, material, 3);
      for (let i = 0; i < 3; i++) mesh.setMatrixAt(i, new THREE.Matrix4());
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      scene.add(mesh);
      // 未挂接的地形／预览即使被绘制，也不应进入模型统计。
      const extraGeometry = new THREE.PlaneGeometry();
      const extra = new THREE.Mesh(extraGeometry, material);
      extra.position.x = 2;
      scene.add(extra);
      const counter = new ModelRenderCounter();
      counter.track(mesh);
      const results = [];
      const render = (name) => {
        counter.reset();
        renderer.render(scene, camera);
        results.push({ name, triangles: counter.triangles, total: renderer.info.render.triangles });
      };
      render('三个实例，排除阴影与未挂接对象');
      render('下一帧不累积');
      mesh.visible = false;
      render('隐藏模型');
      mesh.visible = true;
      mesh.count = 0;
      render('零实例');
      mesh.count = 3;
      mesh.position.x = 100;
      render('视锥外批次');
      mesh.position.x = 0;
      const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial());
      mesh.material = materials;
      render('六组材质不重算整个几何');
      materials[0].visible = false;
      render('隐藏一个材质组');
      const transparent = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      });
      mesh.material = transparent;
      render('双面透明即使完全透明仍计入两次提交');
      geometry.setDrawRange(0, 6);
      render('只计算 drawRange 内的面');
      const triangle = new THREE.BufferGeometry();
      triangle.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
      );
      mesh.geometry = triangle;
      mesh.material = material;
      mesh.computeBoundingSphere();
      render('非索引几何');
      mesh.dispose();
      for (const resource of [mesh.geometry, extraGeometry, geometry]) resource.dispose();
      for (const material of [...materials, transparent, mesh.material]) material.dispose();
      light.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      return results;
    });
    assert.deepEqual(
      draws.map((draw) => draw.triangles),
      [36, 36, 0, 0, 0, 36, 30, 72, 12, 3],
    );
    assert(draws[0].total > 38, '整帧绘制应额外包含阴影和未挂接对象');
    report.checks.push(...draws);

    await setup(page, { demo: false, simple: true });
    await page.evaluate(() => {
      const { session: s } = window.modelFixture;
      s.change('模型面数验收场景', (doc) => {
        doc.trees.push({ id: doc.nextId++, assetId: 'tree-pine', x: 65, z: 0, yaw: 0, scale: 1 });
        doc.grass.push({
          id: doc.nextId++,
          assetId: 'grass-reed',
          density: new Float32Array(doc.heights.length).fill(0.005),
          seed: 1,
          version: 1,
          minScale: 1,
          maxScale: 1,
          maxSlope: 30,
          wind: 1,
        });
      });
      s.setTool('sites');
      for (const [kind, x] of [
        ['city', -65],
        ['fortress', 0],
      ]) {
        s.beginSite(kind);
        s.hoverAt({ x, z: -65 });
        s.pointerDown({ x, z: -65 }, false);
        s.commitSite();
      }
      s.setTool('overview');
      s.setViewLayer('trees', false);
      s.setViewLayer('sites', false);
    });
    await page.waitForFunction(() => {
      const v = window.modelFixture.viewport;
      return (
        !v.instancesDirty && !v.instanceBuilds && !v.instanceTimer && v.stats.modelTriangles === 0
      );
    });
    const sample = async (name, layers) => {
      await page.evaluate((layers) => {
        const { session: s, viewport: v } = window.modelFixture;
        for (const layer of ['trees', 'sites', 'grass'])
          s.setViewLayer(layer, layers.includes(layer));
        window.statsReady = false;
        v.onStats = () => {
          window.statsReady = true;
        };
      }, layers);
      await page.waitForFunction(() => window.statsReady);
      const value = await page.evaluate(() => window.modelFixture.viewport.stats.modelTriangles);
      report.checks.push({ name, triangles: value });
      return value;
    };
    const trees = await sample('单独树木', ['trees']);
    const sites = await sample('城池与要塞', ['sites']);
    const grass = await sample('单独草丛', ['grass']);
    assert(trees > 0 && sites > 0 && grass > 0);
    assert.equal(
      await sample('三类正式模型合计', ['trees', 'sites', 'grass']),
      trees + sites + grass,
    );
    await page.evaluate(() => {
      const v = window.modelFixture.viewport;
      v.navigation.rig.toggleProjection();
      v.camera.position.set(65, 400, 0);
      v.camera.up.set(0, 0, -1);
      v.camera.lookAt(65, 32, 0);
      v.navigation.rig.target.set(65, 32, 0);
      v.camera.zoom = 40;
      v.camera.updateProjectionMatrix();
    });
    const near = await sample('放大镜头切换原模型', ['trees']);
    await page.evaluate(() => {
      const v = window.modelFixture.viewport;
      v.camera.zoom = 0.5;
      v.camera.updateProjectionMatrix();
    });
    const far = await sample('缩小镜头切换低面数 LOD', ['trees']);
    assert(near > far && far > 0);
    await page.evaluate(() => {
      const v = window.modelFixture.viewport;
      v.camera.position.x += 5000;
      v.navigation.rig.target.x += 5000;
    });
    assert.equal(await sample('平移镜头使模型离开视锥', ['trees']), 0);
    await page.evaluate(() => {
      const v = window.modelFixture.viewport;
      v.camera.position.x -= 5000;
      v.navigation.rig.target.x -= 5000;
    });
    assert.equal(await sample('全部模型隐藏', []), 0);
    await page.evaluate(() => {
      const s = window.modelFixture.session;
      s.setTool('sites');
      s.beginSite('city');
      s.hoverAt({ x: 65, z: 65 });
    });
    await page.waitForFunction(() => window.modelFixture.viewport.siteGhost.children.length > 0);
    assert.equal(await sample('放置预览不计入', []), 0);
    await page.evaluate(() => {
      const { session: s, createDocument } = window.modelFixture;
      s.replace(createDocument(513, 256, 256));
    });
    await page.waitForFunction(() => {
      const v = window.modelFixture.viewport;
      return !v.instancesDirty && !v.instanceBuilds && !v.instanceTimer;
    });
    assert.equal(await sample('空工程不残留上一工程读数', ['trees', 'sites', 'grass']), 0);
    await page.evaluate(() => window.modelFixture.release());
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report.checks, null, 2));
  } finally {
    fs.writeFileSync('test-results/tests/model-render-stats.json', JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
