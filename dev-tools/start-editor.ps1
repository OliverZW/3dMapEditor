param([int]$Port = 5173, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } elseif ($nodeCommand) { $nodeCommand.Source } else { throw '请安装 Node.js 22.12 或更新的 LTS 版本。' }
$nodeMajor = [int]((& $nodePath -p 'process.versions.node').Split('.')[0])
if ($nodeMajor -lt 22) { throw '当前 Node.js 太旧，请安装 Node.js 22.12 或更新的 LTS 版本。' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vite\bin\vite.js'))) { throw '缺少开发依赖。请按 README 安装依赖后再次启动。' }
$editorUrl = "http://127.0.0.1:$Port/"
$alreadyRunning = $false
try {
    $response = Invoke-WebRequest -Uri $editorUrl -UseBasicParsing -TimeoutSec 1
    $alreadyRunning = $response.Content -match 'content="#151c25"'
} catch {
    $alreadyRunning = $false
}
if ($alreadyRunning) {
    Write-Host "编辑器已经运行：$editorUrl"
    if (-not $NoOpen) { Start-Process $editorUrl }
    exit 0
}
$viteArguments = @('--host', '127.0.0.1', '--port', "$Port", '--strictPort')
if (-not $NoOpen) { $viteArguments += '--open' }
& $nodePath (Join-Path $projectRoot 'node_modules\vite\bin\vite.js') @viteArguments
exit $LASTEXITCODE
