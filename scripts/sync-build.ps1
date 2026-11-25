param(
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$destination = 'C:\folio'

if (-not (Test-Path $destination)) {
  New-Item -ItemType Directory -Path $destination | Out-Null
}

Write-Host "Mirroring source to $destination (node_modules, android, .git and .expo are excluded)…"
$arguments = @(
  $source,
  $destination,
  '/MIR',
  '/XD', 'node_modules', 'android', '.git', '.expo',
  '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
)
if ($WhatIf) { $arguments += '/L' }

& robocopy @arguments | Out-Null
$code = $LASTEXITCODE
if ($code -ge 8) {
  throw "robocopy failed with exit code $code"
}

if (-not (Test-Path (Join-Path $destination 'node_modules'))) {
  Write-Warning "C:\folio\node_modules is missing. Run npm install in C:\folio, then re-link the workspace node_modules junction."
}

Write-Host "Mirror up to date (robocopy exit $code)."
