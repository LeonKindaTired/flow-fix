#!/usr/bin/env bash
set -euo pipefail

echo "FlowFix checks"

test -f mobile/package.json
test -f mobile/tsconfig.json
test -f dashboard/package.json
test -f dashboard/tsconfig.json
test -f .gitignore
test -f docs/evidence/interviews.md
test -f docs/evidence/feedback.md
test -f docs/evidence/iterations.md
test -f docs/evidence/metrics.md
test -f mobile/.env.example
test -f dashboard/.env.example
test -f supabase/functions/.env.example
test -f supabase/functions/_shared/schemas.ts
test -f supabase/types/database.types.ts
test -f mobile/src/lib/image.ts
test -f mobile/src/lib/location.ts
test -f mobile/src/lib/supabase.ts
test -f mobile/src/lib/reports.ts

npm --prefix mobile run lint
npm --prefix mobile run typecheck
npm --prefix mobile run export:web
npm --prefix dashboard run lint
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
if ! command -v deno >/dev/null 2>&1; then
  echo "Deno is required for Supabase function tests. Install Deno and ensure deno is on PATH." >&2
  exit 1
fi
deno test --allow-env supabase/functions

echo "FlowFix checks passed."

