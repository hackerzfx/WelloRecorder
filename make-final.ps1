# FINAL Package (No deletion, direct build)
$ErrorActionPreference = "Stop"

Write-Host "=== Creating Wello Final ===" -ForegroundColor Cyan

$sourceDir = Get-Location
$outputDir = Join-Path $sourceDir "Wello-Final"
$electronPath = Join-Path $sourceDir "node_modules\electron\dist"

# Create fresh directory
if (Test-Path $outputDir) {
    Write-Host "Cleaning Wello-Final..." -ForegroundColor Yellow
    Remove-Item $outputDir -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

# Copy Electron (optimized)
Write-Host "Copying runtime..." -ForegroundColor Green
$files = @("electron.exe", "chrome_100_percent.pak", "chrome_200_percent.pak", "icudtl.dat", "libEGL.dll", "libGLESv2.dll", "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin", "ffmpeg.dll", "d3dcompiler_47.dll", "vulkan-1.dll", "vk_swiftshader.dll", "vk_swiftshader_icd.json")

foreach ($f in $files) {
    $src = Join-Path $electronPath $f
    if (Test-Path $src) { Copy-Item $src $outputDir -Force }
}

# Locales
$locDir = Join-Path $outputDir "locales"
New-Item -ItemType Directory -Path $locDir -Force | Out-Null
Copy-Item (Join-Path $electronPath "locales\en-US.pak") $locDir -Force

# Resources
Copy-Item (Join-Path $electronPath "resources") $outputDir -Recurse -Force

# App
$appDir = Join-Path $outputDir "resources\app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

# Copy app files
Write-Host "Copying app..." -ForegroundColor Green
@("main.js", "renderer.js", "index.html", "styles.css", "icon.png", "profile.png", "background.png", "patcher_x86.exe", "patcher_x64.exe") | ForEach-Object {
    $src = Join-Path $sourceDir $_
    if (Test-Path $src) {
        Copy-Item $src $appDir -Force
        Write-Host "  $_" -ForegroundColor Gray
    }
}

# Package.json
'{"name":"wello","version":"1.0.0","main":"main.js"}' | Out-File (Join-Path $appDir "package.json") -Encoding UTF8

# Rename
Rename-Item (Join-Path $outputDir "electron.exe") "Wello.exe" -Force

# Size
$size = [math]::Round(((Get-ChildItem $outputDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB), 2)

Write-Host ""
Write-Host "DONE!" -ForegroundColor Green  
Write-Host "Folder: Wello-Final" -ForegroundColor Cyan
Write-Host "Size: $size MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "Includes: x86 + x64 patchers" -ForegroundColor Yellow
