const { chromium } = require('playwright');
const { unzipSync, strFromU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ||
      path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  async function save() {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const files = unzipSync(fs.readFileSync(await (await pending).path()));
    return JSON.parse(strFromU8(files['objects.json']));
  }
  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5174/');
    await page.locator('.tool-rail button').filter({ hasText: '据点' }).click();
    const list = page.locator('.site-list');
    await list.locator('.object-row').first().click();
    const original = await save();
    const preview = page.getByRole('button', { name: '打开资源库切换据点模型' });
    await preview.locator('canvas').waitFor();
    await preview.click();
    const library = page.getByRole('dialog', { name: '资源库', exact: true });
    assert.equal(await library.locator('.resource-card').count(), 2);
    assert.equal(
      await library
        .locator('.resource-nav')
        .getByRole('button', { name: /城池|要塞/ })
        .count(),
      0,
    );
    await library.locator('.resource-card').filter({ hasText: '山关要塞' }).click();
    await library.getByRole('button', { name: '替换据点模型', exact: true }).click();
    const replaced = await save();
    assert.equal(replaced.sites[0].assetId, 'fort-stone');
    assert.deepEqual(replaced.sites[0], {
      ...original.sites[0],
      kind: 'fortress',
      assetId: 'fort-stone',
    });
    await page.getByRole('button', { name: /撤销/ }).first().click();
    assert.deepEqual((await save()).sites, original.sites);
    const deleteButton = page.getByRole('button', { name: '删除据点', exact: true });
    await deleteButton.click();
    const deleteDialog = page.getByRole('dialog', { name: '删除据点确认' });
    await deleteDialog.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await deleteDialog.count(), 0);
    assert.equal(await deleteButton.evaluate((button) => button === document.activeElement), true);
    await deleteButton.click();
    await deleteDialog.getByRole('button', { name: '取消删除', exact: true }).click();
    assert.equal(await list.locator('.object-row').count(), original.sites.length);
    await page.getByRole('button', { name: '添加据点', exact: true }).click();
    await library.getByRole('button', { name: '选择模型并放置', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual((await save()).sites, original.sites);
    await list.locator('.object-row').first().click();
    await page.getByRole('button', { name: '添加据点', exact: true }).click();
    await library.getByRole('button', { name: '选择模型并放置', exact: true }).click();
    await page.mouse.click(700, 700);
    await page.getByRole('button', { name: '确认', exact: true }).click();
    const added = await save();
    assert.equal(added.sites.length, original.sites.length + 1);
    assert.match(added.sites.at(-1).name, /^据点 /);
    await page.getByRole('button', { name: '删除据点', exact: true }).click();
    await page.getByRole('button', { name: '确认删除据点', exact: true }).click();
    assert.deepEqual((await save()).sites, original.sites);
    await page.getByRole('button', { name: /撤销/ }).first().click();
    assert.deepEqual((await save()).sites, added.sites);
    await page.getByRole('button', { name: /撤销/ }).first().click();
    await list.locator('.object-row').first().click();
    fs.mkdirSync('test-results/tests', { recursive: true });
    await page.screenshot({ path: 'test-results/tests/sites-unified.png' });
    assert.deepEqual(errors, []);
    console.log('统一据点界面：资源合并、跨分类替换、撤销、删除取消、添加取消及保存通过');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
