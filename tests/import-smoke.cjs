require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { chromium } = require('playwright');
const { unzipSync, strFromU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const artifacts = path.resolve(__dirname, '../test-results/tests');
const edge = path.join(
  process.env['PROGRAMFILES(X86)'] || '',
  'Microsoft/Edge/Application/msedge.exe',
);
(async () => {
  const files = unzipSync(fs.readFileSync(path.join(artifacts, 'cocos-export-test.zip')));
  const packageManifest = JSON.parse(strFromU8(files['manifest.json']));
  const exported = JSON.parse(strFromU8(files[packageManifest.data]));
  const asset = exported.assets.find(
    (item) => item.kind === 'tree' && item.builtin === 'pine' && item.included,
  );
  const model = asset ? 'assets/' + asset.path : null;
  assert(model && files[model], '先执行 browser-smoke.cjs 生成包含树模型的 Cocos 测试包');
  const fixture = path.join(artifacts, 'custom-pine.glb');
  fs.writeFileSync(fixture, files[model]);
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || (fs.existsSync(edge) ? edge : undefined),
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('button', { name: /资源库/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入静态 GLB' }).click();
    await (await chooser).setFiles(fixture);
    await page
      .getByRole('dialog', { name: '导入模型' })
      .getByRole('button', { name: '确认导入' })
      .click();
    await page.getByRole('heading', { name: 'custom-pine', exact: true }).waitFor();
    await page.getByRole('button', { name: '用于当前工具' }).click();
    const save = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const saved = await save;
    const projectFile = path.join(artifacts, 'import-roundtrip.map3d');
    await saved.saveAs(projectFile);
    const packed = unzipSync(fs.readFileSync(projectFile)),
      manifest = JSON.parse(strFromU8(packed['map.json']));
    const custom = manifest.assets.find((a) => a.name === 'custom-pine');
    assert(custom);
    assert.deepEqual(Buffer.from(packed[custom.resource.path]), Buffer.from(files[model]));
    const open = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await open).setFiles(projectFile);
    await page.getByRole('button', { name: /资源库 9/ }).waitFor();
    assert.deepEqual(errors, []);
    console.log('自定义静态 GLB 导入、工程内原始资源保存、保存重开：通过');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
