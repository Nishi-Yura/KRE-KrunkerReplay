<#
.SYNOPSIS
    Krunker Replay Uninstaller
.DESCRIPTION
    Krunker 3Dリプレイツールのアンインストーラースクリプトです。
    管理者権限で実行する必要があります。
#>

$ErrorActionPreference = "Stop"

# ASCIIバナー
$Banner = @"
  _  __ _____   ______   _    _  _   _  _____  _   _   _____  _______  __      _        _        ______  _____  
 | |/ /|  __ \ |  ____| | |  | || \ | ||_   _|| \ | | / ____||__   __|/  \    | |      | |      |  ____||  __ \ 
 | ' / | |__) || |__    | |  | ||  \| |  | |  |  \| || (___     | |  / /\ \   | |      | |      | |__   | |__) |
 |  <  |  _  / |  __|   | |  | || . ` |  | |  | . ` | \___ \    | | / ____ \  | |      | |      |  __|  |  _  / 
 | . \ | | \ \ | |____  | |__| || |\  | _| |_ | |\  | ____) |   | |/ /    \ \ | |____  | |____  | |____ | | \ \ 
 |_|\_\|_|  \_\|______|  \____/ |_| \_||_____||_| \_||_____/    |_/_/      \_\|______| |______| |______||_|  \_\
                                                                                                                
"@

Write-Host $Banner -ForegroundColor Cyan

# 管理者権限チェック
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[WARNING] 管理者権限がありません。管理者として再起動します..." -ForegroundColor Yellow
    Start-Process powershell -Verb runAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Exit
}

Write-Host "[INFO] 管理者権限を確認しました。" -ForegroundColor Green

# アンインストール確認プロンプト
$confirmation = Read-Host "Krunker 3Dリプレイツールをアンインストールしますか？ (Y/N)"
if ($confirmation -notmatch "^[Yy]$") {
    Write-Host "[INFO] アンインストールをキャンセルしました。" -ForegroundColor Yellow
    Pause
    Exit
}

$installerDir = Split-Path -Parent -Path (Split-Path -Parent -Path $PSCommandPath)
Push-Location $installerDir

# Nodeモジュールがない場合はインストールする
if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] 依存パッケージをインストール中..." -ForegroundColor Cyan
    npm install
}

# アンインストール実行
Write-Host "[INFO] アンインストールを実行しています..." -ForegroundColor Cyan
try {
    node src/sideloader.js uninstall
    Write-Host "[SUCCESS] アンインストールが完了しました。" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] アンインストールに失敗しました。" -ForegroundColor Red
}

Pop-Location
Pause
