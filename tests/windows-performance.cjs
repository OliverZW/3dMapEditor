const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const os = require('node:os');

// 显式启动真实便携版；不连接用户进程，不打开用户工程，不改默认画质。
const quick = process.argv.includes('--quick');
const forceDiscrete = process.argv.includes('--force-discrete');
const forceIntegrated = process.argv.includes('--force-integrated');
assert.ok(!(forceDiscrete && forceIntegrated), '显卡启动参数互斥');
const baselineOnly = process.argv.includes('--baseline-only');
const previousSurface = process.argv.includes('--previous-surface');
assert.ok(!previousSurface || baselineOnly, '--previous-surface 需配合 --baseline-only');
const baselineVariant = previousSurface ? 'previous-surface' : 'current';
const samples = Number(process.argv.find((v) => v.startsWith('--samples='))?.slice(10) || 513);
assert.ok([513, 1025].includes(samples));
const demoFixture =
  samples === 1025
    ? path.resolve(
        process.argv.find((v) => v.startsWith('--demo-fixture='))?.slice(15) ||
          JSON.parse(
            require('node:fs').readFileSync(
              path.resolve('test-results/fixtures/performance-demo-1025-project.json'),
              'utf8',
            ),
          ).directory,
      )
    : null;
const quality = process.argv.find((value) => value.startsWith('--quality='))?.slice(10) || 'high';
assert.ok(['fast', 'balanced', 'high'].includes(quality), '无效显示档位');
const executable = path.resolve(
  process.argv.find((v) => v.startsWith('--exe='))?.slice(6) ||
    `dist/mapEdtor-v${require('../package.json').version}/ShanheMapEditor.exe`,
);
const warmupMs = quick ? 1000 : 5000;
const durationMs = quick ? 2000 : 15000;
const repeats = quick ? 1 : 3;
const variants = baselineOnly
  ? [baselineVariant]
  : ['current', 'hidden', 'basic', 'dpr-1', 'dpr-half', 'no-msaa'];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fingerprint = async (file) => ({
  file: path.basename(file),
  sha256: createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex'),
});

(async () => {
  const output = path.resolve(
    'test-results/tests/windows-performance-' + new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await fs.mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: 'running',
    conditions: {
      quick,
      forceDiscrete,
      forceIntegrated,
      baselineOnly,
      previousSurface,
      quality,
      samples,
      demoFixture,
      warmupMs,
      warmupScheduling: 'forced-continuous-diagnostic',
      durationMs,
      repeats,
      executable,
      contentSize: [1600, 1000],
      sceneSource:
        samples === 513
          ? '通过真实首页创建空白工程及勾选内置示例的独立副本；513²、2048×2048米；不使用用户地图'
          : '真实首页创建1025²空白并打开程序构造目录示例的独立副本，保留内置资源归属和LOD；不读取用户地图',
      camera: { position: [700, 870, 1050], target: [0, 32, 0] },
      motion: '相机与目标沿 X 轴按 sin(t秒)×80米平移',
      sessionType: process.env.SESSIONNAME || null,
    },
    limitations: [
      'quick 为工具验证，不作为正式基线。',
      'CPU 帧与 render 提交均为 JS 墙钟耗时，可能包含驱动等待，不是 CPU 利用率，也不能与 GPU 时间相加。',
      '总面数是 renderer.info.render.triangles；不含 DOM 合成；模型面数为现有每秒发布的颜色通道统计，不含地形、水及辅助图形。',
      'GPU 查询异步读取，不同步等待；结束时未就绪的查询释放，不计入样本；扩展不可用时 gpuMs 为 null。',
      '隐藏地形、无光照材质、降低分辨率和关闭 MSAA 仅作归因，不能代表完整画质达标。',
      '固定相机平移用于可复现的运动基线，不代替真实鼠标编辑和连续笔刷验收。',
    ],
    scenes: [],
    measurements: [],
    summaries: [],
    errors: [],
  };
  const persist = () =>
    fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  let application;
  try {
    await fs.access(executable);
    report.build = await fingerprint(path.join(path.dirname(executable), 'resources/app.asar'));
    try {
      const bytes = execFileSync('powercfg.exe', ['/getactivescheme'], { windowsHide: true });
      report.conditions.powerPlan = new TextDecoder('gb18030').decode(bytes).trim();
    } catch (error) {
      report.conditions.powerPlan = { unavailable: error.message };
    }
    const env = {
      ...process.env,
      MAP_EDITOR_PROFILE: path.join(output, 'profile'),
      MAP_EDITOR_PERFORMANCE_PROBE: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: executable,
      args: forceDiscrete
        ? ['--force_high_performance_gpu']
        : forceIntegrated
          ? ['--force_low_power_gpu']
          : [],
      env,
      timeout: 60000,
    });
    const page = await application.firstWindow();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (error) => report.errors.push(String(error)));
    if (demoFixture) {
      report.fixture = await fingerprint(path.join(demoFixture, 'project.map3dproj'));
      await fs.cp(demoFixture, path.join(output, 'demo'), { recursive: true });
    }
    await application.evaluate(
      ({ BrowserWindow, dialog }, { output, demoFixture }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setContentSize(1600, 1000);
        window.show();
        window.focus();
        dialog.showOpenDialog = async (_window, options) => {
          if (demoFixture && options.properties.includes('openFile'))
            return {
              canceled: false,
              filePaths: [output + '/demo/project.map3dproj'],
            };
          if (!options.properties.includes('openDirectory'))
            throw new Error('性能工具仅允许选择临时父目录');
          return { canceled: false, filePaths: [output] };
        };
      },
      { output, demoFixture },
    );
    const waitReady = async () => {
      await page.waitForFunction(
        () => window.mapEditorPerformance?.snapshot().ready,
        {},
        { timeout: 180000 },
      );
    };
    const warmup = async () => {
      const result = await page.evaluate(
        (ms) => window.mapEditorPerformance.sample(ms, false),
        warmupMs,
      );
      assert.ok(result.valid, '连续预热期间发生失焦、隐藏或上下文丢失');
    };
    for (const scene of ['blank', 'demo']) {
      if (scene === 'demo' && samples === 1025) {
        await page.getByRole('heading', { name: '三维战略地图编辑器' }).waitFor();
        await page.getByRole('button', { name: '打开工程', exact: true }).click();
      } else {
        await page.getByRole('button', { name: '创建工程', exact: true }).click();
        await page.getByLabel('工程名称').fill(scene);
        await page.getByRole('button', { name: '选择父目录' }).click();
        if (scene === 'blank')
          await page.getByLabel('地形采样', { exact: true }).selectOption(String(samples));
        if (scene === 'demo') await page.getByLabel('导入示例工程').check();
        await page.getByRole('button', { name: '创建工程', exact: true }).click();
      }
      await page.getByLabel('显示档位', { exact: true }).selectOption(quality);
      await waitReady();
      await page.bringToFront();
      const input = await fingerprint(path.join(output, scene, 'project.map3dproj'));
      const initial = await page.evaluate(() => window.mapEditorPerformance.snapshot());
      assert.equal(initial.document.settings.samples, samples);
      assert.equal(initial.document.settings.width, 2048);
      if (scene === 'blank') {
        assert.equal(initial.document.trees, 0);
        assert.equal(initial.document.sites, 0);
      } else {
        assert.ok(initial.document.trees > 0);
        assert.ok(initial.document.sites > 0);
        assert.ok(initial.stats.grass > 0 && initial.stats.trees > 0, '完整示例可见资源必须就绪');
      }
      report.scenes.push({ scene, input, initial });
      if (!report.system)
        report.system = await application.evaluate(
          async ({ app, BrowserWindow, screen, powerMonitor }) => {
            const display = screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds());
            return {
              packaged: app.isPackaged,
              versions: process.versions,
              onBattery: powerMonitor.isOnBatteryPower(),
              display,
              gpuStatus: app.getGPUFeatureStatus(),
              gpuPreference: {
                high: app.commandLine.hasSwitch('force_high_performance_gpu'),
                low: app.commandLine.hasSwitch('force_low_power_gpu'),
              },
              gpu: await app.getGPUInfo('complete'),
            };
          },
        );
      report.system.os = {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length,
        memoryBytes: os.totalmem(),
      };
      assert.equal(report.system.packaged, true, '必须使用真实发布版');
      const backend = initial.context.unmaskedRenderer || initial.context.renderer;
      if (
        /swiftshader|llvmpipe|software rasterizer|basic render/i.test(backend) ||
        /software|disabled/.test(report.system.gpuStatus.webgl || '')
      ) {
        report.status = 'blocked-software-rendering';
        throw new Error(
          '检测到软件渲染或 WebGL 加速禁用；先修复驱动／图形路径，本次不建立硬件基线：' + backend,
        );
      }
      for (let round = 0; round < repeats; round++) {
        const order = [...variants.slice(round), ...variants.slice(0, round)];
        for (const variant of order) {
          await page.evaluate((variant) => window.mapEditorPerformance.configure(variant), variant);
          await waitReady();
          await page.bringToFront();
          await warmup();
          const snapshot = await page.evaluate(() => window.mapEditorPerformance.snapshot());
          if (previousSurface)
            assert.equal(snapshot.display.surfaceMaterial, 'MeshStandardMaterial');
          if (variant === 'no-msaa') assert.equal(snapshot.context.attributes.antialias, false);
          if (variant === 'dpr-1') assert.equal(snapshot.viewport.pixelRatio, 1);
          const measurement = await page.evaluate(
            ({ durationMs }) => window.mapEditorPerformance.sample(durationMs, false),
            { durationMs },
          );
          report.measurements.push({ scene, round: round + 1, variant, ...measurement });
          await persist();
          console.log(
            `${scene} ${variant} round ${round + 1}: ${measurement.fps.toFixed(2)} FPS, P95 ${measurement.frameMs.p95.toFixed(1)} ms, GPU ${measurement.gpuMs?.median.toFixed(2) ?? 'unavailable'} ms, valid=${measurement.valid}`,
          );
          assert.ok(measurement.valid, '采样期间失焦、后台、文档变化或上下文丢失，结果无效');
          if (round === 0)
            await page.screenshot({ path: path.join(output, `${scene}-${variant}.png`) });
        }
        await page.evaluate(
          (variant) => window.mapEditorPerformance.configure(variant),
          baselineVariant,
        );
        await waitReady();
        await page.bringToFront();
        await warmup();
        const motion = await page.evaluate(
          (durationMs) => window.mapEditorPerformance.sample(durationMs, true),
          durationMs,
        );
        report.measurements.push({ scene, round: round + 1, variant: baselineVariant, ...motion });
        await persist();
        console.log(
          `${scene} motion round ${round + 1}: ${motion.fps.toFixed(2)} FPS, valid=${motion.valid}`,
        );
        assert.ok(motion.valid, '运动采样无效');
      }
      await page.getByRole('button', { name: '返回首页' }).click();
      await page.getByRole('heading', { name: '三维战略地图编辑器' }).waitFor();
    }
    for (const scene of ['blank', 'demo'])
      for (const variant of variants)
        for (const motion of [false, true]) {
          const rows = report.measurements.filter(
            (row) =>
              row.scene === scene && row.variant === variant && row.motion === motion && row.valid,
          );
          if (rows.length)
            report.summaries.push({
              scene,
              variant,
              motion,
              rounds: rows.length,
              fps: median(rows.map((row) => row.fps)),
              p95Ms: median(rows.map((row) => row.frameMs.p95)),
              cpuFrameWallMs: median(rows.map((row) => row.cpuFrameWallMs.median)),
              submissionWallMs: median(rows.map((row) => row.renderSubmissionWallMs.median)),
              gpuMs: rows.every((row) => row.gpuMs)
                ? median(rows.map((row) => row.gpuMs.median))
                : null,
            });
        }
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    report.status = quick ? 'probe-passed' : 'measured';
  } catch (error) {
    if (report.status === 'running') report.status = 'failed';
    report.errors.push(String(error));
    if (application) {
      const page = await application.firstWindow().catch(() => null);
      if (page)
        report.failureBody = await page
          .locator('body')
          .innerText()
          .catch(() => '');
    }
    process.exitCode = 1;
    console.error(error);
  } finally {
    report.finishedAt = new Date().toISOString();
    await persist();
    if (application) {
      await application
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
        )
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    console.log('性能报告：' + path.join(output, 'report.json'));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
