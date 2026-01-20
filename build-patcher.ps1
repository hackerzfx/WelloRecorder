# Build BOTH x86 and x64 patchers
Write-Host "Building Universal Patcher (x86 + x64)..." -ForegroundColor Cyan

# Find C# Compiler
$cscPath = "$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $cscPath)) {
    $cscPath = "$env:windir\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $cscPath)) {
    Write-Host "Error: csc.exe not found" -ForegroundColor Red
    exit 1
}

$source = "patcher\Program.cs"

# Build x64 version
Write-Host "`nBuilding x64 patcher..." -ForegroundColor Yellow
& $cscPath /target:exe /platform:x64 /out:patcher_x64.exe $source
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK patcher_x64.exe" -ForegroundColor Green
}

# Build x86 version (for 32-bit systems)
Write-Host "`nBuilding x86 patcher..." -ForegroundColor Yellow
& $cscPath /target:exe /platform:x86 /out:patcher_x86.exe $source
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK patcher_x86.exe" -ForegroundColor Green
}

Write-Host "`nBoth patchers built successfully!" -ForegroundColor Cyan
Write-Host "x64: For 64-bit Windows/XVast" -ForegroundColor Gray
Write-Host "x86: For 32-bit Windows/XVast" -ForegroundColor Gray
