# Krunker Replay Tool - Installer Script
# PowerShell 5.1+

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  Krunker 3D Replay Tool - INSTALLER" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Node.js check
try {
    $nodeVersion = & node -v 2>&1
    Write-Host "[INFO] Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js is not installed. Please install Node.js first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Move to installer directory
$scriptDir = Split-Path -Parent $PSCommandPath
$installerDir = Split-Path -Parent $scriptDir
$rootDir = Split-Path -Parent $installerDir

Write-Host "[INFO] Project directory: $rootDir" -ForegroundColor Gray

# Run node sideloader
Write-Host ""
Write-Host "[INFO] Running Krunker client injection..." -ForegroundColor Cyan
Set-Location $installerDir
try {
    & node src/sideloader.js install
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "=================================================" -ForegroundColor Green
        Write-Host "  [SUCCESS] Installation complete!" -ForegroundColor Green
        Write-Host "  Please restart Krunker client." -ForegroundColor Green
        Write-Host "=================================================" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Sideloader exited with code $LASTEXITCODE" -ForegroundColor Red
    }
} catch {
    Write-Host "[ERROR] Installation failed: $_" -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to exit"
