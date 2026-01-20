# Cleanup old build folders and temporary files
Write-Host "Cleaning workspace..." -ForegroundColor Cyan

# Old portable folders
@("WelloPortable", "WelloPortable-Optimized") | ForEach-Object {
    if (Test-Path $_) {
        Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Deleted $_" -ForegroundColor Gray
    }
}

# Temporary build scripts (keep only make-final.ps1)
@("create-portable.ps1", "create-portable-optimized.ps1", "create-final-package.ps1", "sign-exe.ps1") | ForEach-Object {
    if (Test-Path $_) {
        Remove-Item $_ -Force
        Write-Host "  Deleted $_" -ForegroundColor Gray
    }
}

# Old build folders
if (Test-Path "dist") {
    Remove-Item "dist" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Deleted dist" -ForegroundColor Gray
}

Write-Host "`nCleanup complete!" -ForegroundColor Green
Write-Host "Kept: Wello-Final (your distribution package)" -ForegroundColor Cyan
