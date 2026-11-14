$ErrorActionPreference = 'Stop'

Write-Output 'FlowFix checks'

$requiredFiles = @(
    'mobile/package.json',
    'mobile/tsconfig.json',
    'dashboard/package.json',
    'dashboard/tsconfig.json',
    '.gitignore',
    'docs/evidence/interviews.md',
    'docs/evidence/feedback.md',
    'docs/evidence/iterations.md',
    'docs/evidence/metrics.md',
    'mobile/.env.example'
    'dashboard/.env.example'
    'supabase/functions/.env.example'
    'supabase/functions/_shared/schemas.ts'
    'supabase/types/database.types.ts'
    'mobile/src/lib/image.ts'
    'mobile/src/lib/location.ts'
    'mobile/src/lib/supabase.ts'
    'mobile/src/lib/reports.ts'
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Missing required scaffold file: $file"
    }
}

npm.cmd --prefix mobile run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd --prefix mobile run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd --prefix mobile run export:web
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd --prefix dashboard run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd --prefix dashboard run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd --prefix dashboard run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Get-Command deno.cmd -ErrorAction SilentlyContinue)) {
    throw 'Deno is required for Supabase function tests. Install Deno and ensure deno.cmd is on PATH.'
}
deno.cmd test --allow-env supabase/functions
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output 'FlowFix checks passed.'

