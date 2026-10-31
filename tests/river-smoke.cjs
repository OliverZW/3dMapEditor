const { chromium } = require('playwright');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const artifacts = path.resolve(__dirname, '../test-results');
const edge = path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe');
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || edge,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [],
    results = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.setDefaultTimeout(30000);
  const record = (message) => {
    results.push(message);
    console.log(message);
  };
  const actions = () => page.getByLabel('编辑操作', { exact: true });
  const nameInput = () => page.getByRole('textbox', { name: '河流名称', exact: true });
  async function save() {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const bytes = fs.readFileSync(await (await pending).path()),
      files = unzipSync(bytes);
    return { bytes, files, rivers: JSON.parse(strFromU8(files['objects.json'])).rivers };
  }
  async function open(file) {
    const pending = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await pending).setFiles(file);
  }
  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('heading', { name: '工具属性', exact: true }).waitFor();
    const initial = await save();
    const fixtureFiles = initial.files;
    const fixtureManifest = JSON.parse(strFromU8(fixtureFiles['map.json']));
    const fixtureObjects = { trees: [], grass: [], sites: [], factions: [], rivers: [] };
    {
      const make = (id, name, points, waterLevel) => ({
        id,
        name,
        points: points.map(([x, z]) => ({ x, z })),
        width: 48,
        depth: 6,
        waterLevel,
        interpolation: 'linear',
      });
      fixtureObjects.rivers = [
        make(
          1,
          '汉水',
          [
            [-600, 0],
            [600, 0],
          ],
          24,
        ),
        make(
          2,
          '支流',
          [
            [0, -600],
            [0, 600],
          ],
          26,
        ),
        make(
          3,
          '北河',
          [
            [-600, 400],
            [600, 400],
          ],
          28,
        ),
      ];
    }
    fixtureManifest.nextId = 4;
    fixtureFiles['map.json'] = strToU8(JSON.stringify(fixtureManifest));
    fixtureFiles['objects.json'] = strToU8(JSON.stringify(fixtureObjects));
    fixtureFiles['logic/owners.u32'] = new Uint8Array(fixtureFiles['logic/owners.u32'].length);
    const flatHeight = Buffer.alloc(fixtureFiles['terrain/base.f32'].length);
    for (let i = 0; i < flatHeight.length; i += 4) flatHeight.writeFloatLE(32, i);
    fixtureFiles['terrain/base.f32'] = flatHeight;
    const fixture = zipSync(fixtureFiles);
    const fixtureFile = path.join(artifacts, 'river-fixture.map3d');
    fs.writeFileSync(fixtureFile, Buffer.from(fixture));
    await open(fixtureFile);
    await page.locator('.tool-rail button').filter({ hasText: '河流' }).click();
    await page.locator('.left-panel .object-row').filter({ hasText: '汉水' }).click();
    await nameInput().fill('  长江  ');
    await nameInput().blur();
    assert.equal((await save()).rivers[0].name, '长江');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await nameInput().inputValue(), '汉水');
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal(await nameInput().inputValue(), '长江');
    await nameInput().fill(' ');
    await nameInput().blur();
    assert(await page.getByRole('alert').filter({ hasText: '不能为空' }).isVisible());
    assert.equal((await save()).rivers[0].name, '长江');
    await nameInput().fill('长江');
    await nameInput().blur();
    record('已保存河流可中文改名、裁去空白并撤销重做，空名不会污染工程');

    await actions().getByRole('button', { name: '编辑控制点', exact: true }).click();
    await nameInput().fill('取消的名称');
    await page.getByLabel('水位 (m)', { exact: true }).fill('30');
    assert.match(await page.getByLabel('交汇水位联动').innerText(), /2 条河流.*30 m.*支流.*北河/);
    await actions().getByRole('button', { name: '取消', exact: true }).click();
    let saved = await save();
    assert.deepEqual(
      saved.rivers.map((r) => r.waterLevel),
      [24, 26, 28],
    );
    assert.equal(saved.rivers[0].name, '长江');
    record('交汇预览列出两条相连河流与目标水位，取消保留名称和全部水位');

    await page.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
    await actions().getByRole('button', { name: '编辑控制点', exact: true }).click();
    await nameInput().fill('长江主河');
    await page.getByLabel('水位 (m)', { exact: true }).fill('30');
    await page.screenshot({ path: path.join(artifacts, 'river-preview.png') });
    await actions().getByRole('button', { name: '确认', exact: true }).click();
    saved = await save();
    assert.deepEqual(
      saved.rivers.map((r) => r.waterLevel),
      [30, 30, 30],
    );
    assert.equal(saved.rivers[0].name, '长江主河');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    saved = await save();
    assert.deepEqual(
      saved.rivers.map((r) => r.waterLevel),
      [24, 26, 28],
    );
    assert.equal(saved.rivers[0].name, '长江');
    await page.getByRole('button', { name: '重做', exact: true }).click();
    saved = await save();
    assert.deepEqual(
      saved.rivers.map((r) => r.waterLevel),
      [30, 30, 30],
    );
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(artifacts, 'river-crossing.png') });
    record('确认统一整组水位与预览名称，一次撤销／重做完整恢复');

    const roundtrip = path.join(artifacts, 'river-roundtrip.map3d');
    fs.writeFileSync(roundtrip, saved.bytes);
    await open(roundtrip);
    await page.locator('.left-panel .object-row').filter({ hasText: '长江主河' }).click();
    assert.equal(await nameInput().inputValue(), '长江主河');
    assert.deepEqual((await save()).rivers, saved.rivers);
    record('工程保存重开保留独立河流身份、名称与交汇水位');

    await page.getByRole('button', { name: 'Cocos 导出', exact: true }).click();
    const exported = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: '生成并下载', exact: true }).click();
    const packBytes = fs.readFileSync(await (await exported).path()),
      pack = unzipSync(packBytes);
    const manifest = JSON.parse(strFromU8(pack['manifest.json']));
    assert.deepEqual(JSON.parse(strFromU8(pack[manifest.data])).rivers, saved.rivers);
    const glb = Buffer.from(pack['assets/water/water.glb']);
    const jsonLength = glb.readUInt32LE(12),
      gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
    const binStart = 20 + jsonLength + 8;
    let totalArea = 0;
    for (const mesh of gltf.meshes)
      for (const primitive of mesh.primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION],
          view = gltf.bufferViews[accessor.bufferView];
        const offset = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0),
          stride = view.byteStride || 12;
        const read = (i) => [0, 4, 8].map((k) => glb.readFloatLE(offset + i * stride + k));
        for (let i = 0; i < accessor.count; i += 3) {
          const [a, b, c] = [read(i), read(i + 1), read(i + 2)];
          assert.equal(a[1], 30);
          assert.equal(b[1], 30);
          assert.equal(c[1], 30);
          totalArea += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
        }
      }
    assert(
      Math.abs(totalArea - (3 * 1200 * 48 - 2 * 48 * 48)) < 0.1,
      `Unexpected water area ${totalArea}`,
    );
    fs.writeFileSync(path.join(artifacts, 'river-cocos-test.zip'), packBytes);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    record('Cocos 包保留名称和参数，水面 GLB 为同水位并集、无重复面积');

    for (const size of [
      { width: 1600, height: 1000 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await actions().getByRole('button', { name: '编辑控制点', exact: true }).click();
      const confirm = actions().getByRole('button', { name: '确认', exact: true });
      assert(await confirm.isVisible());
      assert(await nameInput().isVisible());
      assert(await page.getByLabel('交汇水位联动').isVisible());
      await nameInput().fill('');
      assert(await confirm.isDisabled());
      await nameInput().fill('长江主河');
      await nameInput().dispatchEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        isComposing: true,
        bubbles: true,
      });
      assert(await confirm.isVisible());
      await page.screenshot({ path: path.join(artifacts, `river-preview-${size.width}.png`) });
      await actions().getByRole('button', { name: '取消', exact: true }).click();
      await page.screenshot({ path: path.join(artifacts, `river-${size.width}.png`) });
    }
    record('1600×1000 与 1280×720 名称、联动提示及固定操作可见，空名禁确认、输入法不触发取消');

    const createRiver = page
      .locator('.left-panel')
      .getByRole('button', { name: '新建河流', exact: true });
    assert.equal(await actions().getByRole('button', { name: '新建河流', exact: true }).count(), 0);
    await createRiver.click();
    assert(await createRiver.isDisabled());
    await nameInput().fill('自定义新河流');
    const canvas = await page.getByTestId('map-canvas').boundingBox();
    await page.mouse.click(canvas.x + canvas.width * 0.32, canvas.y + canvas.height * 0.6);
    await page.mouse.click(canvas.x + canvas.width * 0.68, canvas.y + canvas.height * 0.6);
    await actions().getByRole('button', { name: '确认', exact: true }).click();
    assert((await save()).rivers.some((r) => r.name === '自定义新河流'));
    assert(await createRiver.isEnabled());
    record('真实视口点击新建河流后保留自定义名称');
    await page.getByRole('button', { name: '删除河流', exact: true }).click();
    const deleted = await save();
    assert.equal(deleted.rivers.length, 3);
    assert.deepEqual(deleted.files['terrain/base.f32'], saved.files['terrain/base.f32']);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal((await save()).rivers.length, 4);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    assert.equal((await save()).rivers.length, 3);
    record('删除整条河流与撤销重做重建水面，基础高度不被破坏');
    await page.getByRole('button', { name: '操作指南', exact: true }).click();
    const guide = page.getByRole('dialog', { name: '山河 · 操作指南', exact: true });
    assert.match(await guide.innerText(), /名称不能为空，可以重名/);
    assert.match(await guide.innerText(), /不同河流可以交叉或接入/);
    await page.keyboard.press('Escape');
    record('操作指南包含改名、交叉与整组水位撤销规则');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'river-results.json'),
      JSON.stringify({ results, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
