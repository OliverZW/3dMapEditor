require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { launch } = require('./surface-fixture.cjs');
const { unzipSync, strFromU8 } = require('fflate');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await launch();
  const report = { checks: [], errors: [] };
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      acceptDownloads: true,
    });
    page.setDefaultTimeout(90000);
    page.on('pageerror', (error) => report.errors.push(String(error)));
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByTestId('map-canvas').waitFor();
    for (const [width, height] of [
      [1600, 1000],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width, height });
      await page.getByRole('button', { name: 'Cocos 导出', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '导出 Cocos 资源包', exact: true });
      await dialog.waitFor();
      assert((await dialog.innerText()).includes('协议 v2'));
      assert((await dialog.innerText()).includes('游戏项目自行读取数据'));
      assert.equal(await dialog.getByRole('checkbox').count(), 5);
      const box = await dialog.boundingBox();
      assert(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
      );
      assert(await dialog.getByRole('button', { name: '生成并下载', exact: true }).isVisible());
      await page.screenshot({ path: `test-results/tests/engine-export-v2-ui-${width}.png` });
      report.checks.push(`${width}×${height} 导出说明及操作完整显示`);
      if (width === 1600) await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }
    const dialog = page.getByRole('dialog', { name: '导出 Cocos 资源包', exact: true });
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '生成并下载', exact: true }).click();
    const download = await pending;
    await download.saveAs('test-results/tests/engine-export-v2-ui.zip');
    const files = unzipSync(fs.readFileSync(await download.path()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.equal(manifest.exportVersion, 2);
    assert.equal(manifest.validation.engine, 'not-run');
    await dialog.getByText(/^v2 数据包校验通过/).waitFor();
    await dialog.getByRole('checkbox', { name: '树木模型与实例', exact: true }).uncheck();
    assert.equal(await dialog.getByText(/^v2 数据包校验通过/).count(), 0);
    assert((await dialog.innerText()).includes('协议 v2：'));
    report.checks.push('实际下载 v2，改变内容选项清除上一包检查结果');
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(
      'test-results/tests/engine-export-v2-ui.json',
      JSON.stringify(report, null, 2),
    );
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
