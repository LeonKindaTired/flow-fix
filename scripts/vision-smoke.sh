#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: ./scripts/vision-smoke.sh <image-path>" >&2
  exit 2
fi
if ! command -v deno >/dev/null 2>&1; then
  echo "Deno is required. Ensure deno is on PATH." >&2
  exit 1
fi

deno run --allow-env --allow-read scripts/vision-smoke.ts -- "$1"
