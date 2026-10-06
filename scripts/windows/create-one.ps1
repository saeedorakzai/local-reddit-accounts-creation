# Smoke test — first email only (opens Firefox)
# Usage: .\scripts\windows\create-one.ps1

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
npm run create:one
