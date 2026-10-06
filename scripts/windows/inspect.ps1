# Outlook inspect for one email (PowerShell needs the extra --)
# Usage:
#   .\scripts\windows\inspect.ps1
#   .\scripts\windows\inspect.ps1 -Email someone@outlook.com
#   .\scripts\windows\inspect.ps1 -Email someone@outlook.com -Safe

param(
    [string]$Email = "",
    [switch]$Safe
)

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

$extra = @()
if ($Email) { $extra += "--email=$Email" }
if ($Safe) { $extra += "--safe" }

if ($extra.Count -gt 0) {
    npm run create:inspect -- @extra
} else {
    npm run create:inspect
}
