# Fix Windows Notepad filenames + ensure .env has Mozilla + proxy lines
# Usage (from project root):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\windows\fix-env.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==> Project: $Root" -ForegroundColor Cyan

# Notepad often saves ".env" as ".env.txt"
if ((Test-Path ".\.env.txt") -and -not (Test-Path ".\.env")) {
    Rename-Item ".\.env.txt" ".env" -Force
    Write-Host "==> Renamed .env.txt -> .env" -ForegroundColor Yellow
} elseif ((Test-Path ".\.env.txt") -and (Test-Path ".\.env")) {
    Write-Host "==> Both .env and .env.txt exist — keeping .env, leave .env.txt alone" -ForegroundColor DarkGray
}

# Notepad often saves "proxy details" as "proxy details.txt"
if ((Test-Path ".\proxy details.txt") -and -not (Test-Path ".\proxy details")) {
    Rename-Item ".\proxy details.txt" "proxy details" -Force
    Write-Host "==> Renamed 'proxy details.txt' -> 'proxy details'" -ForegroundColor Yellow
}

if (-not (Test-Path ".\.env")) {
    if (Test-Path ".\.env.example") {
        Copy-Item ".\.env.example" ".\.env"
        Write-Host "==> Created .env from .env.example" -ForegroundColor Yellow
    } else {
        throw "No .env and no .env.example"
    }
}

function Set-EnvKey([string]$key, [string]$value) {
    $path = ".\.env"
    $lines = Get-Content $path -ErrorAction Stop
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($key))\s*=") {
            $found = $true
            "$key=$value"
        } else {
            $line
        }
    }
    if (-not $found) {
        $out += "$key=$value"
    }
    $out | Set-Content $path -Encoding utf8
}

Set-EnvKey "HEADLESS" "false"
Set-EnvKey "PROXY_ENABLED" "true"
Set-EnvKey "PROXY_FILE" "proxy details"
Set-EnvKey "TEST_USERS_FILE" "email data.txt"
Set-EnvKey "PROFILES_DIR" ".firefox-profiles"
Set-EnvKey "USE_SYSTEM_FIREFOX" "true"

Write-Host ""
Write-Host "Current key lines in .env:" -ForegroundColor Cyan
Select-String -Path ".\.env" -Pattern "^(HEADLESS|PROXY_|USE_SYSTEM|TEST_USERS|PROFILES_DIR|FIREFOX_PATH)" |
    ForEach-Object { $_.Line }

Write-Host ""
Write-Host "Files check:" -ForegroundColor Cyan
@(
    ".env",
    "email data.txt",
    "proxy details",
    "proxy details.txt"
) | ForEach-Object {
    $ok = Test-Path ".\"$_
    "{0,-22} {1}" -f $_, $(if ($ok) { "OK" } else { "MISSING" })
}

$ff = @(
    "${env:ProgramFiles}\Mozilla Firefox\firefox.exe",
    "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($ff) {
    Write-Host "Mozilla Firefox: $ff" -ForegroundColor Green
} else {
    Write-Host "Mozilla Firefox NOT found — install from https://www.mozilla.org/firefox/" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next:  npm run create:accounts   then   npm run create:one" -ForegroundColor Cyan
Write-Host "Expect log:  Using Mozilla Firefox: ...\firefox.exe" -ForegroundColor Cyan
