require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { chromium } = require('playwright');
const { unzipSync, strFromU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const artifacts = path.resolve(__dirname, '../test-results/tests');
const edge = path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || edge,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1.5,
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [],
    results = [];
  const record = (message) => {
    results.push(message);
    console.log(message);
  };
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.setDefaultTimeout(25000);
  async function save() {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const bytes = fs.readFileSync(await (await pending).path()),
      files = unzipSync(bytes);
    return {
      bytes,
      files,
      objects: JSON.parse(strFromU8(files['objects.json'])),
      manifest: JSON.parse(strFromU8(files['map.json'])),
    };
  }
  try {
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('group', { name: '场景方向坐标系', exact: true }).waitFor();
    await page.waitForTimeout(1200);
    const original = await save();
    assert.equal(await page.locator('.tool-rail button').filter({ hasText: '选择' }).count(), 0);
    assert.equal(
      await page.getByRole('toolbar', { name: '视口显示' }).getByRole('button').count(),
      9,
    );
    const canvasBox = await page.getByTestId('map-canvas').boundingBox(),
      toolbar = await page.getByRole('toolbar', { name: '视口显示' }).boundingBox(),
      gizmo = await page.locator('.orientation-gizmo').boundingBox();
    assert(toolbar.x < canvasBox.x + 30);
    assert(gizmo.x > canvasBox.x + canvasBox.width - 155);
    assert.equal(await page.locator('.viewport-pill,.axis-gizmo').count(), 0);
    await page.screenshot({ path: artifacts + '/navigation-layout.png' });
    record('九个显示图标在左上角，交互坐标系在右上角，旧标签和独立选择入口已移除');
    const city = original.objects.sites[0];
    await page.locator('.left-panel .object-row').filter({ hasText: city.name }).click();
    await page.getByLabel('据点名称', { exact: true }).waitFor();
    await page.locator('.tool-rail button').filter({ hasText: '树木' }).click();
    assert.equal(await page.getByLabel('据点名称', { exact: true }).count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: '选中据点范围', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.locator('.tool-rail button').filter({ hasText: '据点' }).click();
    assert.equal(await page.getByLabel('据点名称', { exact: true }).count(), 0);
    await page.locator('.tool-rail button').filter({ hasText: '树木' }).click();
    assert.equal(
      await page.locator('.left-panel').getByRole('button', { name: '刷入', exact: true }).count(),
      0,
    );
    assert(
      await page
        .locator('.inspector')
        .getByRole('button', { name: '刷入', exact: true })
        .isVisible(),
    );
    assert(
      await page
        .locator('.inspector')
        .getByRole('button', { name: '擦除', exact: true })
        .isVisible(),
    );
    assert(
      await page
        .locator('.inspector')
        .getByRole('button', { name: '选择实例', exact: true })
        .isVisible(),
    );
    await page.getByRole('button', { name: '擦除', exact: true }).click();
    await page
      .getByRole('listbox', { name: '树木模型列表', exact: true })
      .getByRole('option')
      .filter({ hasText: '阔叶树' })
      .click();
    assert(
      await page
        .getByRole('button', { name: '擦除', exact: true })
        .evaluate((node) => node.classList.contains('active')),
    );
    await page.getByRole('button', { name: '详情', exact: true }).click();
    const details = page.getByRole('dialog', { name: '模型详情', exact: true });
    await details.getByRole('heading', { name: '山地阔叶树', exact: true }).waitFor();
    await details.locator('.model-preview canvas').waitFor();
    assert.equal(await details.locator('.resource-grid,.resource-nav,[role="listbox"]').count(), 0);
    assert.equal(
      await details.getByRole('button', { name: '用于当前工具', exact: true }).count(),
      0,
    );
    const projection = await page.locator('.orientation-gizmo svg').getAttribute('data-projection');
    await page.getByLabel('基础缩放', { exact: true }).focus();
    await page.keyboard.press('v');
    await page.keyboard.press('Home');
    assert.equal(
      await page.locator('.orientation-gizmo svg').getAttribute('data-projection'),
      projection,
    );
    await page.screenshot({ path: artifacts + '/vegetation-details.png' });
    await page.keyboard.press('Escape');
    await page.locator('.tool-rail button').filter({ hasText: '草丛' }).click();
    assert.equal(await page.getByRole('button', { name: '选择实例', exact: true }).count(), 0);
    await page.getByRole('button', { name: '擦除', exact: true }).click();
    await page.getByRole('option').first().click();
    assert(
      await page
        .getByRole('button', { name: '擦除', exact: true })
        .evaluate((node) => node.classList.contains('active')),
    );
    await page.screenshot({ path: artifacts + '/vegetation-grass.png' });
    await page.locator('.tool-rail button').filter({ hasText: '树木' }).click();
    assert.equal(await page.locator('.current-model strong').innerText(), '山地阔叶树');
    record('树草模型单击即选中、各自记忆选择；刷入擦除在右侧，详情只展示当前模型且隔离快捷键');
    const fixture = path.join(artifacts, 'custom-pine.glb');
    assert(fs.existsSync(fixture), '需要已有 GLB 测试样本');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入树木模型', exact: true }).click();
    await (await chooser).setFiles(fixture);
    await page
      .getByRole('dialog', { name: '导入模型' })
      .getByRole('button', { name: '确认导入' })
      .click();
    await page.getByRole('option').filter({ hasText: 'custom-pine' }).waitFor();
    assert.equal(await page.locator('.current-model strong').innerText(), 'custom-pine');
    assert.equal(await page.getByRole('dialog').count(), 0);
    let after = await save();
    const custom = after.manifest.assets.find((asset) => asset.name === 'custom-pine');
    assert(custom && custom.kind === 'tree');
    assert.deepEqual(Buffer.from(after.files[custom.resource.path]), fs.readFileSync(fixture));
    record('在树木工具内导入 GLB，自动选中并保存原始资源，不打开资源库');
    const axes = [
      ['右视图 +X', '+x'],
      ['俯视图 +Y', '+y'],
      ['前视图 +Z', '+z'],
    ];
    const initialProjection = await page
      .locator('.orientation-gizmo svg')
      .getAttribute('data-projection');
    for (const [name, value] of axes) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(300);
      assert.equal(
        await page.locator('.orientation-gizmo svg').getAttribute('data-orientation'),
        value,
      );
      assert.equal(
        await page.locator('.orientation-gizmo svg').getAttribute('data-projection'),
        initialProjection,
      );
    }
    await page.getByRole('button', { name: '切换坐标系投影', exact: true }).click();
    assert.equal(
      await page.locator('.orientation-gizmo svg').getAttribute('data-projection'),
      'orthographic',
    );
    await page
      .getByRole('button', { name: '切换坐标系投影', exact: true })
      .click({ modifiers: ['Shift'] });
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator('.orientation-gizmo svg').getAttribute('data-projection'),
      'perspective',
    );
    assert.equal(
      await page.locator('.orientation-gizmo svg').getAttribute('data-orientation'),
      'free',
    );
    record('坐标系三个正方向和中央投影可点击，Shift 恢复透视，投影按钮状态同步');
    await page.locator('.tool-rail button').filter({ hasText: '地形' }).click();
    const beforeNav = await save();
    let box = await page.getByTestId('map-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width * 0.5 + 45, box.y + box.height * 0.5 + 10, {
      steps: 4,
    });
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(500);
    assert((await page.getByLabel('地图操作提示').innerText()).includes('QE'));
    await page.keyboard.up('w');
    await page.keyboard.up('Shift');
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(150);
    assert(!(await page.getByLabel('地图操作提示').innerText()).includes('QE'));
    after = await save();
    assert.deepEqual(after.files['terrain/base.f32'], beforeNav.files['terrain/base.f32']);
    assert.deepEqual(after.files['logic/owners.u32'], beforeNav.files['logic/owners.u32']);
    assert.deepEqual(after.objects, beforeNav.objects);
    await page.keyboard.press('Home');
    await page.keyboard.press('g');
    await page.screenshot({ path: artifacts + '/navigation-controls.png' });
    record('右键 WASD、Shift 和滚轮调速不误刷地形，释放后退出导航，Home 和 G 生效');
    const treeFixture = await page.evaluate(async () => {
      const { createDocument } = await import('/src/core/document.ts');
      const { encodeProject } = await import('/src/io/project.ts');
      const doc = createDocument();
      const tree = { id: doc.nextId++, assetId: 'tree-pine', x: 0, z: 0, yaw: 0, scale: 3 };
      doc.trees.push(tree);
      return { bytes: Array.from(encodeProject(doc)), tree };
    });
    const treeFile = path.join(artifacts, 'tree-selection.map3d');
    fs.writeFileSync(treeFile, Buffer.from(treeFixture.bytes));
    const treeOpen = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await treeOpen).setFiles(treeFile);
    await page.locator('.tool-rail button').filter({ hasText: '树木' }).click();
    await page.getByRole('button', { name: '选择实例', exact: true }).click();
    await page.getByRole('button', { name: '俯视图 +Y', exact: true }).click();
    await page.waitForTimeout(800);
    box = await page.getByTestId('map-canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByText('树木实例 · ' + treeFixture.tree.id, { exact: true }).waitFor();
    await page
      .getByRole('listbox', { name: '树木模型列表', exact: true })
      .getByRole('option')
      .filter({ hasText: '阔叶树' })
      .click();
    await page.getByText('树木实例 · ' + treeFixture.tree.id, { exact: true }).waitFor();
    const selectedTreeDoc = await save();
    assert.deepEqual(selectedTreeDoc.objects.trees, [treeFixture.tree]);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    assert.equal(await page.getByRole('button', { name: '删除该实例', exact: true }).count(), 0);
    record('树木选择模式命中实例，选择其他笔刷模型不替换实例，空白处清除选择且不刷入');
    // Metadata-only fixture measures the resource UI, not GPU capacity for thousands of decoded GLBs.
    const largeBytes = await page.evaluate(
      async (smallModel) => {
        const { createDocument } = await import('/src/core/document.ts');
        const { encodeProject } = await import('/src/io/project.ts');
        const doc = createDocument();
        // 元数据压力测试共享小型自包含 GLB，避免把高精度原树复制成数万份解码输入。
        doc.assets = doc.assets.filter((asset) => asset.kind === 'tree').slice(0, 2);
        const bytes = Uint8Array.from(smallModel);
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (value) => value.toString(16).padStart(2, '0'),
        ).join('');
        for (const asset of doc.assets) {
          asset.bytes = bytes;
          asset.hash = hash;
        }
        const sample = doc.assets[0];
        for (let index = 0; index < 10000; index++)
          doc.assets.push({
            ...sample,
            id: 'virtual-tree-' + index,
            name: '样本树木 ' + String(index).padStart(5, '0'),
          });
        return Array.from(encodeProject(doc));
      },
      Array.from(fs.readFileSync(fixture)),
    );
    const largeFile = path.join(artifacts, 'virtual-resources.map3d');
    fs.writeFileSync(largeFile, Buffer.from(largeBytes));
    const open = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await open).setFiles(largeFile);
    await page.locator('.tool-rail button').filter({ hasText: '树木' }).click();
    const list = page.getByRole('listbox', { name: '树木模型列表', exact: true });
    await list.waitFor();
    assert((await page.locator('.vegetation-palette .list-heading').innerText()).includes('10002'));
    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const last = page.getByRole('option').filter({ hasText: '样本树木 09999' });
    await last.waitFor();
    await last.click();
    const count = await page.getByRole('option').count(),
      height = await list.evaluate((node) => node.clientHeight);
    assert(count <= Math.ceil(height / 64) + 8);
    await page.waitForTimeout(1200);
    assert((await list.evaluate((node) => node.scrollTop)) > 600000);
    assert.equal(await page.locator('.model-preview canvas').count(), 0);
    await page.getByLabel('搜索模型', { exact: true }).fill('样本树木 01234');
    await page.getByRole('option').filter({ hasText: '样本树木 01234' }).waitFor();
    assert.equal(await page.getByRole('option').count(), 1);
    await page.getByRole('option').click();
    await page.getByRole('button', { name: '详情', exact: true }).click();
    await page.getByRole('heading', { name: '样本树木 01234', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('搜索模型', { exact: true }).fill('');
    await page.screenshot({ path: artifacts + '/vegetation-virtual-list.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: artifacts + '/navigation-1280.png' });
    record('一万条模型元数据虚拟滚动、搜索和详情正确，DOM 数量有界，列表刷新不跳回');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, 'navigation-resources-report.json'),
      JSON.stringify({ results, errors, virtualRows: count }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
