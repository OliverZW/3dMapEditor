const { launch } = require('./surface-fixture.cjs');
const { unzipSync, strFromU8 } = require('fflate');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      acceptDownloads: true,
    });
    page.setDefaultTimeout(90000);
    const url = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
    const artifacts = path.resolve('test-results');
    const projectPath = path.join(artifacts, 'builtin-fixture.map3d');
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.route(url, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
    );
    await page.goto(url);
    await page.unroute(url);
    const pendingProject = page.waitForEvent('download');
    await page.evaluate(async () => {
      const [
        { initializeBuiltinResources, prepareModelDocument },
        { createDocument },
        { worldHex, hexIndex },
        { encodeProject },
      ] = await Promise.all([
        import('/src/io/builtin-resources.ts'),
        import('/src/core/document.ts'),
        import('/src/core/hex.ts'),
        import('/src/io/project.ts'),
      ]);
      await initializeBuiltinResources();
      const doc = prepareModelDocument(createDocument(513, 256, 256));
      doc.name = '内置资源固定功能测试（程序构造）';
      for (const [index, asset] of doc.assets
        .filter((a) => ['city', 'fortress'].includes(a.kind))
        .entries()) {
        const id = doc.nextId++,
          center = worldHex(doc.grid, { x: index ? 65 : -65, z: 0 });
        doc.sites.push({
          id,
          kind: asset.kind,
          name: asset.name,
          assetId: asset.id,
          center,
          yaw: 0.3,
          scale: 1,
          factionId: null,
        });
        doc.owners[hexIndex(doc.grid, center)] = id;
      }
      for (const [index, asset] of doc.assets.filter((a) => a.kind === 'tree').entries())
        doc.trees.push({
          id: doc.nextId++,
          assetId: asset.id,
          x: -80 + index * 40,
          z: 65,
          yaw: index * 0.2,
          scale: 1,
        });
      const density = new Float32Array(513 ** 2);
      density.fill(0.1, 513 * 300, 513 * 310);
      doc.grass.push({
        id: doc.nextId++,
        assetId: 'grass-reed',
        density,
        seed: 2026,
        version: 1,
        minScale: 0.8,
        maxScale: 1.2,
        maxSlope: 30,
        wind: 1,
      });
      window.builtinDoc = doc;
      const save = (bytes, name) => {
        const url = URL.createObjectURL(new Blob([bytes]));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      window.downloadBytes = save;
      save(encodeProject(doc), 'builtin-fixture.map3d');
    });
    await (await pendingProject).saveAs(projectPath);
    const pendingExport = page.waitForEvent('download');
    // 导出预检失败时先报告真实错误，避免悬空下载等待掩盖失败原因。
    void pendingExport.catch(() => {});
    await page.evaluate(async () => {
      const { exportCocos } = await import('/src/io/cocos-export.ts');
      const result = await exportCocos(window.builtinDoc, {
        trees: true,
        grass: true,
        sites: true,
        water: true,
        logic: true,
      });
      window.downloadBytes(result.bytes, 'builtin-cocos.zip');
    });
    const exportPath = path.join(artifacts, 'builtin-cocos.zip');
    await (await pendingExport).saveAs(exportPath);
    const files = unzipSync(fs.readFileSync(exportPath));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    const assets = JSON.parse(strFromU8(files[manifest.entries.models]));
    assert.equal(assets.filter((asset) => asset.included).length, 8);
    for (const asset of assets) assert(files[asset.path]?.length > 100);
    console.log('固定功能场景：八个实际模型完整保存并导出 Cocos，引用无缺失。');

    await page.goto(url);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '打开', exact: true }).click();
    await (await chooser).setFiles(projectPath);
    await page.getByRole('button', { name: /资源库 8/ }).click();
    const modal = page.getByRole('dialog', { name: '模型资源库', exact: true });
    for (const kind of ['城池', '要塞', '树木', '草丛']) {
      await modal
        .locator('.resource-nav')
        .getByRole('button', { name: new RegExp('^' + kind) })
        .click();
      const cards = modal.locator('.resource-card');
      for (let index = 0; index < (await cards.count()); index++) {
        await cards.nth(index).click();
        const name = await cards.nth(index).locator('strong').innerText();
        await modal.locator('.model-details h3').filter({ hasText: name }).waitFor();
        await page.waitForTimeout(500);
        assert.equal(await modal.locator('.model-preview[data-error]').count(), 0);
        // v4 备份内的模型恢复为工程自有；被引用时仍由引用保护阻止删除。
        assert.equal(await modal.getByRole('button', { name: '删除资源', exact: true }).count(), 1);
        assert.equal(await modal.getByText(/使用位置（/).count(), 1);
      }
    }
    await page.screenshot({ path: path.join(artifacts, 'builtin-library.png') });
    await modal.getByRole('button', { name: '关闭', exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, 'builtin-fixture-view.png') });
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    const savedFiles = unzipSync(fs.readFileSync(await (await saved).path()));
    const original = unzipSync(fs.readFileSync(projectPath));
    assert.deepEqual(savedFiles['objects.json'], original['objects.json']);
    assert.deepEqual(errors, []);
    console.log(
      '固定功能场景：界面重开、八个工程自有模型详情预览、引用保护和再次保存通过，页面错误0。',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
