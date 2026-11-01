param([Parameter(Mandatory=$true)][string]$Msi, [Parameter(Mandatory=$true)][string]$Wxs, [string]$UpgradeMsi, [string]$UpgradeWxs)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$msiPath = (Resolve-Path -LiteralPath $Msi).Path
$xml = Get-Content -LiteralPath $Wxs -Raw
if ($xml -notmatch '<Product Codepage="936" Id="([A-F0-9-]+)"') { throw '无法读取 MSI 产品标识' }
$product = $Matches[1]
if (Test-Path 'HKCU:\Software\Classes\.map3dproj') { throw '已有文件关联，拒绝覆盖现有用户设置' }
if (Test-Path 'HKCU:\Software\Classes\ShanheMapEditor.map3dproj') { throw '已有应用文件关联' }
$existing = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
  Where-Object { $_.DisplayName -like '*山河地图编辑器*' }
if ($existing) { throw '已有安装，拒绝覆盖' }
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if ((Get-ChildItem -LiteralPath $programs -Recurse -Filter '山河地图编辑器.lnk' -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $desktop '山河地图编辑器.lnk'))) { throw '已有同名快捷方式，拒绝覆盖' }
New-Item -ItemType Directory -Force -Path (Join-Path $root 'test-results/tests') | Out-Null
$base = Join-Path $root ('test-results/tests\msi-check-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $base | Out-Null
$target = Join-Path $base 'app'
$log = Join-Path $base 'install.log'
$uninstallLog = Join-Path $base 'uninstall.log'
$installed = $false
try {
  $installerArguments = @('/i', ('"' + $msiPath + '"'), ('APPLICATIONROOTDIRECTORY="' + $target + '"'), 'MSIINSTALLPERUSER=1', '/qn', '/norestart', '/L*v', ('"' + $log + '"'))
  $process = Start-Process -FilePath msiexec.exe -ArgumentList $installerArguments -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "MSI 安装失败：$($process.ExitCode)，日志：$log" }
  $installed = $true
  $userDirectory = Join-Path $target '用户工程'
  New-Item -ItemType Directory -Path $userDirectory | Out-Null
  $marker = Join-Path $userDirectory 'project.map3dproj'
  Set-Content -LiteralPath $marker -Value 'uninstall-preservation-test' -Encoding UTF8
  $version = '0.2.0'
  if ($UpgradeMsi) {
    $upgradePath = (Resolve-Path -LiteralPath $UpgradeMsi).Path
    $upgradeXml = Get-Content -LiteralPath $UpgradeWxs -Raw
    if ($upgradeXml -notmatch '<Product Codepage="936" Id="([A-F0-9-]+)"') { throw '无法读取升级包产品标识' }
    $nextProduct = $Matches[1]
    $upgradeLog = Join-Path $base 'upgrade.log'
    $installerArguments = @('/i', ('"' + $upgradePath + '"'), ('APPLICATIONROOTDIRECTORY="' + $target + '"'), 'MSIINSTALLPERUSER=1', '/qn', '/norestart', '/L*v', ('"' + $upgradeLog + '"'))
    $process = Start-Process -FilePath msiexec.exe -ArgumentList $installerArguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "MSI 升级失败：$($process.ExitCode)，日志：$upgradeLog" }
    $product = $nextProduct
    $version = '0.2.1'
    if (-not (Test-Path -LiteralPath $marker)) { throw '升级后用户工程未保留' }
  }
  $exe = Join-Path $target "app-$version\ShanheMapEditor.exe"
  if (-not (Test-Path -LiteralPath $exe)) { throw "安装程序未写入预期目录：$exe" }
  $association = (Get-Item 'HKCU:\Software\Classes\.map3dproj').GetValue('')
  if ($association -ne 'ShanheMapEditor.map3dproj') { throw '用户文件关联未创建' }
  $command = (Get-Item 'HKCU:\Software\Classes\ShanheMapEditor.map3dproj\shell\open\command').GetValue('')
  if ($command -notlike '*ShanheMapEditor.exe*%1*') { throw '文件关联命令无效' }
  $start = [Environment]::GetFolderPath('Programs')
  if (-not (Get-ChildItem -LiteralPath $start -Recurse -Filter '山河地图编辑器.lnk' -ErrorAction SilentlyContinue)) { throw '开始菜单快捷方式不存在' }
  $env:PACKAGED_SMOKE_OUTPUT = Join-Path $base 'project-path.txt'
  & node (Join-Path $root 'tests\packaged-smoke.cjs') $exe
  if ($LASTEXITCODE -ne 0) { throw '安装后的应用验证失败' }
  $projectFile = Get-Content -LiteralPath $env:PACKAGED_SMOKE_OUTPUT -Raw
  Remove-Item Env:PACKAGED_SMOKE_OUTPUT
  $env:MAP_EDITOR_PROFILE = Join-Path $base 'shell-profile'
  $null = Start-Process -FilePath $projectFile -WindowStyle Hidden -PassThru
  $testProcesses = @()
  for ($attempt = 0; $attempt -lt 40 -and $testProcesses.Count -eq 0; $attempt++) {
    Start-Sleep -Milliseconds 500
    $testProcesses = @(Get-Process ShanheMapEditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.Equals($exe, [StringComparison]::OrdinalIgnoreCase) })
  }
  if ($testProcesses.Count -eq 0) { throw '通过文件关联启动应用失败' }
  $testProcesses | Stop-Process -Force
  Remove-Item Env:MAP_EDITOR_PROFILE
} finally {
  if ($installed) {
    $installerArguments = @('/x', ('{' + $product + '}'), '/qn', '/norestart', '/L*v', ('"' + $uninstallLog + '"'))
    $process = Start-Process -FilePath msiexec.exe -ArgumentList $installerArguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "MSI 卸载失败：$($process.ExitCode)，日志：$uninstallLog" }
  }
}
if (-not (Test-Path -LiteralPath $marker)) { throw '卸载后用户工程未保留' }
if (Test-Path 'HKCU:\Software\Classes\ShanheMapEditor.map3dproj') { throw '卸载后文件关联未清理' }
Write-Output "按用户安装、关联、开始菜单、启动和卸载保留用户文件通过：$base"
