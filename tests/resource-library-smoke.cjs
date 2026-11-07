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
    await page.getByRole('button', { name: /^资源库/ }).click();
    const library = page.getByRole('dialog', { name: '资源库', exact: true });
    await library.locator('.resource-nav').getByRole('button', { name: /树木/ }).click();
    await library.locator('.model-preview canvas').waitFor();
    const overflow = await library.locator('.model-details').evaluate((details) => {
      const right = details.getBoundingClientRect().left + details.clientWidth;
      return {
        horizontal: details.scrollWidth > details.clientWidth,
        clipped: [...details.querySelectorAll('.overview-row b')].some(
          (value) => value.getBoundingClientRect().right > right,
        ),
      };
    });
    assert.deepEqual(overflow, { horizontal: false, clipped: false });
    fs.mkdirSync('test-results/tests', { recursive: true });
    await page.screenshot({ path: 'test-results/tests/resource-details-1280.png' });
    await library.getByRole('button', { name: '导入资源', exact: true }).click();
    const importer = page.getByRole('dialog', { name: '导入资源', exact: true });
    assert.deepEqual(await importer.getByLabel('资源库分类').locator('option').allTextContents(), [
      '据点',
      '树木',
      '草丛',
      '贴图',
    ]);
    await importer.getByLabel('资源库分类').selectOption('textures');
    await importer.getByLabel('导入贴图类型').selectOption('normal');
    await page.screenshot({ path: 'test-results/tests/resource-import-category.png' });
    const image = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d');
        context.fillStyle = '#8080ff';
        context.fillRect(0, 0, 32, 32);
        return canvas.toDataURL().split(',')[1];
      }),
      'base64',
    );
    const pending = page.waitForEvent('filechooser');
    await importer.getByRole('button', { name: '选择文件' }).click();
    await (
      await pending
    ).setFiles({ name: '分类导入法线.png', mimeType: 'image/png', buffer: image });
    await library
      .locator('.texture-library-detail')
      .getByText('分类导入法线.png', { exact: true })
      .waitFor();
    assert.equal(await library.getByLabel('贴图类型', { exact: true }).inputValue(), 'normal');
    await library.getByRole('button', { name: '导入资源', exact: true }).click();
    await importer.getByLabel('资源库分类').selectOption('grass');
    const modelPending = page.waitForEvent('filechooser');
    await importer.getByRole('button', { name: '选择文件' }).click();
    await (await modelPending).setFiles(path.resolve('editor-assets/models/pine-tree.glb'));
    const model = page.getByRole('dialog', { name: '导入模型', exact: true });
    assert.equal(await model.getByLabel('模型分类', { exact: true }).inputValue(), 'grass');
    await model.getByLabel('模型名称', { exact: true }).fill('分类导入草丛');
    await model.getByRole('button', { name: '确认导入', exact: true }).click();
    await library.getByRole('heading', { name: '分类导入草丛', exact: true }).waitFor();
    await library.getByRole('button', { name: '导入资源', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await importer.count(), 0);
    assert.equal(await library.count(), 1);
    assert.deepEqual(errors, []);
    console.log('资源库：1280×720 详情无横向裁切、跨分类导入贴图和模型、Esc 取消通过');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
