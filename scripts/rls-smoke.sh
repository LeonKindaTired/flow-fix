#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL before running this check}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY before running this check}"

header_api="apikey: ${SUPABASE_ANON_KEY}"
header_auth="Authorization: Bearer ${SUPABASE_ANON_KEY}"

check_private_table() {
  local table="$1"
  local body
  body=$(curl.exe -sS -H "$header_api" -H "$header_auth" \
    "${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1")
  if [ "$body" != "[]" ] && ! printf '%s' "$body" | grep -q '"code"'; then
    echo "FAIL: anon can read ${table}"
    exit 1
  fi
  echo "ok: anon blocked on ${table}"
}

check_private_table reports
check_private_table report_confirmations
check_private_table geocode_cache

for column in image_path reporter_id processing_error confidence; do
  body=$(curl.exe -sS -H "$header_api" -H "$header_auth" \
    "${SUPABASE_URL}/rest/v1/public_reports?select=${column}&limit=1")
  if ! printf '%s' "$body" | grep -q '"code"'; then
    echo "FAIL: public_reports exposes ${column}"
    exit 1
  fi
  echo "ok: public_reports has no ${column}"
done

body=$(curl.exe -sS -H "$header_api" -H "$header_auth" \
  "${SUPABASE_URL}/rest/v1/public_reports?select=id&status=eq.duplicate&limit=1")
if [ "$body" != "[]" ]; then
  echo "FAIL: duplicates visible in public_reports"
  exit 1
fi
echo "ok: public_reports readable, no duplicates"

check_rpc_blocked() {
  local rpc="$1"
  local payload="$2"
  local response
  local status
  local body
  response=$(curl.exe -sS -X POST -H "$header_api" -H "$header_auth" \
    -H "Content-Type: application/json" \
    --data-raw "$payload" -w '\n%{http_code}' \
    "${SUPABASE_URL}/rest/v1/rpc/${rpc}")
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "FAIL: anon RPC call succeeded for ${rpc}"
    exit 1
  fi
  if ! printf '%s' "$body" | grep -q '"code"'; then
    echo "FAIL: anon RPC call did not return a permission error for ${rpc}"
    exit 1
  fi
  echo "ok: anon blocked from RPC ${rpc}"
}

check_rpc_blocked find_nearby_report \
  '{"p_lat":45,"p_lon":25,"p_radius_m":20,"p_damage_type":"pothole","p_exclude_id":null}'
check_rpc_blocked add_report_corroboration \
  '{"p_original_report_id":"00000000-0000-0000-0000-000000000001","p_corroborating_report_id":"00000000-0000-0000-0000-000000000002","p_reporter_id":"00000000-0000-0000-0000-000000000002"}'

echo "manual: verify anonymous sign-in, select-own reports, cross-user denial, and storage folder isolation with two sessions"

