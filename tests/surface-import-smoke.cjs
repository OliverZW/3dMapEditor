const { _electron } = require('playwright');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const root = path.resolve('test-results/tests/texture-library-' + Date.now());
  await fs.mkdir(root, { recursive: true });
  const env = {
    ...process.env,
    MAP_EDITOR_DEV_URL: environment.url,
    MAP_EDITOR_PROFILE: path.join(root, 'profile'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors = [];
  const launch = async () => {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await app.evaluate(({ BrowserWindow, dialog }, root) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 720);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    return page;
  };
  const stop = async () => {
    if (app) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      );
      await app.close();
      app = null;
    }
  };
  try {
    let page = await launch();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('贴图工程');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    const save = async () => {
      await page.getByRole('button', { name: '保存工程', exact: true }).click();
      await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
      await page.waitForFunction(
        () => !document.querySelector('.toolbar button[title="Ctrl + S"]').disabled,
      );
      const entry = JSON.parse(
        await fs.readFile(path.join(root, '贴图工程/project.map3dproj'), 'utf8'),
      );
      return {
        map: JSON.parse(
          await fs.readFile(
            path.join(root, '贴图工程/data', entry.dataRevision, 'map.json'),
            'utf8',
          ),
        ),
        weights: await fs.readFile(
          path.join(root, '贴图工程/data', entry.dataRevision, 'terrain/surface.rgba'),
        ),
      };
    };
    const initial = await save();
    const buttons = page.locator('.surface-palette-actions').first().getByRole('button');
    const b0 = await buttons.nth(0).boundingBox(),
      b1 = await buttons.nth(1).boundingBox();
    assert.equal(b0.y, b1.y);
    assert(b0.x + b0.width <= b1.x);
    assert.equal(await page.locator('.surface-texture-slots img').count(), 2);
    await page.getByRole('button', { name: '切换颜色贴图', exact: true }).click();
    let library = page.getByRole('dialog', { name: '资源库', exact: true });
    assert.equal(
      await library
        .locator('.resource-nav')
        .getByRole('button', { name: '贴图', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(await library.getByLabel('贴图类型').inputValue(), 'color');
    assert.equal(
      await library.locator('.texture-library-grid button[aria-pressed="true"]').count(),
      1,
    );
    await library
      .locator('.texture-library-grid button')
      .filter({ hasText: '泥土 · 颜色' })
      .click();
    await library.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(
      (await save()).map.surfaceMaterial.layers[0].color.hash,
      initial.map.surfaceMaterial.layers[0].color.hash,
    );
    await page.getByRole('button', { name: '切换颜色贴图', exact: true }).click();
    await library
      .locator('.texture-library-grid button')
      .filter({ hasText: '泥土 · 颜色' })
      .click();
    await library.getByRole('button', { name: '确认使用', exact: true }).click();
    const changed = await save();
    assert.equal(
      changed.map.surfaceMaterial.layers[0].color.hash,
      initial.map.surfaceMaterial.layers[1].color.hash,
    );
    assert.equal(
      changed.map.surfaceMaterial.layers[0].normal.hash,
      initial.map.surfaceMaterial.layers[0].normal.hash,
    );
    assert.deepEqual(changed.weights, initial.weights);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(
      (await save()).map.surfaceMaterial.layers[0].color.hash,
      initial.map.surfaceMaterial.layers[0].color.hash,
    );
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await page.getByRole('button', { name: '切换法线贴图', exact: true }).click();
    assert.equal(await library.getByLabel('贴图类型').inputValue(), 'normal');
    await library
      .locator('.texture-library-grid button')
      .filter({ hasText: '岩石 · 法线' })
      .click();
    await library.getByRole('button', { name: '确认使用', exact: true }).click();
    const normal = await save();
    assert.equal(
      normal.map.surfaceMaterial.layers[0].normal.hash,
      initial.map.surfaceMaterial.layers[2].normal.hash,
    );
    assert.equal(
      normal.map.surfaceMaterial.layers[0].color.hash,
      changed.map.surfaceMaterial.layers[0].color.hash,
    );
    await page.getByRole('button', { name: '切换颜色贴图', exact: true }).click();
    const png = async (size) =>
      Buffer.from(
        await page.evaluate((size) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          const c = canvas.getContext('2d');
          c.fillStyle = '#183de2';
          c.fillRect(0, 0, size, size);
          return canvas.toDataURL().split(',')[1];
        }, size),
        'base64',
      );
    const importTexture = async (file, kind) => {
      await library.getByRole('button', { name: '导入资源', exact: true }).click();
      const importer = page.getByRole('dialog', { name: '导入资源', exact: true });
      await importer.getByLabel('资源库分类', { exact: true }).selectOption('textures');
      if (kind) await importer.getByLabel('导入贴图类型', { exact: true }).selectOption(kind);
      const pending = page.waitForEvent('filechooser');
      await importer.getByRole('button', { name: '选择文件', exact: true }).click();
      await (await pending).setFiles(file);
    };
    await importTexture({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from([1, 2, 3]),
    });
    const failure = page.getByRole('dialog', { name: '资源导入失败' });
    await failure.getByRole('alert').filter({ hasText: '无法解码' }).waitFor();
    await failure.getByRole('button', { name: '知道了' }).click();
    await importTexture({ name: '小贴图.png', mimeType: 'image/png', buffer: await png(32) });
    await library
      .locator('.texture-library-detail')
      .getByText('小贴图.png', { exact: true })
      .waitFor();
    assert.equal(
      await library.getByRole('button', { name: '确认使用', exact: true }).isDisabled(),
      true,
    );
    await library.getByRole('alert').filter({ hasText: '尺寸' }).waitFor();
    await library.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '切换颜色贴图', exact: true }).click();
    await importTexture({ name: '蓝色贴图.png', mimeType: 'image/png', buffer: await png(1024) });
    await library
      .locator('.texture-library-detail')
      .getByText('蓝色贴图.png', { exact: true })
      .waitFor();
    await library.getByRole('button', { name: '确认使用', exact: true }).click();
    const custom = await save();
    assert.equal(custom.map.surfaceMaterial.textures.length, 2);
    assert.equal(
      custom.map.surfaceMaterial.layers[0].normal.hash,
      normal.map.surfaceMaterial.layers[0].normal.hash,
    );
    assert.deepEqual(custom.weights, initial.weights);
    await page.screenshot({ path: path.join(root, 'surface-slots.png') });
    await page.getByRole('button', { name: /^资源库/ }).click();
    await library
      .locator('.resource-nav')
      .getByRole('button', { name: '贴图', exact: true })
      .click();
    assert.equal(await library.getByRole('tablist').count(), 0);
    const categories = library.locator('.resource-nav > button');
    assert.deepEqual(await categories.locator('span').allTextContents(), [
      '据点2',
      '树木5',
      '草丛1',
      '贴图',
      '导入资源',
    ]);
    const grassBox = await categories.nth(2).boundingBox();
    const textureBox = await categories.nth(3).boundingBox();
    assert.equal(grassBox.x, textureBox.x);
    assert(textureBox.y > grassBox.y);
    const typeFilter = library.getByLabel('贴图类型');
    assert.equal(await typeFilter.inputValue(), 'all');
    assert.deepEqual(await typeFilter.locator('option').allTextContents(), [
      '全部',
      '颜色贴图',
      '法线贴图',
    ]);
    const cards = library.locator('.texture-library-grid button');
    const allCount = await cards.count();
    await typeFilter.selectOption('color');
    const colorCount = await cards.count();
    assert(colorCount > 0);
    for (const text of await cards.locator('small').allTextContents())
      assert(text.includes('颜色贴图'));
    await typeFilter.selectOption('normal');
    const normalCount = await cards.count();
    assert(normalCount > 0);
    for (const text of await cards.locator('small').allTextContents())
      assert(text.includes('法线贴图'));
    assert.equal(allCount, colorCount + normalCount);
    await library.getByLabel('搜索贴图').fill('岩石');
    for (const text of await cards.locator('strong').allTextContents())
      assert(text.includes('岩石'));
    assert((await cards.count()) > 0);
    await library.getByLabel('搜索贴图').fill('不存在的贴图');
    assert.equal(await cards.count(), 0);
    await library.getByText('没有匹配的贴图', { exact: true }).waitFor();
    await library.getByLabel('搜索贴图').fill('');
    await typeFilter.selectOption('all');
    await library.locator('.resource-nav').getByRole('button', { name: /树木/ }).click();
    assert((await library.locator('.resource-grid .resource-card').count()) > 0);
    await library
      .locator('.resource-nav')
      .getByRole('button', { name: '贴图', exact: true })
      .click();
    assert.equal(await library.getByLabel('贴图类型').inputValue(), 'all');
    await library
      .locator('.texture-library-grid button')
      .filter({ hasText: '草地 · 颜色' })
      .click();
    await page.screenshot({ path: path.join(root, 'texture-categories.png') });
    await importTexture(
      {
        name: '同内容法线.png',
        mimeType: 'image/png',
        buffer: await png(1024),
      },
      'normal',
    );
    const details = library.locator('.texture-library-detail');
    await details.getByText('同内容法线.png', { exact: true }).waitFor();
    await details.getByText('贴图 / 法线贴图', { exact: true }).waitFor();
    assert.equal(
      await library.locator('.texture-library-grid button[aria-pressed="true"]').count(),
      1,
    );
    await library.getByRole('button', { name: '删除贴图', exact: true }).click();
    assert.equal(await library.getByRole('button', { name: '确认使用', exact: true }).count(), 0);
    await typeFilter.selectOption('all');
    await library
      .locator('.texture-library-grid button')
      .filter({ hasText: '蓝色贴图.png' })
      .click();
    assert.equal(
      await library.getByRole('button', { name: '删除贴图', exact: true }).isDisabled(),
      true,
    );
    await page.screenshot({ path: path.join(root, 'texture-library.png') });
    await library.locator('.texture-library-grid button').filter({ hasText: '小贴图.png' }).click();
    await library.getByRole('button', { name: '删除贴图', exact: true }).click();
    assert.equal(
      await library
        .locator('.texture-library-grid button')
        .filter({ hasText: '小贴图.png' })
        .count(),
      0,
    );
    await library.getByRole('button', { name: '关闭', exact: true }).last().click();
    await save();
    await stop();
    page = await launch();
    await page.locator('.home-project').first().click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    await page.getByRole('button', { name: '切换颜色贴图', exact: true }).click();
    library = page.getByRole('dialog', { name: '资源库', exact: true });
    await library
      .locator('.texture-library-grid button')
      .filter({ hasText: '蓝色贴图.png' })
      .waitFor();
    assert.equal(
      await library
        .locator('.texture-library-grid button[aria-pressed="true"]')
        .filter({ hasText: '蓝色贴图.png' })
        .count(),
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      '单行按钮、贴图分类、预览取消、单张替换、尺寸保护、导入、引用保护与保存重开通过：' + root,
    );
  } finally {
    await stop();
    await environment.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
