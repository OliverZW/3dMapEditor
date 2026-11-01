require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { chromium } = require('playwright');
const { unzipSync, strFromU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const artifacts = path.resolve(__dirname, '../test-results/tests');
fs.mkdirSync(artifacts, { recursive: true });
const edge = path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || edge,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();
  const errors = [],
    results = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => dialog.accept());
  const record = (message) => {
    results.push(message);
    console.log(message);
  };
  page.setDefaultTimeout(20000);
  await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: '工具属性', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  async function save() {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const bytes = fs.readFileSync(await (await download).path()),
      files = unzipSync(bytes);
    return { bytes, files, objects: JSON.parse(strFromU8(files['objects.json'])) };
  }
  const initial = await save();
  assert.equal(await page.locator('.inspector').getByText('视图图层', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '六边形格线', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: '六边形格线', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page
    .getByRole('toolbar', { name: '视口显示' })
    .getByRole('button', { name: '树木', exact: true })
    .click();
  await page
    .getByRole('toolbar', { name: '视口显示' })
    .getByRole('button', { name: '树木', exact: true })
    .click();
  await page.screenshot({ path: artifacts + '/interaction-layers.png' });
  const afterLayers = await save();
  assert.deepEqual(afterLayers.files['logic/owners.u32'], initial.files['logic/owners.u32']);
  assert.deepEqual(afterLayers.files['terrain/base.f32'], initial.files['terrain/base.f32']);
  record('左上角显示开关独立可操作，未穿透修改地图');
  const sites = initial.objects.sites;
  await page.locator('.tool-rail button').filter({ hasText: '据点' }).click();
  await page.locator('.left-panel .object-row').filter({ hasText: sites[0].name }).click();
  await page.getByRole('button', { name: '增加辖区', exact: true }).click();
  await page.getByLabel('逻辑半径', { exact: true }).fill('3');
  await page.locator('.left-panel .object-row').filter({ hasText: sites[1].name }).click();
  assert(
    await page
      .getByRole('button', { name: '增加辖区', exact: true })
      .evaluate((e) => e.classList.contains('active')),
  );
  assert.equal(await page.getByLabel('逻辑半径', { exact: true }).inputValue(), '3');
  assert.equal(await page.locator('.tool-rail button').filter({ hasText: '辖区' }).count(), 0);
  await page
    .locator('.left-panel .object-row.selected')
    .filter({ hasText: sites[1].name })
    .waitFor();
  await page.screenshot({ path: artifacts + '/interaction-sites.png' });
  record('同一据点界面切换城池要塞，绘制模式与画刷半径保持');
  await page.locator('.tool-rail button').filter({ hasText: '势力' }).click();
  const faction = initial.objects.factions.find((f) => f.id !== sites[0].factionId);
  await page.locator('.left-panel .object-row').filter({ hasText: faction.name }).click();
  const addButton = page.getByRole('button', { name: '添加据点', exact: true });
  const mapButton = page.getByRole('button', { name: '地图点选', exact: true });
  const mapIcon = await mapButton.locator('svg').getAttribute('class');
  const candidates = page.getByRole('region', { name: '添加据点列表', exact: true });
  const search = page.getByRole('textbox', { name: '搜索据点', exact: true });
  await addButton.click();
  assert.equal(await addButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'false');
  assert(await candidates.isVisible());
  await mapButton.click();
  assert.equal(await addButton.getAttribute('aria-pressed'), 'false');
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: '完成添加', exact: true }).count(), 0);
  assert.equal(await mapButton.locator('svg').getAttribute('class'), mapIcon);
  assert.equal(await candidates.count(), 0);
  await addButton.click();
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'false');
  assert(await candidates.isVisible());
  await addButton.click();
  assert.equal(await addButton.getAttribute('aria-pressed'), 'false');
  assert.equal(await candidates.count(), 0);
  await mapButton.click();
  await mapButton.click();
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'false');
  await addButton.click();
  await search.focus();
  await search.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true });
  assert(await candidates.isVisible());
  await search.press('Escape');
  assert.equal(await candidates.count(), 0);
  await mapButton.click();
  const otherFaction = initial.objects.factions.find((f) => f.id !== faction.id);
  await page.locator('.left-panel .object-row').filter({ hasText: otherFaction.name }).click();
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'false');
  await page.locator('.left-panel .object-row').filter({ hasText: faction.name }).click();
  assert.equal(await addButton.getAttribute('aria-pressed'), 'false');
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'false');
  const afterModes = await save();
  assert.deepEqual(afterModes.objects, initial.objects);
  assert(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled());
  record(
    '列表与地图模式双向互斥、重复点击全部关闭，Esc 支持搜索框并忽略组词，切换势力清理且无历史',
  );
  await page.getByRole('button', { name: '添加据点', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索据点', exact: true }).fill(sites[0].name);
  await page.getByRole('button', { name: '加入当前势力 ' + sites[0].name, exact: true }).click();
  assert(await page.getByRole('textbox', { name: '势力名称', exact: true }).isVisible());
  let assigned = await save();
  assert.equal(assigned.objects.sites.find((s) => s.id === sites[0].id).factionId, faction.id);
  assert.deepEqual(assigned.files['logic/owners.u32'], initial.files['logic/owners.u32']);
  assert(await candidates.isVisible());
  await page.screenshot({ path: artifacts + '/interaction-faction-list.png' });
  record('势力列表添加和转移有效，成员与派生范围更新，面板不跳转');
  await page.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
  await page.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: '定位 ' + sites[0].name, exact: true }).click();
  await page.getByRole('button', { name: '移出势力 ' + sites[0].name, exact: true }).click();
  await page.waitForTimeout(1200);
  let box = await page.getByTestId('map-canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const afterListMapClick = await save();
  assert.equal(afterListMapClick.objects.sites.find((s) => s.id === sites[0].id).factionId, null);
  assert.equal(await addButton.getAttribute('aria-pressed'), 'true');
  record('列表模式点击地图不加入据点，成员移出后保持列表方式');
  await page.getByRole('button', { name: '地图点选', exact: true }).click();
  assert.equal(await candidates.count(), 0);
  await page.waitForTimeout(1200);
  box = await page.getByTestId('map-canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  assigned = await save();
  assert.equal(assigned.objects.sites.find((s) => s.id === sites[0].id).factionId, faction.id);
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: '完成添加', exact: true }).count(), 0);
  await page.screenshot({ path: artifacts + '/interaction-factions.png' });
  await page.keyboard.press('Escape');
  assert.equal(await mapButton.getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assigned = await save();
  assert.equal(assigned.objects.sites.find((s) => s.id === sites[0].id).factionId, null);
  record('地图命中据点模型后加入当前势力，Esc 退出，撤销恢复成员关系');
  // A fresh page avoids the previous map's unsaved-change dialog.
  await page.close();
  const placement = await context.newPage();
  placement.on('pageerror', (error) => errors.push(String(error)));
  await placement.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
  await placement.getByRole('button', { name: '新建', exact: true }).click();
  await placement.getByRole('button', { name: '创建地图', exact: true }).click();
  await placement.getByRole('button', { name: '切换透视 / 正交', exact: true }).click();
  await placement.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
  await placement.waitForTimeout(350);
  await placement.locator('.tool-rail button').filter({ hasText: '据点' }).click();
  async function placeAndVerify(kind, count, screenshot) {
    await placement.getByRole('button', { name: kind, exact: true }).click();
    const canvas = await placement.getByTestId('map-canvas').boundingBox();
    const click = {
      x: canvas.x + canvas.width * (count === 1 ? 0.57 : 0.43),
      y: canvas.y + canvas.height * 0.55,
    };
    await placement.mouse.move(click.x, click.y);
    await placement.waitForTimeout(400);
    assert(await placement.getByRole('button', { name: '确认', exact: true }).isDisabled());
    const coordinates = await placement.locator('.coordinates').innerText();
    const match = coordinates.match(/X ([-\d.]+)\s+Z ([-\d.]+)/);
    assert(match, coordinates);
    await placement.mouse.click(click.x, click.y);
    const center = await placement.locator('.inspector .coordinate-tag').innerText();
    await placement.mouse.move(click.x + 100, click.y + 70);
    await placement.waitForTimeout(200);
    assert.equal(await placement.locator('.inspector .coordinate-tag').innerText(), center);
    await placement.screenshot({ path: artifacts + '/' + screenshot });
    await placement.getByRole('button', { name: '确认', exact: true }).click();
    await placement.getByText('放置预览', { exact: true }).waitFor({ state: 'hidden' });
    const wait = placement.waitForEvent('download');
    await placement.getByRole('button', { name: '保存工程', exact: true }).click();
    const bytes = fs.readFileSync(await (await wait).path());
    const result = await placement.evaluate(
      async ({ bytes, point }) => {
        const { decodeProject } = await import('/src/io/project.ts');
        const { worldHex } = await import('/src/core/hex.ts');
        // GLB 工程用 Base64 传输，避免逐字节 JS 数组使 Playwright 序列化耗尽堆。
        const doc = decodeProject(Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0)));
        return {
          expected: worldHex(doc.grid, point),
          actual: doc.sites.at(-1).center,
          count: doc.sites.length,
        };
      },
      { bytes: bytes.toString('base64'), point: { x: Number(match[1]), z: Number(match[2]) } },
    );
    assert.deepEqual(result.actual, result.expected);
    assert.equal(result.count, count);
  }
  await placeAndVerify('新建城池', 1, 'interaction-placement.png');
  record('正交放置点击锁定，移动鼠标不漂移，保存中心等于点击地面对应格心');
  await placement.setViewportSize({ width: 1280, height: 800 });
  // 投影和观察方向独立；恢复斜向透视后再验证第二个位置。
  await placement.keyboard.down('Shift');
  await placement.getByRole('button', { name: '切换坐标系投影', exact: true }).click();
  await placement.keyboard.up('Shift');
  await placement.waitForTimeout(400);
  await placeAndVerify('新建要塞', 2, 'interaction-placement-perspective.png');
  record('窗口调整后透视放置要塞准确，150% 显示缩放未引入额外偏移');
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    artifacts + '/interaction-report.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
