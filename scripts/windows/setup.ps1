# One-time / update setup for Windows (PowerShell)
# Usage (from project root):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\windows\setup.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==> Project: $Root" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js not found. Install LTS from https://nodejs.org and open a new PowerShell."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Reinstall Node.js with PATH enabled."
}

Write-Host "==> node $(node -v) / npm $(npm -v)" -ForegroundColor Green

if (Test-Path (Join-Path $Root ".git")) {
    Write-Host "==> git pull" -ForegroundColor Cyan
    git pull
}

Write-Host "==> npm install" -ForegroundColor Cyan
npm install

Write-Host "==> Playwright Firefox" -ForegroundColor Cyan
npx playwright install firefox

$envExample = Join-Path $Root ".env.example"
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "==> Created .env from .env.example — edit PROXY / USE_SYSTEM_FIREFOX as needed" -ForegroundColor Yellow
    }
} else {
    Write-Host "==> .env already exists (left unchanged)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Put credentials in:  email data.txt"
Write-Host "  2. Put proxy in:        proxy details   (or PROXY_ENABLED=false in .env)"
Write-Host "  3. Optional Mozilla:     USE_SYSTEM_FIREFOX=true in .env"
Write-Host "  4. Smoke test:           .\scripts\windows\create-one.ps1"
Write-Host "  5. Full run:             .\scripts\windows\create-all.ps1"
Write-Host ""
Write-Host "Done." -ForegroundColor Green
