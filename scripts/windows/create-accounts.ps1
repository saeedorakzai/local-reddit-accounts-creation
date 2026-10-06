# List emails / profile names (no browser)
# Usage: .\scripts\windows\create-accounts.ps1

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
npm run create:accounts
