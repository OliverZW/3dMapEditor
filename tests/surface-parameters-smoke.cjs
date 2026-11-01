const { _electron } = require('playwright'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const root = path.resolve('test-results/tests/surface-parameters-' + Date.now());
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
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await app.evaluate(({ dialog, BrowserWindow }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 720);
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
    await page.getByLabel('工程名称').fill('独立参数');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    const slider = (name) => page.getByRole('slider', { name, exact: true });
    await slider('纹理尺度').focus();
    await slider('纹理尺度').press('End');
    await slider('细节强度').focus();
    await slider('细节强度').press('End');
    assert.equal(await slider('纹理尺度').inputValue(), '400');
    assert.equal(await slider('细节强度').inputValue(), '100');
    await page.locator('.surface-grid button').filter({ hasText: '泥土' }).click();
    assert.equal(await slider('纹理尺度').inputValue(), '100');
    assert.equal(await slider('细节强度').inputValue(), '25');
    await slider('纹理尺度').focus();
    await slider('纹理尺度').press('Home');
    await slider('细节强度').focus();
    await slider('细节强度').press('Home');
    assert.equal(await slider('纹理尺度').inputValue(), '25');
    assert.equal(await slider('细节强度').inputValue(), '0');
    await page.locator('.surface-grid button').filter({ hasText: '草地' }).click();
    assert.equal(await slider('纹理尺度').inputValue(), '400');
    assert.equal(await slider('细节强度').inputValue(), '100');
    const toggle = page.getByRole('checkbox', { name: '坡度显岩', exact: true });
    const select = page.getByLabel('坡度显岩地表', { exact: true });
    await select.selectOption('soil');
    const t = await toggle.boundingBox(),
      s = await select.boundingBox();
    assert(s.y > t.y);
    await toggle.uncheck();
    assert.equal(await select.count(), 0);
    await toggle.check();
    assert.equal(await select.inputValue(), 'soil');
    for (const name of ['纹理尺度', '细节强度', '坡度显岩', '坡度显岩地表']) {
      const help = page.getByRole('button', { name: name + '说明', exact: true });
      await help.hover();
      assert((await help.getAttribute('title')).length > 8);
      await help.click();
    }
    assert.equal(await toggle.isChecked(), true);
    // 两条渲染路径均须可用。
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('显示档位', { exact: true }).selectOption('high');
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
    const entry = JSON.parse(
      await fs.readFile(path.join(root, '独立参数/project.map3dproj'), 'utf8'),
    );
    const map = JSON.parse(
      await fs.readFile(path.join(root, '独立参数/data', entry.dataRevision, 'map.json'), 'utf8'),
    );
    assert.equal(map.surfaceMaterial.layers[0].scale, 4);
    assert.equal(map.surfaceMaterial.layers[0].detail, 1);
    assert.equal(map.surfaceMaterial.layers[1].scale, 0.25);
    assert.equal(map.surfaceMaterial.layers[1].detail, 0);
    assert.equal(map.surfaceMaterial.scale, 1);
    await page.screenshot({ path: path.join(root, 'independent-parameters.png') });
    await stop();
    page = await launch();
    await page.locator('.home-project').first().click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    assert.equal(await slider('纹理尺度').inputValue(), '400');
    await page.locator('.surface-grid button').filter({ hasText: '泥土' }).click();
    assert.equal(await slider('纹理尺度').inputValue(), '25');
    assert.equal(await slider('细节强度').inputValue(), '0');
    assert.deepEqual(errors, []);
    console.log('独立参数、条件显岩选项、提示按钮、两档渲染与保存重开通过：' + root);
  } finally {
    await stop();
    await environment.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
