const { api } = require('@electron-forge/core');
const keepAlive = setInterval(() => console.log('正在打包便携版…'), 30000);
api
  .package({ dir: process.argv[2], arch: 'x64', platform: 'win32', interactive: false })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
