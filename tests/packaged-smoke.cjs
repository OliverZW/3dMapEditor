require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

(async () => {
  const executablePath = path.resolve(process.argv[2]);
  const base = path.resolve('test-results/tests', `packaged-smoke-${randomUUID()}`);
  await fs.mkdir(base, { recursive: true });
  const env = { ...process.env, MAP_EDITOR_PROFILE: path.join(base, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  let app;
  const launch = (args = []) => _electron.launch({ executablePath, args, env, timeout: 60000 });
  const stop = async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    );
    await app.close().catch(() => {});
    app = null;
  };
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.getByRole('button', { name: '创建工程', exact: true }).waitFor();
    assert.equal(new URL(page.url()).protocol, 'shanhe:');
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    await app.evaluate(({ dialog }, parent) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] });
    }, base);
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByLabel('工程名称').fill('打包测试');
    await page.getByRole('button', { name: '选择父目录' }).click();
    await page.getByRole('button', { name: '创建工程', exact: true }).click();
    await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await page.locator('.status-message').filter({ hasText: '工程已保存' }).waitFor();
    assert.deepEqual(errors, []);
    const entry = path.join(base, '打包测试', 'project.map3dproj');
    await fs.access(entry);
    await stop();
    app = await launch([entry]);
    page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /打包测试/);
    const copy = path.join(base, '关联副本');
    await fs.cp(path.dirname(entry), copy, { recursive: true });
    const secondEntry = path.join(copy, 'project.map3dproj');
    await page.locator('.tool-rail button').filter({ hasText: '地表' }).click();
    await page.getByLabel('纹理尺度').press('ArrowRight');
    const openAgain = async () => {
      const child = spawn(executablePath, [secondEntry], {
        env,
        windowsHide: true,
        stdio: 'ignore',
      });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
    };
    await openAgain();
    const guard = page.getByRole('dialog', { name: '保留当前编辑？' });
    await guard.waitFor();
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    await openAgain();
    await guard.waitFor();
    await guard.getByRole('button', { name: '放弃并继续' }).click();
    await page.locator('.status-message').filter({ hasText: '关联副本' }).waitFor();
    if (process.env.PACKAGED_SMOKE_OUTPUT)
      await fs.writeFile(process.env.PACKAGED_SMOKE_OUTPUT, secondEntry, 'utf8');
    console.log('打包应用离线启动、中文目录创建保存、入口文件启动和二次打开保护通过');
  } finally {
    if (app) await stop().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
