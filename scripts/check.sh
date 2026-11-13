#!/usr/bin/env bash
set -euo pipefail

echo "F-001 scaffold checks (feature checks remain TODO until their tasks)."

test -f mobile/package.json
test -f mobile/tsconfig.json
test -f dashboard/package.json
test -f dashboard/tsconfig.json
test -f .gitignore
test -f docs/evidence/interviews.md
test -f docs/evidence/feedback.md
test -f docs/evidence/iterations.md
test -f docs/evidence/metrics.md

echo "TODO: install dependencies and run app-specific checks after F-003."
echo "F-001 scaffold checks passed."

