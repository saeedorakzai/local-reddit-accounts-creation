# Open an existing profile folder with Mozilla Firefox (manual check)
# Usage:
#   .\scripts\windows\open-profile.ps1 -ProfileId ff-name_outlook.com
#   .\scripts\windows\open-profile.ps1 -Email Name@outlook.com

param(
    [string]$ProfileId = "",
    [string]$Email = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

if (-not $ProfileId -and $Email) {
    $safe = ($Email -replace '@', '_' -replace '[^a-zA-Z0-9._-]+', '_').ToLower()
    $ProfileId = "ff-$safe"
}

if (-not $ProfileId) {
    throw "Pass -ProfileId ff-... or -Email someone@outlook.com"
}

$dir = Join-Path $Root ".firefox-profiles\$ProfileId"
if (-not (Test-Path $dir)) {
    throw "Profile folder not found: $dir"
}

$candidates = @(
    "${env:ProgramFiles}\Mozilla Firefox\firefox.exe",
    "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe",
    "${env:LOCALAPPDATA}\Mozilla Firefox\firefox.exe"
)
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) {
    throw "Mozilla Firefox not found. Install from https://www.mozilla.org/firefox/ or set FIREFOX_PATH."
}

Write-Host "Opening $dir with $exe" -ForegroundColor Cyan
& $exe -no-remote -profile $dir
