const { chromium } = require('playwright');
const { unzipSync, strFromU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const artifactPath = path.resolve(__dirname, '../test-results');
fs.mkdirSync(artifactPath, { recursive: true });
const edgeCandidate = path.join(
  process.env['PROGRAMFILES(X86)'] || '',
  'Microsoft/Edge/Application/msedge.exe',
);
const edgePath = fs.existsSync(edgeCandidate) ? edgeCandidate : undefined;
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || edgePath,
    headless: true,
    args: [],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [],
    results = [];
  const record = (message) => {
    results.push(message);
    console.log(message);
  };
  page.setDefaultTimeout(90000);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: '工具属性', exact: true }).waitFor();
  await page.waitForTimeout(2000);
  async function save() {
    const wait = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const d = await wait;
    const bytes = fs.readFileSync(await d.path());
    return { files: unzipSync(bytes), bytes };
  }
  const original = await save();
  record('初始示例地图可保存');
  await page.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
  await page.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
  await page.waitForTimeout(350);
  await page.waitForTimeout(1000);
  await page.locator('.tool-rail button').filter({ hasText: '地形' }).click();
  const box = await page.getByTestId('map-canvas').boundingBox();
  const p = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.6 };
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(p.x + i * 12, p.y + 10, { steps: 2 });
    await page.waitForTimeout(100);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const sculpted = await save();
  assert.notDeepEqual(sculpted.files['terrain/base.f32'], original.files['terrain/base.f32']);
  record('地形拖动修改真实高度数据');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const undone = await save();
  assert.deepEqual(undone.files['terrain/base.f32'], original.files['terrain/base.f32']);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  const redone = await save();
  assert.deepEqual(redone.files['terrain/base.f32'], sculpted.files['terrain/base.f32']);
  record('视口雕刻撤销与重做恢复精确高度');
  await page.locator('.tool-rail button').filter({ hasText: '树木' }).click();
  await page.mouse.move(p.x - 130, p.y + 80);
  await page.mouse.down();
  await page.mouse.move(p.x - 90, p.y + 95, { steps: 4 });
  await page.mouse.up();
  const planted = await save();
  assert(
    JSON.parse(strFromU8(planted.files['objects.json'])).trees.length >
      JSON.parse(strFromU8(original.files['objects.json'])).trees.length,
  );
  record('树木画刷新增持久化实例');
  await page.locator('.tool-rail button').filter({ hasText: '草丛' }).click();
  await page.mouse.move(p.x - 100, p.y + 40);
  await page.mouse.down();
  await page.mouse.move(p.x - 70, p.y + 40, { steps: 3 });
  await page.mouse.up();
  const grass = await save();
  const grassPath = Object.keys(original.files).find((p) => p.startsWith('grass/'));
  assert.notDeepEqual(grass.files[grassPath], original.files[grassPath]);
  record('草丛画刷编辑独立密度场');
  await page.locator('.tool-rail button').filter({ hasText: '据点' }).click();
  await page.getByRole('button', { name: /临江城/ }).click();
  await page.getByLabel('所属势力').selectOption('3');
  await page.getByRole('button', { name: '增加辖区', exact: true }).click();
  await page.mouse.move(p.x + 90, p.y + 20);
  await page.mouse.down();
  await page.mouse.move(p.x + 120, p.y + 20, { steps: 4 });
  await page.mouse.up();
  const territory = await save();
  const objects = JSON.parse(strFromU8(territory.files['objects.json']));
  assert.equal(objects.sites.find((s) => s.name === '临江城').factionId, 3);
  assert.notDeepEqual(territory.files['logic/owners.u32'], original.files['logic/owners.u32']);
  record('据点分配势力与逻辑辖区真实保存');
  await page.screenshot({ path: artifactPath + '/editor-territory.png' });
  await page.getByRole('button', { name: /资源库 8/ }).click();
  await page.getByRole('dialog', { name: '模型资源库' }).waitFor();
  await page.locator('.resource-nav').getByRole('button', { name: /草丛/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: artifactPath + '/editor-resources.png' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  record('资源库分类与三维预览可打开');
  await page.getByRole('button', { name: '导出高度图', exact: true }).click();
  await page.waitForTimeout(1000);
  record('高度图导出流程触发');
  await page.getByRole('button', { name: 'Cocos 导出', exact: true }).click();
  const exportWait = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: '生成并下载', exact: true }).click();
  const exported = await exportWait;
  const files = unzipSync(fs.readFileSync(await exported.path()));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(manifest.exportVersion, 2);
  assert.equal(manifest.validation.engine, 'not-run');
  assert(files['terrain/terrain.glb']);
  assert(files['examples/read-map.mjs']);
  assert(!files['cocos/extension/scene.cjs']);
  assert(files[manifest.entries.logic]);
  assert.equal(files['terrain/height16.png'][24], 16);
  record('v2 数据包包含单片地面 GLB、PNG16、逻辑、独立贴图与读取示例，不生成场景');
  fs.writeFileSync(artifactPath + '/cocos-export-test.zip', fs.readFileSync(await exported.path()));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: artifactPath + '/editor-running.png' });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { results, errors, status: await page.locator('.performance').innerText() },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
