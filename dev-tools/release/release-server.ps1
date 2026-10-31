param(
    [ValidateRange(1, 65535)][int]$Port = 4178,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$url = "http://127.0.0.1:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)
try {
    $listener.Start()
} catch {
    Write-Host "Unable to listen on $url. The port may already be in use."
    $listener.Close()
    exit 1
}

$contentTypes = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
    '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'
    '.glb' = 'model/gltf-binary'; '.wasm' = 'application/wasm'
}
Write-Host "Editor running at $url"
Write-Host 'Keep this window open. Press Ctrl+C or close it to stop.'
if (-not $NoOpen) { Start-Process $url }

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        try {
            if ($context.Request.HttpMethod -notin @('GET', 'HEAD')) {
                $response.StatusCode = 405
                continue
            }
            $relative = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
            if ($relative -eq '') { $relative = 'index.html' }
            $path = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
            $extension = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
            if (-not $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or
                -not $contentTypes.ContainsKey($extension) -or
                -not [System.IO.File]::Exists($path)) {
                $response.StatusCode = 404
                continue
            }
            $response.ContentType = $contentTypes[$extension]
            $stream = [System.IO.File]::OpenRead($path)
            try {
                $response.ContentLength64 = $stream.Length
                if ($context.Request.HttpMethod -eq 'GET') { $stream.CopyTo($response.OutputStream) }
            } finally { $stream.Dispose() }
        } catch {
            $response.StatusCode = 500
            Write-Host "Request failed: $($_.Exception.Message)"
        } finally { $response.Close() }
    }
} finally { $listener.Close() }
