const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const base = path.resolve('test-results', 'model-import-' + randomUUID());
  await fs.mkdir(base, { recursive: true });
  const variables = {
    ...process.env,
    MAP_EDITOR_DEV_URL: environment.url,
    MAP_EDITOR_PROFILE: path.join(base, 'profile'),
  };
  delete variables.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env: variables,
      timeout: 60000,
    });
    const page = await application.firstWindow();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await application.evaluate(({ dialog }, parent) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] });
    }, base);
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('模型测试');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('button', { name: /资源库/ }).click();
    const library = page.getByRole('dialog', { name: '模型资源库' });
    const importer = page.getByRole('dialog', { name: '导入模型' });
    const choose = async (file) => {
      const pending = page.waitForEvent('filechooser');
      await library.getByRole('button', { name: '导入静态 GLB' }).click();
      await (await pending).setFiles(file);
    };
    const source = path.resolve('editor-assets/models/pine-tree.glb');
    await choose({
      name: 'invalid.glb',
      mimeType: 'model/gltf-binary',
      buffer: Buffer.from('invalid'),
    });
    await page.locator('.status-message').filter({ hasText: 'GLB' }).waitFor();
    assert.equal(await importer.count(), 0);
    const failure = page.getByRole('dialog', { name: '模型导入失败' });
    await failure.getByRole('alert').filter({ hasText: 'GLB' }).waitFor();
    await failure.getByRole('button', { name: '知道了' }).click();
    await choose(source);
    await importer.waitFor();
    await importer.getByLabel('模型名称').fill('取消的资源');
    await importer.getByRole('button', { name: '取消', exact: true }).click();
    await importer.waitFor({ state: 'hidden' });
    assert.equal(await page.getByText('取消的资源').count(), 0);
    for (const [kind, name] of [
      ['tree', '自定义树木'],
      ['grass', '自定义草丛'],
      ['city', '自定义城池'],
      ['fortress', '自定义要塞'],
    ]) {
      await choose(source);
      await importer.waitFor();
      await importer.getByLabel('模型名称').fill(name);
      await importer.getByLabel('模型分类').selectOption(kind);
      await importer.getByLabel('基础缩放').fill('2');
      await importer.getByLabel('朝向修正 (°)').fill('45');
      await importer.getByLabel('贴地偏移 (m)').fill('-1.5');
      if (kind === 'tree') {
        await importer.getByLabel('基础缩放').fill('0');
        await importer.getByRole('button', { name: '确认导入' }).click();
        await importer.getByRole('alert').filter({ hasText: '基础缩放' }).waitFor();
        await importer.getByLabel('基础缩放').fill('2');
      }
      await importer.getByRole('button', { name: '确认导入' }).click();
      await importer.waitFor({ state: 'hidden' });
      await library.getByRole('heading', { name, exact: true }).waitFor();
    }
    await library.getByTitle('关闭').click();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
    const root = path.join(base, '模型测试');
    const entry = JSON.parse(await fs.readFile(path.join(root, 'project.map3dproj'), 'utf8'));
    const map = JSON.parse(
      await fs.readFile(path.join(root, 'data', entry.dataRevision, 'map.json'), 'utf8'),
    );
    const imported = map.assets.filter((asset) => asset.id.startsWith('asset-'));
    assert.equal(imported.length, 4);
    for (const asset of imported) {
      assert.equal(asset.scale, 2);
      assert.equal(asset.offset, -1.5);
      assert(Math.abs(asset.yaw - Math.PI / 4) < 1e-10);
      assert.equal(asset.resource.origin, 'project');
    }
    assert.equal((await fs.readdir(path.join(root, 'assets', 'models'))).length, 1);
    await page.getByRole('button', { name: '返回首页' }).click();
    await page
      .getByRole('button', { name: /模型测试/ })
      .first()
      .click();
    await page.getByRole('button', { name: /资源库/ }).click();
    for (const [label, name] of [
      ['树木', '自定义树木'],
      ['草丛', '自定义草丛'],
      ['城池', '自定义城池'],
      ['要塞', '自定义要塞'],
    ]) {
      await library
        .locator('.resource-nav')
        .getByRole('button', { name: new RegExp('^' + label) })
        .click();
      await library.getByRole('button', { name: new RegExp(name) }).click();
      await library.getByRole('heading', { name, exact: true }).waitFor();
      await library.getByRole('button', { name: '用于当前工具' }).click();
      if (label === '树木' || label === '草丛') {
        assert.equal(await page.locator('.current-model strong').innerText(), name);
      } else {
        assert.equal(await page.locator('.tool-rail button.selected').innerText(), '据点');
        assert.equal(
          await page
            .getByLabel(label + '模型')
            .locator('option:checked')
            .innerText(),
          name,
        );
        await page.keyboard.press('Escape');
      }
      await page.getByRole('button', { name: /资源库/ }).click();
    }
    await library.getByTitle('关闭').click();
    await page.locator('.tool-rail button').filter({ hasText: '树木' }).click();
    const paletteChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入树木模型', exact: true }).click();
    await (await paletteChooser).setFiles(source);
    await importer.getByLabel('模型名称').fill('跨类草丛');
    await importer.getByLabel('模型分类').selectOption('grass');
    await importer.getByRole('button', { name: '确认导入' }).click();
    await importer.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.tool-rail button.selected').innerText(), '草丛');
    assert.equal(await page.locator('.current-model strong').innerText(), '跨类草丛');
    assert.deepEqual(errors, []);
    console.log('无效 GLB、取消、四类预览确认、参数校验、撤销重做、同哈希去重及目录工程重开通过');
  } finally {
    if (application) {
      await application
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
        )
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await environment.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
