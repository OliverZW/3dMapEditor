require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { launch } = require('./surface-fixture.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
    await page.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><body style="margin:0;background:#263331;color:#fff;font:16px sans-serif"></body></html>',
      }),
    );
    await page.goto(url);
    await page.unroute(url);
    const results = await page.evaluate(async () => {
      const modelSource = await (await fetch('/src/renderer/models.ts')).text();
      const resourceModule = modelSource.match(
        /from\s*["']([^"']*\/builtin-resources\.ts(?:\?[^"']*)?)["']/,
      )?.[1];
      if (!resourceModule) throw Error('无法定位模型实际引用的内置资源模块');
      const [{ initializeBuiltinResources }, { createDocument }, { ModelLibrary }, THREE] =
        await Promise.all([
          import(resourceModule),
          import('/src/core/document.ts'),
          import('/src/renderer/models.ts'),
          import('/node_modules/three/build/three.module.js'),
        ]);
      await initializeBuiltinResources();
      const library = new ModelLibrary(),
        results = [];
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1440, 800);
      renderer.setPixelRatio(1);
      renderer.setScissorTest(true);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      document.body.append(renderer.domElement);
      for (const [index, asset] of createDocument().assets.entries()) {
        const model = await library.get(asset);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x263331);
        scene.add(model, new THREE.HemisphereLight(0xe3f5ff, 0x595a3e, 3));
        const light = new THREE.DirectionalLight(0xffebcb, 3);
        light.position.set(-20, 40, 30);
        scene.add(light);
        const bounds = new THREE.Box3().setFromObject(model),
          size = bounds.getSize(new THREE.Vector3());
        for (let axis = 0; axis < 3; axis++) {
          if (Math.abs(size.toArray()[axis] - asset.size[axis]) > 0.02)
            throw Error(asset.name + ' 尺寸与清单不符');
        }
        let triangles = 0;
        const materials = new Set();
        model.traverse((part) => {
          if (!part.isMesh) return;
          triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
          for (const material of Array.isArray(part.material) ? part.material : [part.material])
            materials.add(material);
          if (!part.receiveShadow || (asset.kind !== 'grass' && !part.castShadow))
            throw Error(asset.name + ' 阴影配置无效');
        });
        if (triangles !== asset.triangles || materials.size !== asset.materials)
          throw Error(asset.name + ' 面数或材质数不符');
        const distance = Math.max(...size.toArray()) * 2.1,
          center = bounds.getCenter(new THREE.Vector3());
        const camera = new THREE.PerspectiveCamera(35, 360 / 400, 0.01, 10000);
        camera.position
          .copy(center)
          .add(new THREE.Vector3(distance * 0.65, distance * 0.45, distance * 0.8));
        camera.lookAt(center);
        renderer.setViewport((index % 4) * 360, index < 4 ? 400 : 0, 360, 400);
        renderer.setScissor((index % 4) * 360, index < 4 ? 400 : 0, 360, 400);
        renderer.render(scene, camera);
        const label = document.createElement('div');
        label.textContent = asset.name;
        label.style.cssText = `position:absolute;left:${(index % 4) * 360 + 20}px;top:${index < 4 ? 15 : 415}px`;
        document.body.append(label);
        results.push({
          name: asset.name,
          triangles,
          materials: materials.size,
          size: size.toArray(),
        });
      }
      // 保留只读渲染结果供截图，页面关闭时统一释放。
      window.releaseReview = () => {
        library.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
      return results;
    });
    assert.equal(results.length, 8);
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: path.resolve('test-results/tests/builtin-models-contact-sheet.png'),
    });
    fs.writeFileSync(
      path.resolve('test-results/tests/builtin-models-review.json'),
      JSON.stringify(results, null, 2),
    );
    await page.evaluate(() => window.releaseReview());
    console.log('八个实际 GLB 的 WebP 贴图、尺寸、面数、材质数、阴影及渲染检查通过。');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
