param([string]$Pkg = '', [string]$Ext = 'C:\12730\.worktrees\12730-next-gen\extension')
$ErrorActionPreference = 'Stop'
# 权威源：packages 下版本号最新的纯版本目录（可用 -Pkg 显式覆盖）。
# 带后缀的变体目录（如 yidian-1.0.2-xiaowei）不参与选源。
# 文件清单从权威源目录动态枚举（含 fonts/icons 子目录），不再维护静态列表。

if (-not $Pkg) {
    $Pkg = Get-ChildItem 'C:\12730\packages' -Directory |
        Where-Object { $_.Name -match '^yidian-\d+(\.\d+)+$' } |
        Sort-Object { [version]($_.Name -replace '^yidian-', '') } |
        Select-Object -Last 1 -ExpandProperty FullName
    if (-not $Pkg) { throw 'packages 下未找到纯版本号的 yidian-* 目录' }
}
Write-Host "SOURCE $Pkg"
if (-not (Test-Path $Ext)) { throw "目标目录不存在：$Ext" }

$files = Get-ChildItem -LiteralPath $Pkg -Recurse -File
foreach ($file in $files) {
    $relative = $file.FullName.Substring($Pkg.Length + 1)
    $destination = Join-Path $Ext $relative
    $parent = Split-Path $destination -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    "SYNCED $relative"
}
Write-Host "=== synced $($files.Count) files from $(Split-Path $Pkg -Leaf) ==="
Write-Host '=== verify manifest version ==='
Select-String -Path (Join-Path $Ext 'manifest.json') -Pattern '"version"'
