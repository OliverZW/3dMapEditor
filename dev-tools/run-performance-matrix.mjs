import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('test-results/tests/windows-release-matrix-' + Date.now());
await mkdir(root, { recursive: true });
const matrix = {
  status: 'running',
  startedAt: new Date().toISOString(),
  conditions: {
    warmupMs: 5000,
    durationMs: 15000,
    repeats: 3,
    source: '最终默认启动路径；各配置串行，采样期间不运行其他WebGL或性能测试',
  },
  runs: [],
  errors: [],
};
const persist = () => writeFile(resolve(root, 'matrix.json'), JSON.stringify(matrix, null, 2));
await persist();
console.log('矩阵目录：' + root);
try {
  for (const samples of [513, 1025])
    for (const quality of ['fast', 'balanced', 'high']) {
      const before = new Set(await readdir(resolve('test-results/tests')));
      console.log('开始配置：' + quality + ' ' + samples);
      const code = await new Promise((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            'tests/windows-performance.cjs',
            '--baseline-only',
            '--quality=' + quality,
            '--samples=' + samples,
          ],
          { cwd: process.cwd(), windowsHide: true, stdio: 'inherit' },
        );
        child.once('error', reject);
        child.once('exit', done);
      });
      assert.equal(code, 0, '采样工具失败');
      const added = (await readdir(resolve('test-results/tests'))).filter(
        (name) => name.startsWith('windows-performance-') && !before.has(name),
      );
      assert.equal(added.length, 1);
      const file = resolve('test-results/tests', added[0], 'report.json'),
        r = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(r.status, 'measured');
      assert.equal(r.measurements.length, 12);
      assert.equal(r.conditions.warmupScheduling, 'forced-continuous-diagnostic');
      assert.ok(!r.conditions.forceDiscrete && !r.conditions.forceIntegrated);
      assert.ok(r.measurements.every((m) => m.valid));
      if (matrix.runs.length)
        assert.equal(r.build.sha256, matrix.runs[0].asarSha256, '矩阵必须使用同一构建');
      matrix.runs.push({
        samples,
        quality,
        report: relative(root, file).replaceAll('\\', '/'),
        asarSha256: r.build.sha256,
        summaries: r.summaries,
        renderer: r.scenes[0].initial.context.unmaskedRenderer,
        viewport: r.scenes[0].initial.viewport,
      });
      await persist();
      console.log('配置完成：' + quality + ' ' + samples);
    }
  matrix.status = 'measured';
  matrix.finishedAt = new Date().toISOString();
} catch (error) {
  matrix.status = 'failed';
  matrix.errors.push(error.stack);
  throw error;
} finally {
  await persist();
  console.log('矩阵报告：' + resolve(root, 'matrix.json'));
}
