require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { launch, fixture } = require('./surface-fixture.cjs');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const materialData = (value) =>
  JSON.parse(JSON.stringify(value, (key, item) => (key === 'resource' ? undefined : item)));
const artifacts = path.resolve(__dirname, '../test-results/tests');
async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  });
  page.setDefaultTimeout(30000);
  page.on('dialog', (dialog) => dialog.accept());
  const errors = [],
    results = [];
  const record = (text) => {
    results.push(text);
    console.log(text);
  };
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const tool = (name) => page.locator('.tool-rail button').filter({ hasText: name });
  const left = page.locator('.left-panel'),
    right = page.locator('.inspector');
  async function save(name = 'surface-check.map3d') {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const download = await pending;
    await download.saveAs(path.join(artifacts, name));
    const files = unzipSync(fs.readFileSync(path.join(artifacts, name)));
    return {
      files,
      manifest: {
        ...JSON.parse(strFromU8(files['manifest.json'])),
        ...JSON.parse(strFromU8(files['map.json'])),
      },
    };
  }
  async function open(name) {
    const pending = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    const discard = page.getByRole('button', { name: '放弃并继续', exact: true });
    if (await discard.isVisible()) await discard.click();
    await (await pending).setFiles(path.join(artifacts, name));
    await page.waitForTimeout(1500);
  }
  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    // 地表交互使用空白地图；密集示例树林另作模型性能检查。
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.getByRole('button', { name: '创建地图', exact: true }).click();
    await tool('地表').click();
    await page.waitForTimeout(2500);
    for (const image of await left.locator('.surface-swatch').all())
      assert(await image.evaluate((node) => node.complete && node.naturalWidth === 128));
    const initial = await save();
    assert.equal(JSON.parse(strFromU8(initial.files['manifest.json'])).formatVersion, 4);
    assert.equal(
      Object.keys(initial.files).filter((name) => name.startsWith('assets/textures/')).length,
      10,
    );
    record('四类真实缩略图、v4 包内十张地表/水面 PNG 与默认参数通过');

    const scale = right.getByRole('slider', { name: '纹理尺度', exact: true });
    const scaleBox = await scale.boundingBox();
    await page.mouse.move(scaleBox.x + scaleBox.width * 0.2, scaleBox.y + scaleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(scaleBox.x + scaleBox.width * 0.6, scaleBox.y + scaleBox.height / 2, {
      steps: 8,
    });
    await page.mouse.move(scaleBox.x + scaleBox.width * 0.75, scaleBox.y + scaleBox.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    const scaled = await save();
    assert(scaled.manifest.surfaceMaterial.scale > 2);
    assert.deepEqual(scaled.files['terrain/surface.rgba'], initial.files['terrain/surface.rgba']);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await save()).manifest.surfaceMaterial.scale, 1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal(
      (await save()).manifest.surfaceMaterial.scale,
      scaled.manifest.surfaceMaterial.scale,
    );
    await right.getByRole('slider', { name: '细节强度', exact: true }).press('End');
    await right.getByRole('checkbox', { name: '坡度显岩', exact: true }).uncheck();
    const settings = await save('surface-settings.map3d');
    assert.equal(settings.manifest.surfaceMaterial.detail, 1);
    assert.equal(settings.manifest.surfaceMaterial.slopeRock, false);
    record('真实鼠标连续调参只产生一条历史；键盘调参、复选框及撤销重做通过');

    // 取消手势，不能把未完成的预览写入工程。
    await scale.dispatchEvent('pointerdown', { pointerId: 21 });
    await scale.evaluate((node) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, '75');
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await scale.dispatchEvent('pointercancel', { pointerId: 21 });
    assert.equal(
      (await save()).manifest.surfaceMaterial.scale,
      settings.manifest.surfaceMaterial.scale,
    );

    await page.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
    await page.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
    await page.waitForTimeout(500);
    await right.getByRole('slider', { name: '强度', exact: true }).press('End');
    const canvas = await page.getByTestId('map-canvas').boundingBox();
    let previous = settings.files['terrain/surface.rgba'];
    for (const name of ['泥土', '岩石', '沙地', '草地']) {
      await left.getByRole('button', { name, exact: true }).click();
      await page.mouse.move(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.57);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width * 0.59, canvas.y + canvas.height * 0.57, {
        steps: 4,
      });
      await page.mouse.up();
      const saved = await save();
      assert.notDeepEqual(saved.files['terrain/surface.rgba'], previous);
      assert.deepEqual(saved.files['terrain/base.f32'], initial.files['terrain/base.f32']);
      previous = saved.files['terrain/surface.rgba'];
    }
    const painted = await save('surface-ui.map3d');
    await open('surface-ui.map3d');
    const reopened = await save();
    assert.deepEqual(
      materialData(reopened.manifest.surfaceMaterial),
      materialData(painted.manifest.surfaceMaterial),
    );
    assert.deepEqual(reopened.files['terrain/surface.rgba'], painted.files['terrain/surface.rgba']);
    record('四类实际视口涂刷不改高度；保存与重新打开保留材质、参数和权重');

    await tool('地表').click();
    await page.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
    await page
      .getByRole('button', { name: '切换坐标系投影', exact: true })
      .click({ modifiers: ['Shift'] });
    await page.mouse.move(120, 100);
    await page.screenshot({ path: path.join(artifacts, 'surface-ui-1600.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    assert(await scale.isVisible());
    assert(await right.getByRole('checkbox', { name: '坡度显岩' }).isVisible());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: path.join(artifacts, 'surface-ui-1280.png') });
    record('1600×1000 和 1280×720 地表参数布局通过');

    await page.evaluate(async () => {
      const { saveDraft } = await import('/src/platform/files.ts');
      const bytes = new Uint8Array(
        await (await fetch('/test-results/tests/surface-ui.map3d')).arrayBuffer(),
      );
      await saveDraft(bytes);
    });
    await page.reload();
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    const recovered = await save();
    assert.deepEqual(
      materialData(recovered.manifest.surfaceMaterial),
      materialData(painted.manifest.surfaceMaterial),
    );
    assert.deepEqual(
      recovered.files['terrain/surface.rgba'],
      painted.files['terrain/surface.rgba'],
    );
    record('IndexedDB 草稿恢复保留地表图片及参数');

    const legacy = { ...painted.files };
    const manifest = { ...painted.manifest, formatVersion: 2 };
    delete manifest.surfaceMaterial;
    legacy['manifest.json'] = strToU8(JSON.stringify(manifest));
    for (const name of Object.keys(legacy))
      if (name.startsWith('assets/textures/')) delete legacy[name];
    fs.writeFileSync(path.join(artifacts, 'surface-v2.map3d'), zipSync(legacy, { level: 0 }));
    await open('surface-v2.map3d');
    const rejected = await save();
    assert.deepEqual(
      materialData(rejected.manifest.surfaceMaterial),
      materialData(painted.manifest.surfaceMaterial),
    );
    assert.deepEqual(rejected.files['terrain/surface.rgba'], painted.files['terrain/surface.rgba']);
    const damaged = { ...painted.files };
    const image = Object.keys(damaged).find((name) => name.startsWith('assets/textures/'));
    damaged[image] = damaged[image].slice();
    damaged[image][50] ^= 1;
    fs.writeFileSync(path.join(artifacts, 'surface-damaged.map3d'), zipSync(damaged, { level: 0 }));
    await open('surface-damaged.map3d');
    assert((await page.locator('body').innerText()).includes('哈希'));
    const retained = await save();
    assert.deepEqual(
      materialData(retained.manifest.surfaceMaterial),
      materialData(rejected.manifest.surfaceMaterial),
    );
    record('旧版工程与损坏贴图拒绝载入，保留当前工程');

    await page.setViewportSize({ width: 1280, height: 800 });
    await fixture(page);
    await page.screenshot({ path: path.join(artifacts, 'surface-after.png') });
    const memory = await page.evaluate(async () => {
      const { viewport, session } = window.surfaceFixture;
      const initial = viewport.renderer.info.memory.textures;
      const counts = [];
      for (const [samples, width, depth] of [
        [513, 768, 384],
        [1025, 768, 384],
        [513, 512, 512],
        [1025, 512, 768],
        [513, 512, 512],
      ]) {
        session.newMap(samples, width, depth);
        await new Promise((resolve) => setTimeout(resolve, 350));
        counts.push(viewport.renderer.info.memory.textures);
      }
      const terrain = viewport.scene.getObjectByName('ContinuousTerrain');
      const vertices = terrain.geometry.getAttribute('position').count;
      const renderer = viewport.renderer;
      const gl = renderer.getContext();
      const gpu = gl.getExtension('WEBGL_debug_renderer_info');
      const hardware = gpu
        ? gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      viewport.dispose();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        initial,
        counts,
        vertices,
        afterDispose: renderer.info.memory,
        contextLost: gl.isContextLost(),
        hardware,
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        antialias: true,
        shadowMap: 2048,
      };
    });
    assert(memory.counts.every((count) => count <= memory.initial));
    assert.equal(memory.vertices, 513 * 513);
    // Three.js 保留一个内部 1×1 阴影占位计数；关闭上下文释放其 GPU 资源。
    assert(memory.afterDispose.textures <= 1);
    assert.equal(memory.contextLost, true);
    assert.equal(memory.afterDispose.geometries, 0);
    record('513²／1025²、矩形地图连续切换后纹理数量保持有界，仍为单片地形');
    await fixture(page, 1025, 768, 384);
    await page.screenshot({ path: path.join(artifacts, 'surface-1025-rect.png') });
    await page.evaluate(() => window.surfaceFixture.viewport.dispose());
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'surface-report.json'),
      JSON.stringify({ results, errors, memory }, null, 2),
    );
    record('浏览器页面与着色器错误为 0');
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
