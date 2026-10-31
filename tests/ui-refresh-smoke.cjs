const { chromium } = require('playwright');
const { unzipSync } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const artifacts = path.resolve(__dirname, '../test-results');
const edge = path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe');

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || edge,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1.5,
    acceptDownloads: true,
  });
  const errors = [],
    results = [];
  const record = (message) => {
    results.push(message);
    console.log(message);
  };
  const tool = (name) => page.locator('.tool-rail button').filter({ hasText: name });
  const left = page.locator('.left-panel');
  const right = page.locator('.inspector');
  const hints = page.getByLabel('地图操作提示', { exact: true });
  page.setDefaultTimeout(25000);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  async function save() {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    return unzipSync(fs.readFileSync(await (await pending).path()));
  }
  async function capture(name) {
    await page.mouse.move(130, 120);
    await page.screenshot({ path: path.join(artifacts, name + '.png') });
  }
  async function checkLayout() {
    const viewport = await page.locator('.viewport-column').boundingBox();
    const toolbar = await page.getByRole('toolbar', { name: '视口显示' }).boundingBox();
    const gizmo = await page.locator('.orientation-gizmo').boundingBox();
    const stats = await page.getByLabel('渲染统计', { exact: true }).boundingBox();
    const performance = page.getByLabel('渲染统计', { exact: true });
    assert.equal(await performance.locator(':scope > span').count(), 3);
    assert(await performance.getByLabel(/^模型面数 \d+ 三角面$/).isVisible());
    const rows = await performance
      .locator(':scope > span')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
    assert(
      rows.every((y) => Math.abs(y - rows[0]) < 1),
      '三个指标保持单行',
    );
    const hintBox = await hints.boundingBox();
    assert(toolbar.x + toolbar.width < gizmo.x, '工具条不可覆盖方向坐标系');
    assert(Math.abs(stats.x - viewport.x - 18) < 1);
    assert(Math.abs(stats.y + stats.height - viewport.y - viewport.height + 14) < 1);
    assert(Math.abs(hintBox.x + hintBox.width - viewport.x - viewport.width + 18) < 1);
    assert(Math.abs(hintBox.y + hintBox.height - stats.y - stats.height) < 1);
    assert(stats.x + stats.width + 10 <= hintBox.x + 1, '统计与提示不可重叠');
    for (const box of [toolbar, stats, hintBox]) {
      assert(box.x >= viewport.x && box.x + box.width <= viewport.x + viewport.width);
      assert(box.y >= viewport.y && box.y + box.height <= viewport.y + viewport.height);
    }
    for (const selector of ['.left-panel', '.inspector-content', '.input-hints']) {
      assert(
        await page.locator(selector).evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        selector + ' 不应横向溢出',
      );
    }
    assert(await hints.getByText('缩放', { exact: false }).isVisible());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
  }

  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('toolbar', { name: '视口显示' }).waitFor();
    await page.waitForTimeout(1000);
    await tool('地形').click();
    for (const label of ['抬高', '降低', '平滑', '定高']) {
      const mode = left.getByRole('button', { name: label, exact: true });
      await mode.click();
      assert.equal(await mode.getAttribute('aria-pressed'), 'true');
      assert((await hints.innerText()).includes('拖动' + label));
    }
    assert.equal(await right.getByLabel('编辑操作', { exact: true }).count(), 0);
    assert.equal(await left.getByRole('slider').count(), 0);
    assert.equal(await right.getByRole('slider').count(), 3);
    await right.getByLabel('目标高度 (m)', { exact: true }).fill('37');
    assert(!(await hints.innerText()).includes('反向升降'));
    await tool('地表').click();
    assert.equal(await left.locator('.surface-grid button').count(), 4);
    for (const swatch of await left.locator('.surface-swatch').all())
      assert(await swatch.isVisible());
    await left.getByRole('button', { name: '岩石', exact: true }).click();
    assert((await hints.innerText()).includes('涂刷岩石'));
    await tool('地形').click();
    assert.equal(
      await left.getByRole('button', { name: '定高', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(await right.getByLabel('目标高度 (m)', { exact: true }).inputValue(), '37');
    await left.getByRole('button', { name: '抬高', exact: true }).click();
    assert((await hints.innerText()).includes('反向升降'));
    await checkLayout();
    await capture('ui-terrain');
    await page.getByRole('toolbar', { name: '视口显示' }).screenshot({
      path: path.join(artifacts, 'ui-toolbar-highlight.png'),
    });
    await page.getByLabel('渲染统计', { exact: true }).screenshot({
      path: path.join(artifacts, 'ui-performance.png'),
    });
    await hints.screenshot({ path: path.join(artifacts, 'ui-input-hints.png') });
    record('地形、地表操作仅在左侧，参数仅在右侧；模式、材质与定高参数切换后保留，提示跟随模式');

    const beforeNavigation = await save();
    await page.getByRole('button', { name: '操作提示', exact: true }).click();
    assert.equal(await hints.count(), 0);
    assert(await page.getByLabel('渲染统计', { exact: true }).isVisible());
    await page.getByRole('button', { name: '操作提示', exact: true }).click();
    const treeLayer = page
      .getByRole('toolbar', { name: '视口显示' })
      .getByRole('button', { name: '树木', exact: true });
    const wasVisible = await treeLayer.getAttribute('aria-pressed');
    await treeLayer.focus();
    await page.keyboard.press('Space');
    assert.notEqual(await treeLayer.getAttribute('aria-pressed'), wasVisible);
    await page.keyboard.press('Space');
    assert.equal(await treeLayer.getAttribute('aria-pressed'), wasVisible);
    const afterNavigation = await save();
    for (const name of ['terrain/base.f32', 'terrain/surface.rgba', 'objects.json']) {
      assert.deepEqual(afterNavigation[name], beforeNavigation[name]);
    }
    record('提示开关、FPS、图层按钮与键盘操作正常，界面操作不误刷地图');

    await tool('地表').click();
    assert.equal(
      await left.getByRole('button', { name: '岩石', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await checkLayout();
    await capture('ui-surface');
    await page.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
    await page.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
    await page.waitForTimeout(400);
    const beforePaint = await save();
    const canvas = await page.getByTestId('map-canvas').boundingBox();
    const point = { x: canvas.x + canvas.width * 0.55, y: canvas.y + canvas.height * 0.6 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 30, point.y + 12, { steps: 5 });
    await page.mouse.up();
    const painted = await save();
    assert.notDeepEqual(painted['terrain/surface.rgba'], beforePaint['terrain/surface.rgba']);
    assert.deepEqual(painted['terrain/base.f32'], beforePaint['terrain/base.f32']);
    assert.deepEqual(painted['objects.json'], beforePaint['objects.json']);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual((await save())['terrain/surface.rgba'], beforePaint['terrain/surface.rgba']);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.deepEqual((await save())['terrain/surface.rgba'], painted['terrain/surface.rgba']);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    record('左侧材质选择实际驱动地表涂刷，未修改高度或对象，撤销与重做精确恢复权重');

    await page.keyboard.press('Home');
    await page.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
    await page.waitForTimeout(300);
    await tool('据点').click();
    await left.locator('.object-row').first().click();
    const actions = right.getByLabel('编辑操作', { exact: true });
    const actionBox = await actions.boundingBox();
    await page.locator('.inspector-content').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    assert.deepEqual(await actions.boundingBox(), actionBox);
    await page.locator('.inspector-content').evaluate((node) => {
      node.scrollTop = 0;
    });
    await capture('ui-sites');
    await tool('草丛').click();
    assert(
      await right
        .getByLabel('编辑操作', { exact: true })
        .getByRole('button', { name: '刷入', exact: true })
        .isVisible(),
    );
    await checkLayout();
    await capture('ui-vegetation');
    await page.getByRole('button', { name: /资源库/ }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.resource-card.selected').count(), 1);
    assert(
      (await page.locator('.resource-nav button[aria-pressed="true"]').innerText()).includes(
        '草丛',
      ),
    );
    const useAsset = page.getByRole('button', { name: '用于当前工具', exact: true });
    const useBox = await useAsset.boundingBox();
    const detailBox = await page.locator('.resource-detail').boundingBox();
    assert(useBox.y + useBox.height <= detailBox.y + detailBox.height);
    await capture('ui-resources');
    await page.keyboard.press('Escape');
    record('据点与植被右侧操作保持可用且固定，列表、资源库和弹窗使用统一视觉');

    await page.setViewportSize({ width: 1280, height: 720 });
    for (const [name, screenshot] of [
      ['地形', 'ui-terrain-1280'],
      ['地表', 'ui-surface-1280'],
    ]) {
      await tool(name).click();
      await checkLayout();
      if (name === '地表')
        for (const swatch of await left.locator('.surface-swatch').all())
          assert(await swatch.isVisible());
      await capture(screenshot);
    }
    await tool('概览').click();
    await checkLayout();
    await capture('ui-overview-1280');
    record('1600×1000、1280×720 布局无横向溢出，工具条、统计、提示和方向坐标系不重叠');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'ui-refresh-report.json'),
      JSON.stringify({ results, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
