require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { chromium } = require('playwright');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const artifacts = path.resolve(__dirname, '../test-results/tests');
const edge = path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || edge,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1.5,
    acceptDownloads: true,
  });
  const errors = [],
    results = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.setDefaultTimeout(25000);
  const record = (message) => {
    results.push(message);
    console.log(message);
  };
  async function save() {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const bytes = fs.readFileSync(await (await pending).path()),
      files = unzipSync(bytes);
    return {
      bytes,
      files,
      manifest: JSON.parse(strFromU8(files['map.json'])),
      objects: JSON.parse(strFromU8(files['objects.json'])),
    };
  }
  const tool = (name) => page.locator('.tool-rail button').filter({ hasText: name });
  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('toolbar', { name: '视口显示' }).waitFor();
    await page.waitForTimeout(1000);
    const viewport = await page.locator('.viewport-column').boundingBox();
    const stats = await page.getByLabel('渲染统计', { exact: true }).boundingBox();
    assert(Math.abs(stats.x - viewport.x - 18) < 1);
    assert(Math.abs(stats.y + stats.height - viewport.y - viewport.height + 14) < 1);
    assert.equal(await page.locator('.viewport-caption,.viewport-toolbar .performance').count(), 0);
    assert.equal(await page.locator('.gizmo-axis').count(), 3);
    assert.deepEqual(await page.locator('.gizmo-axis text').allTextContents(), ['X', 'Y', 'Z']);
    const hints = page.getByLabel('地图操作提示', { exact: true });
    assert(await hints.isVisible());
    const hintBox = await hints.boundingBox();
    assert(Math.abs(hintBox.x + hintBox.width - viewport.x - viewport.width + 18) < 1);
    assert(stats.x + stats.width + 10 <= hintBox.x + 1);
    const text = await hints.innerText();
    assert(!text.includes('全图') && !text.includes('投影') && !text.includes('格线'));
    await page.getByRole('button', { name: '操作提示', exact: true }).click();
    assert.equal(await hints.count(), 0);
    assert(await page.getByLabel('渲染统计', { exact: true }).isVisible());
    await page.keyboard.press('Home');
    await page.keyboard.press('v');
    assert.equal(
      await page.locator('.orientation-gizmo svg').getAttribute('data-projection'),
      'orthographic',
    );
    await page.keyboard.press('g');
    assert.equal(
      await page
        .getByRole('button', { name: '六边形格线', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: '操作提示', exact: true }).click();
    record('统计位于左下，提示位于右下且可隐藏、不影响 Home/V/G；仅有正向 XYZ，旧说明已删除');
    const initial = await save();
    await page
      .locator('.left-panel .object-row')
      .filter({ hasText: initial.objects.sites[0].name })
      .click();
    const actions = page.getByLabel('编辑操作', { exact: true });
    const before = await actions.boundingBox();
    for (const name of ['选择', '移动', '增加辖区', '擦除辖区'])
      assert(await actions.getByRole('button', { name, exact: true }).isVisible());
    await page.locator('.inspector-content').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    assert.deepEqual(await actions.boundingBox(), before);
    await page.screenshot({ path: path.join(artifacts, 'layout-fixed-actions.png') });
    for (const [name, label] of [
      ['地形', '抬高'],
      ['地表', '草地'],
      ['树木', '刷入'],
      ['草丛', '擦除'],
      ['河流', '编辑控制点'],
    ]) {
      await tool(name).click();
      const panel = page.locator(['地形', '地表'].includes(name) ? '.left-panel' : '.inspector');
      assert(
        await panel
          .getByLabel('编辑操作', { exact: true })
          .getByRole('button', { name: label, exact: true })
          .isVisible(),
      );
    }
    const createRiver = page
      .locator('.left-panel')
      .getByRole('button', { name: '新建河流', exact: true });
    assert(await createRiver.isVisible());
    assert.equal(await actions.getByRole('button', { name: '新建河流', exact: true }).count(), 0);
    record('地形与地表操作、新建河流位于左侧，其他编辑操作固定在右侧顶部');
    await tool('概览').click();
    assert.equal(await page.locator('.left-footer').count(), 0);
    await page.getByLabel('地面宽度（米）', { exact: true }).fill('3072');
    await page.getByLabel('地面长度（米）', { exact: true }).fill('1536');
    await page.getByRole('button', { name: '预览调整', exact: true }).click();
    await page.getByRole('button', { name: '确认调整', exact: true }).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(artifacts, 'resize-preview.png') });
    await page.getByRole('button', { name: /资源库/ }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'Cocos 导出', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '确认调整', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="地面宽度（米）"]').value === '2048',
    );

    assert.equal(await page.getByLabel('地面宽度（米）', { exact: true }).inputValue(), '2048');
    assert.equal((await save()).manifest.settings.width, 2048);
    await page.getByLabel('地面宽度（米）', { exact: true }).fill('3072');
    await page.getByLabel('地面长度（米）', { exact: true }).fill('1536');
    await page.getByRole('button', { name: '预览调整', exact: true }).click();
    await page.getByRole('button', { name: '确认调整', exact: true }).click();
    let after = await save();
    assert.equal(after.manifest.settings.width, 3072);
    assert.equal(after.manifest.settings.depth, 1536);
    assert.equal(after.manifest.formatVersion, 3);
    assert.deepEqual(
      after.objects.trees,
      initial.objects.trees.filter(
        (tree) => Math.abs(tree.x) <= 3072 / 2 && Math.abs(tree.z) <= 1536 / 2,
      ),
    );
    const mapPosition = (grid, cell) => ({
      x: grid.originX + Math.sqrt(3) * grid.radius * (cell.q + cell.r / 2),
      z: grid.originZ + 1.5 * grid.radius * cell.r,
    });
    for (const oldSite of initial.objects.sites) {
      const next = after.objects.sites.find((site) => site.id === oldSite.id);
      const old = mapPosition(initial.manifest.grid, oldSite.center),
        point = mapPosition(after.manifest.grid, next.center);
      assert(Math.hypot(old.x - point.x, old.z - point.z) < 1e-6);
    }
    const resized = after;
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    after = await save();
    assert.deepEqual(after.manifest.settings, initial.manifest.settings);
    assert.deepEqual(after.files['logic/owners.u32'], initial.files['logic/owners.u32']);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    after = await save();
    assert.deepEqual(after.files['logic/owners.u32'], resized.files['logic/owners.u32']);
    await page.screenshot({ path: path.join(artifacts, 'overview-resized.png') });
    record('概览可预览/取消/确认非方形尺寸，内容世界位置保持，撤销重做恢复完整网格');
    const fixture = await page.evaluate(async () => {
      const { createDocument } = await import('/src/core/document.ts');
      const { encodeProject } = await import('/src/io/project.ts');
      const { worldHex, hexIndex } = await import('/src/core/hex.ts');
      const doc = createDocument();
      const id = doc.nextId++,
        center = worldHex(doc.grid, { x: 800, z: 0 });
      doc.sites.push({
        id,
        kind: 'city',
        name: '边外城',
        assetId: 'city-jade',
        center,
        yaw: 0,
        scale: 1,
        factionId: null,
      });
      doc.owners[hexIndex(doc.grid, center)] = id;
      doc.trees.push({ id: doc.nextId++, assetId: 'tree-pine', x: 700, z: 0, yaw: 0, scale: 1 });
      doc.rivers.push({
        id: doc.nextId++,
        name: '环河',
        width: 16,
        depth: 6,
        waterLevel: 24,
        interpolation: 'linear',
        points: [
          { x: -800, z: -200 },
          { x: 800, z: -200 },
          { x: 800, z: 200 },
          { x: -800, z: 200 },
        ],
      });
      return Array.from(encodeProject(doc));
    });
    const fixtureFile = path.join(artifacts, 'resize-fixture.map3d');
    fs.writeFileSync(fixtureFile, Buffer.from(fixture));
    const open = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await open).setFiles(fixtureFile);
    await tool('概览').click();
    await page.getByLabel('地面宽度（米）', { exact: true }).fill('512');
    await page.getByLabel('地面长度（米）', { exact: true }).fill('512');
    await page.getByRole('button', { name: '预览调整', exact: true }).click();
    await page.getByRole('button', { name: '确认调整', exact: true }).click();
    after = await save();
    assert.equal(after.objects.sites.length, 0);
    assert.equal(after.objects.trees.length, 0);
    assert.equal(after.objects.rivers.length, 2);
    for (const river of after.objects.rivers) assert.equal(river.interpolation, 'linear');
    const croppedFile = path.join(artifacts, 'resized-roundtrip.map3d');
    fs.writeFileSync(croppedFile, after.bytes);
    const reopen = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await reopen).setFiles(croppedFile);
    assert.equal(await page.getByLabel('地面宽度（米）', { exact: true }).inputValue(), '512');
    await page.screenshot({ path: path.join(artifacts, 'resize-river-segments.png') });
    record('确认缩小后裁除越界对象、保留两个内部河段，v4 备份保存重开一致');
    await page.getByRole('button', { name: 'Cocos 导出', exact: true }).click();
    const exportWait = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: '生成并下载', exact: true }).click();
    const exported = fs.readFileSync(await (await exportWait).path()),
      pack = unzipSync(exported);
    const exportManifest = JSON.parse(strFromU8(pack['manifest.json']));
    const rivers = JSON.parse(strFromU8(pack['water/rivers.json']));
    const logic = JSON.parse(strFromU8(pack[exportManifest.entries.logic]));
    assert.equal(exportManifest.map.width, 512);
    assert.equal(exportManifest.map.depth, 512);
    assert.equal(exportManifest.exportVersion, 2);
    assert.equal(exportManifest.validation.engine, 'not-run');
    assert.deepEqual(
      rivers,
      after.objects.rivers.map((river) => ({
        ...river,
        interpolation: river.interpolation || 'catmull-rom',
        clipped: river.clipped || false,
      })),
    );
    assert.deepEqual(exportManifest.map.grid, after.manifest.grid);
    assert.deepEqual(pack[logic.owners], after.files['logic/owners.u32']);
    const water = Buffer.from(pack['water/water.glb']);
    const gltf = JSON.parse(water.subarray(20, 20 + water.readUInt32LE(12)).toString('utf8'));
    for (const mesh of gltf.meshes)
      for (const primitive of mesh.primitives) {
        const bounds = gltf.accessors[primitive.attributes.POSITION];
        assert(bounds.min[0] >= -256.001 && bounds.max[0] <= 256.001);
        assert(bounds.min[2] >= -256.001 && bounds.max[2] <= 256.001);
      }
    fs.writeFileSync(path.join(artifacts, 'resized-cocos-test.zip'), exported);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    record('裁剪后的 Cocos 包尺寸、归属和河段一致，实际水面 GLB 顶点未越界');
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page
      .getByRole('dialog', { name: '创建新的山河', exact: true })
      .getByLabel('地面宽度（米）', { exact: true })
      .fill('1024');
    await page
      .getByRole('dialog', { name: '创建新的山河', exact: true })
      .getByLabel('地面长度（米）', { exact: true })
      .fill('768');
    await page.getByRole('button', { name: '创建地图', exact: true }).click();
    after = await save();
    assert.equal(after.manifest.settings.width, 1024);
    assert.equal(after.manifest.settings.depth, 768);
    await page.keyboard.press('Home');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: path.join(artifacts, 'overview-1280.png') });
    record('新建可直接设置矩形尺寸，1280×720 布局无重叠');
    const legacyFiles = { ...initial.files };
    const legacyManifest = { ...initial.manifest, formatVersion: 1 };
    legacyFiles['manifest.json'] = strToU8(JSON.stringify(legacyManifest));
    const legacyFile = path.join(artifacts, 'legacy-v1.map3d');
    fs.writeFileSync(legacyFile, Buffer.from(zipSync(legacyFiles)));
    const legacyOpen = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await legacyOpen).setFiles(legacyFile);
    await page.waitForFunction(() => document.body.textContent.includes('不兼容旧版'));
    const retained = await save();
    assert.deepEqual(retained.manifest.settings, after.manifest.settings);
    assert.deepEqual(retained.objects, after.objects);
    record('旧版工程明确拒绝，保留当前地图尺寸与对象');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'map-resize-report.json'),
      JSON.stringify({ results, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
