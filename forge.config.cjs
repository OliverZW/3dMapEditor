const path = require('node:path');
const icon = path.join(__dirname, 'renderer', 'app.ico');
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'ShanheMapEditor',
    name: 'ShanheMapEditor',
    icon,
    ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
  },
  makers: [
    {
      name: '@electron-forge/maker-wix',
      config: {
        name: '山河地图编辑器',
        shortName: 'ShanheMapEditor',
        icon,
        exe: 'ShanheMapEditor.exe',
        manufacturer: 'Shanhe Map Studio',
        description: '山河三维地图编辑器',
        shortcutName: '山河地图编辑器',
        appUserModelId: 'org.shanhe.mapeditor',
        upgradeCode: 'C153B9C9-EE6C-4D69-9FC8-BDDE06691D29',
        defaultInstallMode: 'perUser',
        language: 2052,
        beforeCreate: (creator) => {
          const purge =
            /<DirectoryRef Id="APPLICATIONROOTDIRECTORY">\s*<Component Id="PurgeOnUninstall"[\s\S]*?<\/Component>\s*<\/DirectoryRef>/;
          if (
            !purge.test(creator.wixTemplate) ||
            !creator.wixTemplate.includes('<ComponentRef Id="PurgeOnUninstall" />')
          )
            throw new Error('WiX 模板变化，无法确保卸载保留用户文件');
          creator.wixTemplate = creator.wixTemplate
            .replace('<Product Id=', '<Product Codepage="936" Id=')
            .replace(purge, '')
            .replace('<ComponentRef Id="PurgeOnUninstall" />', '');
          creator.wixTemplate = creator.wixTemplate
            .replace(
              '<Feature Id="Complete"',
              String.raw`<DirectoryRef Id="APPLICATIONROOTDIRECTORY">
              <Component Id="ProjectFileAssociation" Guid="29D91B37-775D-48A4-84EC-3EE365721E6A" Win64="yes">
                <RegistryValue Root="HKCU" Key="Software\Classes\.map3dproj" Value="ShanheMapEditor.map3dproj" Type="string" KeyPath="yes" />
                <RegistryValue Root="HKCU" Key="Software\Classes\ShanheMapEditor.map3dproj" Value="山河地图工程" Type="string" />
                <RegistryValue Root="HKCU" Key="Software\Classes\ShanheMapEditor.map3dproj\DefaultIcon" Value="[APPLICATIONROOTDIRECTORY]ShanheMapEditor.exe,0" Type="string" />
                <RegistryValue Root="HKCU" Key="Software\Classes\ShanheMapEditor.map3dproj\shell\open\command" Value="&quot;[APPLICATIONROOTDIRECTORY]ShanheMapEditor.exe&quot; &quot;%1&quot;" Type="string" />
              </Component>
            </DirectoryRef><Feature Id="Complete"`,
            )
            .replace(
              '<ComponentRef Id="ApplicationShortcut" />',
              '<ComponentRef Id="ProjectFileAssociation" /><ComponentRef Id="ApplicationShortcut" />',
            );
        },
        arch: 'x64',
        features: false,
        autoRun: false,
        ui: false,
      },
    },
  ],
};
