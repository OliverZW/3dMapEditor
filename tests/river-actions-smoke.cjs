const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ||
      path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.locator('.tool-rail button').filter({ hasText: '河流' }).click();
    const panel = page.locator('.left-panel');
    const create = panel.getByRole('button', { name: '新建河流', exact: true });
    const remove = panel.getByRole('button', { name: '删除河流', exact: true });
    const rows = panel.locator('.object-row');
    const original = await rows.count();
    assert(await remove.isDisabled());
    assert.equal(
      await page
        .locator('.inspector')
        .getByRole('button', { name: '删除河流', exact: true })
        .count(),
      0,
    );
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1600, height: 1000 },
    ]) {
      await page.setViewportSize(size);
      const a = await create.boundingBox(),
        b = await remove.boundingBox();
      assert.equal(a.y, b.y);
      assert(Math.abs(a.width - b.width) <= 1);
    }
    await create.click();
    assert(await create.isDisabled());
    assert(await remove.isDisabled());
    const canvas = await page.getByTestId('map-canvas').boundingBox();
    await page.mouse.click(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.6);
    await page.mouse.click(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.6);
    await page
      .getByLabel('编辑操作', { exact: true })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    assert.equal(await rows.count(), original + 1);
    assert(await remove.isEnabled());
    await page.setViewportSize({ width: 1280, height: 720 });
    fs.mkdirSync('test-results/tests', { recursive: true });
    await page.screenshot({ path: 'test-results/tests/river-actions-1280.png' });
    await remove.click();
    assert.equal(await rows.count(), original);
    assert(await remove.isDisabled());
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await rows.count(), original + 1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal(await rows.count(), original);
    assert.deepEqual(errors, []);
    console.log('河流按钮：两种窗口同排等宽、唯一左侧入口、预览与无选择禁用、删除与撤销重做通过');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
