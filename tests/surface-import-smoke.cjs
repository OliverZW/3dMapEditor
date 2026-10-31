const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const { startDesktopEnvironment } = await import('../dev-tools/start-desktop.mjs');
  const environment = await startDesktopEnvironment();
  const base = path.resolve('test-results', 'surface-import-' + randomUUID());
  await fs.mkdir(base, { recursive: true });
  const env = {
    ...process.env,
    MAP_EDITOR_DEV_URL: environment.url,
    MAP_EDITOR_PROFILE: path.join(base, 'profile'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await _electron.launch({
      executablePath: require('electron'),
      args: [environment.runtime],
      env,
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
    await page.getByLabel('工程名称').fill('地表测试');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    const open = () => page.getByRole('button', { name: '选择或导入材质' }).click();
    const modal = page.getByRole('dialog', { name: '地表材质' });
    const color = path.resolve('editor-assets/surface/grass-color.png');
    const normal = path.resolve('editor-assets/surface/grass-normal.png');
    const small = path.resolve('editor-assets/surface/grass-thumb.png');
    const makeImage = async (width, height, mimeType) => {
      const data = await page.evaluate(
        ({ width, height, mimeType }) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.fillStyle = '#567843';
          context.fillRect(0, 0, width, height);
          return canvas.toDataURL(mimeType).split(',')[1];
        },
        { width, height, mimeType },
      );
      return Buffer.from(data, 'base64');
    };
    await open();
    await modal.getByLabel('材质名称').fill('测试地面');
    await modal
      .getByLabel('颜色贴图', { exact: true })
      .setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
    await modal.getByRole('button', { name: '预览导入' }).click();
    await modal.getByRole('alert').filter({ hasText: '无法解码' }).waitFor();
    await modal.getByLabel('颜色贴图', { exact: true }).setInputFiles({
      name: 'large.png',
      mimeType: 'image/png',
      buffer: await makeImage(4097, 2, 'image/png'),
    });
    await modal.getByRole('button', { name: '预览导入' }).click();
    await modal.getByRole('alert').filter({ hasText: '4096' }).waitFor();
    await modal.getByLabel('颜色贴图', { exact: true }).setInputFiles(color);
    await modal.getByLabel('法线贴图').setInputFiles(small);
    await modal.getByRole('button', { name: '预览导入' }).click();
    await modal.getByRole('alert').filter({ hasText: '尺寸必须一致' }).waitFor();
    await modal.getByLabel('法线贴图').setInputFiles([]);
    await modal.getByRole('button', { name: '预览导入' }).click();
    await modal.getByText(/新导入：测试地面/).waitFor({ state: 'attached' });
    await page.screenshot({ path: path.join(base, 'surface-preview.png') });
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await open();
    assert.equal(await modal.getByRole('option', { name: /测试地面/ }).count(), 0);
    await modal.getByLabel('材质名称').fill('测试地面');
    await modal.getByLabel('平铺尺度（米）').fill('21');
    await modal.getByLabel('颜色贴图', { exact: true }).setInputFiles(color);
    await modal.getByRole('button', { name: '预览导入' }).click();
    await modal.getByText(/新导入：测试地面/).waitFor({ state: 'attached' });
    await modal.getByRole('button', { name: '确认使用' }).click();
    await open();
    await modal.getByRole('button', { name: '删除材质' }).click();
    await modal.getByRole('alert').filter({ hasText: '草地' }).waitFor();
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    for (const name of ['泥土', '岩石', '沙地']) {
      await page.locator('.surface-grid button').filter({ hasText: name }).click();
      await open();
      await modal.getByLabel('选择地表材质').selectOption({ label: '测试地面（工程）' });
      await modal.getByRole('button', { name: '确认使用' }).click();
    }
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await open();
    await modal.getByLabel('材质名称').fill('颜色法线');
    await modal.getByLabel('颜色贴图', { exact: true }).setInputFiles({
      name: 'color.jpg',
      mimeType: 'image/jpeg',
      buffer: await makeImage(1024, 1024, 'image/jpeg'),
    });
    await modal.getByLabel('法线贴图').setInputFiles(normal);
    await modal.getByRole('button', { name: '预览导入' }).click();
    await modal.getByText(/新导入：颜色法线/).waitFor({ state: 'attached' });
    await modal.getByRole('button', { name: '确认使用' }).click();
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
    const root = path.join(base, '地表测试');
    const entry = JSON.parse(await fs.readFile(path.join(root, 'project.map3dproj'), 'utf8'));
    const map = JSON.parse(
      await fs.readFile(path.join(root, 'data', entry.dataRevision, 'map.json'), 'utf8'),
    );
    assert.equal(map.surfaceMaterial.library.length, 2);
    assert.equal(map.surfaceMaterial.layers[0].meters, 21);
    assert.equal(map.surfaceMaterial.layers[3].name, '颜色法线');
    const firstNormal = await fs.readFile(
      path.join(root, map.surfaceMaterial.library[0].normal.resource.path),
    );
    const normalPixel = await page.evaluate(async (encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...context.getImageData(0, 0, 1, 1).data];
    }, firstNormal.toString('base64'));
    assert.deepEqual(normalPixel, [128, 128, 255, 255]);
    const jpgConverted = await fs.readFile(
      path.join(root, map.surfaceMaterial.library[1].color.resource.path),
    );
    assert.deepEqual([...jpgConverted.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const weights = await fs.readFile(
      path.join(root, 'data', entry.dataRevision, 'terrain', 'surface.rgba'),
    );
    assert.equal(weights[0], 255);
    await page.getByRole('button', { name: '返回首页' }).click();
    await page
      .getByRole('button', { name: /地表测试/ })
      .first()
      .click();
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    await open();
    assert.equal(await modal.getByRole('option', { name: /测试地面/ }).count(), 1);
    assert.equal(await modal.getByRole('option', { name: /颜色法线/ }).count(), 1);
    assert.deepEqual(errors, []);
    console.log('地表导入、取消、尺寸拒绝、四层选择、撤销重做、保存重开和引用保护通过');
    console.log(`界面截图：${path.join(base, 'surface-preview.png')}`);
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
