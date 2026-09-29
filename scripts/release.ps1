# Build the public ZIP from the exact extension source after all checks pass.
# Run: powershell -ExecutionPolicy Bypass -File scripts/release.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$manifest = Get-Content 'extension\manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne $package.version) { throw 'Manifest and package versions differ' }
if ((Get-FileHash 'core\domain.mjs' -Algorithm SHA256).Hash -ne
    (Get-FileHash 'extension\domain.mjs' -Algorithm SHA256).Hash) {
    throw 'Core and extension domain sources differ; resolve this before packaging'
}

npm run check
if ($LASTEXITCODE -ne 0) { throw 'Checks failed; package not created' }
npm run test:e2e
if ($LASTEXITCODE -ne 0) { throw 'Browser upgrade check failed; package not created' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$extensionPath = (Resolve-Path -LiteralPath 'extension').Path
$destination = Join-Path $root "studio\yidian-$($manifest.version).zip"
$pending = "$destination.pending"
if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }

try {
    $files = Get-ChildItem -LiteralPath $extensionPath -Recurse -File | Sort-Object FullName
    $builder = [System.IO.Compression.ZipFile]::Open($pending, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            $entryName = $file.FullName.Substring($extensionPath.Length).TrimStart('\', '/').Replace('\', '/')
            $entry = $builder.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [System.DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
            $inputStream = [System.IO.File]::OpenRead($file.FullName)
            $outputStream = $entry.Open()
            try { $inputStream.CopyTo($outputStream) }
            finally { $inputStream.Dispose(); $outputStream.Dispose() }
        }
    } finally { $builder.Dispose() }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($pending)
    try {
        if ($archive.Entries.Count -ne $files.Count) { throw 'ZIP file count differs from extension source' }
        foreach ($file in $files) {
            $entryName = $file.FullName.Substring($extensionPath.Length).TrimStart('\', '/').Replace('\', '/')
            $entry = $archive.GetEntry($entryName)
            if (-not $entry) { throw "ZIP is missing $entryName" }
            $stream = $entry.Open()
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { $zipHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ($zipHash -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) {
                throw "ZIP content differs for $entryName"
            }
        }
    } finally { $archive.Dispose() }
    if (Test-Path -LiteralPath $destination) {
        $backup = "$destination.previous-$([guid]::NewGuid().ToString('N'))"
        [System.IO.File]::Replace($pending, $destination, $backup)
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    } else {
        [System.IO.File]::Move($pending, $destination)
    }
} finally {
    if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }
}
Write-Host "Verified $destination"
