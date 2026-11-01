require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./surface-fixture.cjs');
const { fixture, camera } = require('./water-fixture.cjs');
const artifacts = path.resolve(__dirname, '../test-results/tests');

async function measure(page) {
  return page.evaluate(() => {
    const { viewport: v } = window.waterFixture;
    const width = v.renderer.domElement.width,
      height = v.renderer.domElement.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const read = () => {
      ctx.drawImage(v.renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, width, height).data;
    };
    const render = (time) => {
      v.waterSurface.setTime(time);
      v.renderer.render(v.scene, v.camera);
      return read();
    };
    const first = render(7),
      control = render(7),
      second = render(9),
      beforeBoundary = render(11.99),
      afterBoundary = render(12.01),
      preceding = render(11.97);
    // 以真实遮挡关系渲染独立水体掩码；只在测试内临时替换材质，不向产品增加测试入口。
    const water = v.waterSurface.group;
    const Constructor = water.children[0].material.constructor;
    const black = new Constructor({
      color: 0,
      emissive: 0,
      side: 2,
      fog: false,
      toneMapped: false,
    });
    const white = new Constructor({
      color: 0,
      emissive: 0xffffff,
      side: 2,
      fog: false,
      toneMapped: false,
    });
    const materials = [],
      hidden = [],
      background = v.scene.background.clone();
    let mask;
    try {
      v.scene.background.set(0);
      v.scene.traverse((object) => {
        if (object.isMesh) {
          materials.push([object, object.material]);
          object.material = object.parent === water ? white : black;
        } else if (object.isLight || object.isLine || object.isPoints) {
          hidden.push([object, object.visible]);
          object.visible = false;
        }
      });
      v.renderer.render(v.scene, v.camera);
      mask = read();
    } finally {
      for (const [o, m] of materials) o.material = m;
      for (const [o, visible] of hidden) o.visible = visible;
      v.scene.background.copy(background);
      black.dispose();
      white.dispose();
      render(7);
    }
    window.waterVisibilityMask = { bytes: mask, width, height };
    const luminance = (bytes, i) =>
      bytes[i] * 0.2126 + bytes[i + 1] * 0.7152 + bytes[i + 2] * 0.0722;
    let pixels = 0,
      moving = 0,
      staticChanged = 0,
      totalDelta = 0,
      peakDelta = 0,
      bright = 0,
      boundaryDelta = 0,
      precedingDelta = 0;
    const deltas = [];
    for (let y = 2; y < height - 2; y++)
      for (let x = 2; x < width - 2; x++) {
        let inside = true;
        for (let dy = -2; dy <= 2 && inside; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (mask[((y + dy) * width + x + dx) * 4] < 250) {
              inside = false;
              break;
            }
          }
        if (!inside) continue;
        const i = (y * width + x) * 4;
        const delta = Math.abs(luminance(first, i) - luminance(second, i));
        boundaryDelta += Math.abs(luminance(beforeBoundary, i) - luminance(afterBoundary, i));
        precedingDelta += Math.abs(luminance(preceding, i) - luminance(beforeBoundary, i));
        pixels++;
        totalDelta += delta;
        peakDelta = Math.max(peakDelta, delta);
        if (delta >= 6) moving++;
        if (Math.abs(luminance(first, i) - luminance(control, i)) >= 1) staticChanged++;
        if (luminance(first, i) > 200) bright++;
        deltas.push(delta);
      }
    deltas.sort((a, b) => a - b);
    return {
      pixels,
      movingRatio: moving / pixels,
      staticChangedRatio: staticChanged / pixels,
      meanDelta: totalDelta / pixels,
      peakDelta,
      p95Delta: deltas[Math.floor(deltas.length * 0.95)],
      overbrightRatio: bright / pixels,
      boundaryMeanDelta: boundaryDelta / pixels,
      precedingMeanDelta: precedingDelta / pixels,
    };
  });
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const errors = [],
    measurements = [];
  let stoppedAnimation;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    for (const scenario of [
      { demo: true, views: ['demo', 'overview', 'top', 'demoClose'] },
      { demo: false, views: ['oblique', 'top', 'close', 'far'] },
    ]) {
      await fixture(page, { demo: scenario.demo });
      await page.waitForFunction(
        () => window.waterFixture.viewport.waterSurface.waterMaterial.ready.value === 1,
      );
      for (const view of scenario.views) {
        await camera(page, view);
        const result = await measure(page);
        const name = `${scenario.demo ? 'demo' : 'fixture'}-${view}`;
        measurements.push({ name, ...result });
        console.log(name, JSON.stringify(result));
        await page.screenshot({ path: path.join(artifacts, `water-motion-${name}.png`) });
      }
      if (!scenario.demo) {
        await page.evaluate(() => {
          const surface = window.waterFixture.viewport.waterSurface;
          window.waterSetTime = surface.setTime;
          surface.waterMaterial.time.value = 7;
          surface.setTime = () => {};
        });
        stoppedAnimation = await measure(page);
        await page.evaluate(() => {
          window.waterFixture.viewport.waterSurface.setTime = window.waterSetTime;
        });
        assert(
          stoppedAnimation.movingRatio < 0.001,
          '负对照应识别动画停止，不能把静态水面判为可见流动',
        );
      }
      await page.evaluate(() => window.waterFixture.viewport.dispose());
    }
    const hardware = await page.evaluate(() => {
      return {
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        revision: 'water-motion-v2',
      };
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'water-visibility-report.json'),
      JSON.stringify({ measurements, stoppedAnimation, errors, hardware }, null, 2),
    );
    for (const result of measurements) {
      assert(result.pixels > 100, `${result.name}: 掩码内水体过少`);
      assert(result.staticChangedRatio < 0.001, `${result.name}: 固定时间画面不稳定`);
      assert(result.movingRatio >= 0.05, `${result.name}: 两秒变化达到6/255的水体不足5%`);
      assert(result.overbrightRatio < 0.15, `${result.name}: 水面过曝区域过多`);
      assert(
        result.boundaryMeanDelta < Math.max(1, result.precedingMeanDelta * 2),
        `${result.name}: 流纹周期重置出现跳变`,
      );
    }
    console.log('水体内部可见变化、固定时间稳定性与亮度检查通过，页面／着色器错误0。');
  } finally {
    await browser.close();
  }
}
module.exports = { measure };
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
