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
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  async function save() {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const files = unzipSync(fs.readFileSync(await (await pending).path()));
    return {
      map: JSON.parse(strFromU8(files['map.json'])),
      objects: JSON.parse(strFromU8(files['objects.json'])),
    };
  }
  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.locator('.tool-rail button').filter({ hasText: '草丛' }).click();
    const preview = page.getByRole('button', { name: '打开资源库切换草丛模型' });
    await preview.locator('canvas').waitFor();
    await page.getByRole('button', { name: '草丛属性说明', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '选择模型', exact: true }).count(), 0);
    const original = await save();
    await preview.click();
    const library = page.getByRole('dialog', { name: '资源库', exact: true });
    await library.locator('.resource-card').first().click();
    await library.getByRole('button', { name: '替换图层模型', exact: true }).click();
    const replaced = await save();
    assert.equal(replaced.objects.grass.length, original.objects.grass.length);
    assert.equal(replaced.objects.grass[0].id, original.objects.grass[0].id);
    assert.equal(replaced.objects.grass[0].seed, original.objects.grass[0].seed);
    await page.getByRole('button', { name: '添加草丛', exact: true }).click();
    await library.getByRole('button', { name: '添加草丛图层', exact: true }).click();
    const added = await save();
    assert.equal(added.objects.grass.length, original.objects.grass.length + 1);
    await page.getByRole('button', { name: '删除草丛', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: '删除草丛图层确认', exact: true });
    await deletion.waitFor();
    const gridToggle = page.getByRole('button', { name: '六边形格线', exact: true });
    const gridShown = await gridToggle.getAttribute('aria-pressed');
    await page.keyboard.press('g');
    assert.equal(await gridToggle.getAttribute('aria-pressed'), gridShown);
    await page.keyboard.press('Escape');
    assert.equal(await deletion.count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: '删除草丛', exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.getByRole('button', { name: '删除草丛', exact: true }).click();
    await deletion.getByRole('button', { name: '取消删除', exact: true }).click();
    await page.getByRole('button', { name: '删除草丛', exact: true }).click();
    fs.mkdirSync('test-results/tests', { recursive: true });
    await page.screenshot({ path: 'test-results/tests/grass-delete-dialog.png' });

    await page.getByRole('button', { name: '确认删除草丛', exact: true }).click();
    const deleted = await save();
    assert.equal(deleted.objects.grass.length, original.objects.grass.length);
    await page.getByRole('button', { name: /撤销/ }).first().click();
    assert.equal((await save()).objects.grass.length, added.objects.grass.length);
    fs.mkdirSync('test-results/tests', { recursive: true });
    await page.screenshot({ path: 'test-results/tests/grass-layers.png' });
    assert.deepEqual(errors, []);
    console.log('草丛图层界面：预览、现有资源库替换、添加、删除、撤销及保存验证通过');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
