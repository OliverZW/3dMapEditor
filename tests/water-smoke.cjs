const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./surface-fixture.cjs');
const { fixture, camera } = require('./water-fixture.cjs');
const { measure } = require('./water-visibility.cjs');
const artifacts = path.resolve(__dirname, '../test-results');

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(60000);
  const errors = [],
    results = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    if (/\/water\/ripple-/.test(r.url())) requests.push(r.url());
  });
  const record = (message) => {
    results.push(message);
    console.log(message);
  };
  try {
    await fixture(page);
    await page.waitForFunction(
      () => window.waterFixture.viewport.waterSurface.waterMaterial.ready.value === 1,
    );
    const original = await page.evaluate(async () => {
      const { session, viewport } = window.waterFixture;
      const { encodeProject } = await import('/src/io/project.ts');
      const bytes = encodeProject(session.doc);
      // 水材质、纹理和时间完全不写入工程文档。
      viewport.waterSurface.setTime(21);
      const after = encodeProject(session.doc);
      const { unzipSync } = await import('/node_modules/fflate/esm/browser.js');
      const beforeFiles = unzipSync(bytes),
        afterFiles = unzipSync(after);
      if (
        Object.keys(beforeFiles).some(
          (file) =>
            !afterFiles[file] ||
            beforeFiles[file].length !== afterFiles[file].length ||
            beforeFiles[file].some((v, i) => v !== afterFiles[file][i]),
        )
      )
        throw Error('显示污染地图数据');
      const water = viewport.scene.getObjectByName('RiverWaterSurfaces');
      const materials = new Set(water.children.map((m) => m.material));
      const depths = water.children.flatMap((m) => [
        ...m.geometry.getAttribute('waterDepth').array,
      ]);
      return {
        materialCount: materials.size,
        minimum: Math.min(...depths),
        maximum: Math.max(...depths),
        count: water.children.length,
      };
    });
    assert.equal(original.materialCount, 1);
    assert.equal(original.count, 3);
    assert(original.minimum < 1 && original.maximum > 5);
    record('三条河流共享水材质，浅岸／深槽具有真实水深，显示不修改工程字节');

    const depthChanges = await page.evaluate(async () => {
      const { session: s, viewport } = window.waterFixture;
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const water = viewport.scene.getObjectByName('RiverWaterSurfaces');
      const mesh = water.children[0],
        geometry = mesh.geometry;
      const read = () => [...geometry.getAttribute('waterDepth').array];
      const before = read();
      const weights = s.doc.surface.slice();
      s.setTool('terrain');
      s.brush.radius = 24;
      s.brush.strength = 0.8;
      s.brush.terrainMode = 'raise';
      s.pointerDown({ x: -80, z: -55 }, false);
      s.endStroke();
      await frame();
      const changed = read();
      const sameGeometry = water.children[0].geometry === geometry;
      s.undo();
      await frame();
      const undone = read();
      s.redo();
      await frame();
      const redone = read();
      const weightsSame = weights.every((v, i) => v === s.doc.surface[i]);
      return { before, changed, undone, redone, sameGeometry, weightsSame };
    });
    assert.notDeepEqual(depthChanges.changed, depthChanges.before);
    assert.deepEqual(depthChanges.undone, depthChanges.before);
    assert.deepEqual(depthChanges.redone, depthChanges.changed);
    assert(depthChanges.sameGeometry && depthChanges.weightsSame);
    record('真实地形画刷更新水深，撤销重做一致；复用水面几何且不修改地表权重');

    const restored = await page.evaluate(async () => {
      const { session: s } = window.waterFixture;
      const { encodeProject, decodeProject } = await import('/src/io/project.ts');
      const { saveDraft, loadDraft } = await import('/src/platform/files.ts');
      const { unzipSync } = await import('/node_modules/fflate/esm/browser.js');
      const expected = encodeProject(decodeProject(encodeProject(s.doc)));
      const doc = decodeProject(expected);
      s.replace(doc);
      await saveDraft(expected);
      const draft = await loadDraft();
      s.newMap(513, 512, 512);
      s.replace(decodeProject(draft.bytes));
      const actual = encodeProject(s.doc);
      const expectedFiles = unzipSync(expected),
        actualFiles = unzipSync(actual);
      const canonical = (value) =>
        Array.isArray(value)
          ? value.map(canonical)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, canonical(value[key])]),
              )
            : value;
      const decoder = new TextDecoder();
      const differences = Object.keys(expectedFiles).filter((name) => {
        const a = expectedFiles[name],
          b = actualFiles[name];
        if (!b) return true;
        if (name.endsWith('.json'))
          return (
            JSON.stringify(canonical(JSON.parse(decoder.decode(a)))) !==
            JSON.stringify(canonical(JSON.parse(decoder.decode(b))))
          );
        return a.length !== b.length || a.some((v, i) => v !== b[i]);
      });
      return {
        differences,
        sameFiles: Object.keys(expectedFiles).length === Object.keys(actualFiles).length,
        version: s.doc.formatVersion,
      };
    });
    assert.deepEqual(restored.differences, []);
    assert(restored.sameFiles);
    assert.equal(restored.version, 3);
    record('v4 备份重开与 IndexedDB 草稿恢复保持地图数据和资源');

    const memory = await page.evaluate(async () => {
      const { session: s, viewport } = window.waterFixture;
      const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await wait();
      const base = s.doc;
      const { createDocument } = await import('/src/core/document.ts');
      const counts = [],
        timings = [];
      for (const [samples, width, depth] of [
        [513, 768, 384],
        [1025, 768, 384],
        [513, 512, 512],
        [1025, 512, 768],
        [513, 512, 512],
      ]) {
        const doc = createDocument(samples, width, depth);
        doc.rivers = structuredClone(base.rivers);
        for (const river of doc.rivers)
          for (const point of river.points) {
            point.x *= width / base.settings.width;
            point.z *= depth / base.settings.depth;
          }
        doc.nextId = 4;
        const start = performance.now();
        s.replace(doc);
        await wait();
        const water = viewport.scene.getObjectByName('RiverWaterSurfaces');
        counts.push({
          ...viewport.renderer.info.memory,
          materials: new Set(water.children.map((m) => m.material)).size,
          programs: viewport.renderer.info.programs.length,
        });
        timings.push({
          samples,
          width,
          depth,
          replaceAndTwoFramesMs: Math.round(performance.now() - start),
        });
        if (
          viewport.scene.getObjectByName('ContinuousTerrain').geometry.getAttribute('position')
            .count !==
          samples * samples
        )
          throw Error('地形采样不一致');
      }
      const gl = viewport.renderer.getContext(),
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        counts,
        timings,
        hardware: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        antialias: true,
        shadowMap: 2048,
      };
    });
    assert(
      memory.counts.every(
        (c) =>
          c.textures === memory.counts[0].textures &&
          c.materials === 1 &&
          c.geometries === memory.counts[0].geometries &&
          c.programs === memory.counts[0].programs,
      ),
    );
    assert.equal(requests.length, 2);
    record('513²／1025²及矩形地图连续切换后纹理、几何、材质和程序数量稳定；水纹仅请求一次');
    await page.screenshot({ path: path.join(artifacts, 'water-resize.png') });
    await page.evaluate(() => {
      const { viewport } = window.waterFixture;
      const source = viewport.waterSurface.waterMaterial;
      window.waterDisposal = {
        bitmaps: [source.normal.value.image, source.mask.value.image],
        renderer: viewport.renderer,
        gl: viewport.renderer.getContext(),
      };
      viewport.dispose();
    });
    const disposal = await page.evaluate(() => ({
      memory: window.waterDisposal.renderer.info.memory,
      lost: window.waterDisposal.gl.isContextLost(),
      closed: window.waterDisposal.bitmaps.every((b) => b.width === 0),
    }));
    assert(
      disposal.memory.textures <= 1 &&
        disposal.memory.geometries === 0 &&
        disposal.lost &&
        disposal.closed,
    );
    record('关闭视口释放水纹、位图及几何，独占图形上下文已关闭');

    await fixture(page, { samples: 1025, width: 768, depth: 384 });
    await page.screenshot({ path: path.join(artifacts, 'water-1025-rect.png') });
    await camera(page, 'close');
    const visibility = await measure(page);
    assert(visibility.pixels > 100);
    assert(visibility.staticChangedRatio < 0.001);
    assert(visibility.movingRatio >= 0.05);
    await page.evaluate(() => window.waterFixture.viewport.dispose());
    record('1025²矩形地图水体内部两秒可见变化超过5%，固定时间画面稳定');

    // 独立页面故障注入：失败与过期加载均不得影响当前地图或泄漏位图。
    const failure = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const failureErrors = [];
    failure.on('pageerror', (e) => failureErrors.push(String(e)));
    await failure.route('**/water/ripple-mask.png', (r) =>
      r.fulfill({ status: 200, contentType: 'image/png', body: 'invalid png' }),
    );
    // 所有内置文件先整组校验；损坏贴图阻止启动，不再静默回退。
    await assert.rejects(() => fixture(failure), /water\/ripple-mask\.png.*内容哈希不符/);
    const fallback = await failure.evaluate(() => ({ hasViewport: Boolean(window.waterFixture) }));
    assert.equal(fallback.hasViewport, false);
    assert.deepEqual(failureErrors, []);
    await failure.close();
    record('损坏水纹按文件名报告并阻止发布不完整资源组');

    const late = await page.evaluate(async () => {
      const { WaterMaterial } = await import('/src/renderer/water-material.ts');
      const decode = window.createImageBitmap.bind(window),
        pending = [],
        bitmaps = [],
        failures = [];
      window.createImageBitmap = async (...args) => {
        const bitmap = await decode(...args);
        bitmaps.push(bitmap);
        await new Promise((resolve) => pending.push(resolve));
        return bitmap;
      };
      const material = new WaterMaterial((message) => failures.push(message));
      try {
        const deadline = performance.now() + 10000;
        while (pending.length < 2 && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10));
        if (pending.length !== 2) throw Error('未收到两个水纹解码结果');
        material.dispose();
        pending.forEach((resolve) => resolve());
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          closed: bitmaps.every((b) => b.width === 0),
          ready: material.ready.value,
          failures,
        };
      } finally {
        window.createImageBitmap = decode;
        pending.forEach((resolve) => resolve());
        material.dispose();
      }
    });
    assert(late.closed);
    assert.equal(late.ready, 0);
    assert.deepEqual(late.failures, []);
    record('解码尚未完成时关闭水材质，过期结果释放位图且不报告假错误');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'water-report.json'),
      JSON.stringify({ results, errors, memory, disposal, fallback, late, visibility }, null, 2),
    );
    record('页面与着色器错误0');
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
