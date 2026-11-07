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
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('dialog', (dialog) => dialog.accept());
    const inspector = page.locator('.inspector');
    const tool = async (name) =>
      page.locator('.tool-rail button').filter({ hasText: name }).click();
    const assertEmpty = async (text) => {
      await inspector.getByText(text, { exact: false }).waitFor();
      assert.equal(
        await inspector.locator('input,select,canvas,.property-group,.inspector-actions').count(),
        0,
      );
      assert.equal(await inspector.locator('h2').innerText(), '工具属性');
      assert.equal(await inspector.getByRole('button').count(), 0);
    };
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    for (const label of ['据点', '河流', '势力']) {
      await tool(label);
      await assertEmpty('选择');
      await page.locator('.left-panel .object-row').first().click();
      assert((await inspector.locator('input').count()) > 0);
      while (await page.locator('.left-panel .object-row').count()) {
        await page.locator('.left-panel .object-row').first().click();
        await page.getByRole('button', { name: `删除${label}`, exact: true }).click();
        if (label === '据点')
          await page
            .getByRole('dialog')
            .getByRole('button', { name: '确认删除据点', exact: true })
            .click();
      }
      await assertEmpty(`暂无${label}`);
    }
    for (const label of ['草丛', '树木']) {
      await tool(label);
      const list = page.getByRole('listbox', { name: `${label}图层列表`, exact: true });
      assert((await inspector.locator('.tree-model-preview').count()) > 0);
      if (label === '树木') {
        await inspector.getByRole('button', { name: '选择实例', exact: true }).click();
        await inspector.getByText('请在地图中选择树木实例。', { exact: true }).waitFor();
        assert.equal(await inspector.locator('.inspector-content .property-group').count(), 0);
        await inspector.getByRole('button', { name: '刷入', exact: true }).click();
        await inspector.locator('.tree-model-preview').waitFor();
      }
      while (await list.getByRole('option').count()) {
        await page.getByRole('button', { name: `删除${label}`, exact: true }).click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: `确认删除${label}`, exact: true })
          .click();
      }
      await assertEmpty(`暂无${label}图层`);
      await list.getByText(`暂无${label}图层`, { exact: true }).waitFor();
      fs.mkdirSync('test-results/tests', { recursive: true });
      await page.screenshot({
        path: `test-results/tests/inspector-empty-${label === '草丛' ? 'grass' : 'trees'}.png`,
      });
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await inspector.locator('.tree-model-preview').waitFor();
      assert.equal(
        await inspector.locator('.inspector-content').evaluate((node) => node.scrollTop),
        0,
      );
      await page.getByRole('button', { name: '重做', exact: true }).click();
      await assertEmpty(`暂无${label}图层`);
      await page.getByRole('button', { name: `添加${label}`, exact: true }).click();
      const library = page.getByRole('dialog', { name: '资源库', exact: true });
      await library.getByRole('button', { name: `添加${label}图层`, exact: true }).click();
      await inspector.locator('.tree-model-preview').waitFor();
      await page.setViewportSize({ width: 1600, height: 1000 });
      await inspector.locator('.inspector-content').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await page.getByRole('button', { name: `删除${label}`, exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: `确认删除${label}`, exact: true })
        .click();
      await assertEmpty(`暂无${label}图层`);
      assert.equal(
        await inspector.locator('.inspector-content').evaluate((node) => node.scrollTop),
        0,
      );
    }
    for (const label of ['概览', '地形', '地表']) {
      await tool(label);
      assert((await inspector.locator('input').count()) > 0);
    }
    await tool('河流');
    await page.getByRole('button', { name: '新建河流', exact: true }).click();
    await inspector.getByRole('button', { name: '确认', exact: true }).waitFor();
    await inspector.getByLabel('河流名称', { exact: true }).waitFor();
    await inspector.getByRole('button', { name: '取消', exact: true }).click();
    await tool('据点');
    await page.getByRole('button', { name: '添加据点', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '选择模型并放置', exact: true })
      .click();
    await inspector.getByRole('button', { name: '确认', exact: true }).waitFor();
    await inspector.getByText('放置预览', { exact: true }).waitFor();
    await inspector.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('右侧属性：空图层、选择、删除撤销重做、添加恢复、模式切换、预览及两种窗口验证通过');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
