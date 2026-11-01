const { api } = require('@electron-forge/core');
const keepAlive = setInterval(() => console.log('正在打包应用并生成 MSI…'), 30000);
const timeout = setTimeout(
  () => {
    console.error('MSI 打包超时，请检查 WiX 和 Electron 下载环境。');
    process.exit(1);
  },
  30 * 60 * 1000,
);
api
  .make({ dir: process.argv[2], arch: 'x64', platform: 'win32', interactive: false })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearInterval(keepAlive);
    clearTimeout(timeout);
  });
