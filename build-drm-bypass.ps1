# Wello DRM Bypass Build Script
# Builds both the hook DLL and injector addon

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Wello DRM Bypass Build Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for required tools
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

# Check CMake
try {
    $cmakeVersion = cmake --version 2>&1 | Select-Object -First 1
    Write-Host "  ✓ CMake found: $cmakeVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ✗ CMake not found. Please install CMake and add to PATH" -ForegroundColor Red
    exit 1
}

# Check node-gyp
try {
    $nodegypVersion = node-gyp --version 2>&1
    Write-Host "  ✓ node-gyp found: v$nodegypVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ✗ node-gyp not found. Installing globally..." -ForegroundColor Yellow
    npm install -g node-gyp
}

Write-Host ""

# Build Hook DLL
Write-Host "[2/5] Building Hook DLL (C++)..." -ForegroundColor Yellow

Set-Location hook_dll

if (Test-Path "build") {
    Write-Host "  Cleaning previous build..." -ForegroundColor Gray
    Remove-Item -Recurse -Force build
}

mkdir build | Out-Null
Set-Location build

Write-Host "  Configuring CMake..." -ForegroundColor Gray
cmake .. -G "Visual Studio 17 2022" -A x64 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ CMake configuration failed" -ForegroundColor Red
    exit 1
}

Write-Host "  Compiling..." -ForegroundColor Gray
cmake --build . --config Release | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Compilation failed" -ForegroundColor Red
    exit 1
}

Write-Host "  ✓ Hook DLL built successfully" -ForegroundColor Green

# Copy DLL to project root
Set-Location ..\..
if (Test-Path "hook_dll\build\bin\Release\wello_hook.dll") {
    Copy-Item "hook_dll\build\bin\Release\wello_hook.dll" .
    Write-Host "  ✓ Copied wello_hook.dll to project root" -ForegroundColor Green
}
else {
    Write-Host "  ✗ DLL not found at expected location" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Build Injector Addon
Write-Host "[3/5] Building Injector Addon (Node.js native)..." -ForegroundColor Yellow

Set-Location injector

Write-Host "  Installing dependencies..." -ForegroundColor Gray
npm install --silent

Write-Host "  Configuring node-gyp..." -ForegroundColor Gray
# Try to use local node-gyp if global fails or just rely on npx
if (Get-Command node-gyp -ErrorAction SilentlyContinue) {
    node-gyp configure --msvs_version=2022 --silent
    Write-Host "  Compiling..." -ForegroundColor Gray
    node-gyp build --release --silent
}
else {
    Write-Host "  Using npx node-gyp..." -ForegroundColor Gray
    npx --yes node-gyp configure --msvs_version=2022 --silent
    Write-Host "  Compiling..." -ForegroundColor Gray
    npx --yes node-gyp build --release --silent
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ Build failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Write-Host "  ✓ Injector addon built successfully" -ForegroundColor Green

Set-Location ..

Write-Host ""

# Verification
Write-Host "[4/5] Verifying build outputs..." -ForegroundColor Yellow

$allGood = $true

if (Test-Path "wello_hook.dll") {
    $dllSize = (Get-Item "wello_hook.dll").Length / 1KB
    Write-Host "  ✓ wello_hook.dll ($([math]::Round($dllSize, 2)) KB)" -ForegroundColor Green
}
else {
    Write-Host "  ✗ wello_hook.dll not found" -ForegroundColor Red
    $allGood = $false
}

if (Test-Path "injector\build\Release\injector.node") {
    $addonSize = (Get-Item "injector\build\Release\injector.node").Length / 1KB
    Write-Host "  ✓ injector.node ($([math]::Round($addonSize, 2)) KB)" -ForegroundColor Green
}
else {
    Write-Host "  ✗ injector.node not found" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

if ($allGood) {
    Write-Host "[5/5] Build completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Run 'npm start' to launch Wello" -ForegroundColor White
    Write-Host "  2. Launch XVast from the browser list" -ForegroundColor White
    Write-Host "  3. Check console for injection confirmation" -ForegroundColor White
    Write-Host "  4. Start recording (should work without black screen)" -ForegroundColor White
    Write-Host ""
    Write-Host "⚠️  Note: You may need to run Wello as Administrator" -ForegroundColor Yellow
    Write-Host "⚠️  Note: Antivirus may flag the DLL - add exceptions if needed" -ForegroundColor Yellow
}
else {
    Write-Host "[5/5] Build completed with errors" -ForegroundColor Red
    Write-Host "Please check the error messages above" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
