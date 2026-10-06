# Full queue — every row in email data.txt
# Usage: .\scripts\windows\create-all.ps1

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
npm run create
