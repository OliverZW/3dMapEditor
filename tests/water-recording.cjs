require('node:fs').mkdirSync('test-results/tests', { recursive: true });
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./surface-fixture.cjs');
const { fixture, camera } = require('./water-fixture.cjs');
const { measure } = require('./water-visibility.cjs');

async function main() {
  const browser = await launch(),
    reports = [];
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    await fixture(page, { demo: true });
    for (const view of ['demo', 'overview']) {
      await camera(page, view);
      const metrics = await measure(page);
      const result = await page.evaluate(async () => {
        const { viewport: v } = window.waterFixture;
        const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find((t) =>
          MediaRecorder.isTypeSupported(t),
        );
        if (!type) throw Error('浏览器不支持WebM录屏');
        const stream = v.renderer.domElement.captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6000000 });
        const chunks = [];
        const stopped = new Promise((resolve, reject) => {
          recorder.onstop = resolve;
          recorder.onerror = reject;
        });
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        const started = performance.now(),
          framesBefore = v.renderer.info.render.frame;
        Object.defineProperty(v, 'animationTime', { configurable: true, writable: true, value: 7 });
        let animation = 0;
        const advance = () => {
          v.animationTime = 7 + (performance.now() - started) / 1000;
          v.requestRender();
          animation = requestAnimationFrame(advance);
        };
        recorder.start(250);
        advance();
        await new Promise((r) => setTimeout(r, 8000));
        recorder.stop();
        cancelAnimationFrame(animation);
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        const seconds = (performance.now() - started) / 1000;
        const renderedFrames = v.renderer.info.render.frame - framesBefore;
        const gl = v.renderer.getContext(),
          ext = gl.getExtension('WEBGL_debug_renderer_info');
        const hardware = ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER);
        const blob = new Blob(chunks, { type }),
          url = URL.createObjectURL(blob);
        try {
          // 回放真实编码视频，确认有帧、尺寸正确，水体内仍保留可见变化。
          const video = document.createElement('video');
          video.muted = true;
          video.src = url;
          await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve;
            video.onerror = reject;
          });
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const seek = async (time) => {
            await new Promise((resolve) => {
              video.onseeked = resolve;
              video.currentTime = time;
            });
            ctx.drawImage(video, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const a = await seek(0.5),
            b = await seek(2.5),
            mask = window.waterVisibilityMask;
          let count = 0,
            changed = 0;
          for (let y = 2; y < mask.height - 2; y++)
            for (let x = 2; x < mask.width - 2; x++) {
              let inside = true;
              for (let dy = -2; dy <= 2 && inside; dy++)
                for (let dx = -2; dx <= 2; dx++)
                  if (mask.bytes[((y + dy) * mask.width + x + dx) * 4] < 250) {
                    inside = false;
                    break;
                  }
              if (!inside) continue;
              const i = (y * mask.width + x) * 4;
              if (
                Math.abs(
                  (a[i] - b[i]) * 0.2126 +
                    (a[i + 1] - b[i + 1]) * 0.7152 +
                    (a[i + 2] - b[i + 2]) * 0.0722,
                ) >= 6
              )
                changed++;
              count++;
            }
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return {
            data,
            seconds,
            renderedFrames,
            averageRenderFps: renderedFrames / seconds,
            hardware,
            size: [canvas.width, canvas.height],
            decodedMovingRatio: changed / count,
            type,
            bytes: blob.size,
          };
        } finally {
          URL.revokeObjectURL(url);
        }
      });
      const { data, ...report } = result;
      const target = path.resolve(__dirname, `../test-results/tests/water-flow-${view}.webm`);
      fs.writeFileSync(target, Buffer.from(data, 'base64'));
      reports.push({ view, ...report, metrics });
      console.log(JSON.stringify(reports.at(-1)));
      assert(report.seconds >= 8 && report.seconds < 12);
      assert.deepEqual(report.size, [1280, 800]);
      assert(report.decodedMovingRatio >= 0.05, '编码视频中的水体动感不足');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.resolve(__dirname, '../test-results/tests/water-recording-report.json'),
      JSON.stringify({ reports, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
