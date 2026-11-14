param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ImagePath -PathType Leaf)) {
    throw "Image file not found: $ImagePath"
}
if (-not (Get-Command deno.cmd -ErrorAction SilentlyContinue)) {
    throw 'Deno is required. Ensure deno.cmd is on PATH.'
}

deno.cmd run --allow-env --allow-read scripts/vision-smoke.ts -- $ImagePath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
