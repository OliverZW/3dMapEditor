const path = require('node:path');
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'ShanheMapEditor',
    name: 'ShanheMapEditor',
    icon: path.join(__dirname, 'renderer', 'app.ico'),
    ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
  },
};
