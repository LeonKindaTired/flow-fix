# FlowFix: Validation and Demo Plan

## 1. One-command checks

Create and maintain `scripts/check.sh` at the repository root. It must stop on the first failing command (`set -euo pipefail`) and run:

```bash
#!/usr/bin/env bash
set -euo pipefail

(cd mobile && npm ci && npm run lint && npm run typecheck)
(cd dashboard && npm ci && npm run lint && npm run typecheck && npm run build)
(cd supabase/functions && deno test --allow-env)
```

Add any project-specific unit/API contract test commands to the script once implemented. Keep network-dependent tests mocked; do not call Gemini or public OSM services in routine CI.

Run:

```bash
chmod +x scripts/check.sh
./scripts/check.sh
```

Acceptance: command exits 0 only when all included checks pass. Record environment/runtime versions if a failure is environment-specific.

`scripts/check.sh` stays offline. The live-project access check, `scripts/rls-smoke.sh` (section 4), is run separately before testing and before the demo.

## 2. Build, lint, type and generated DB types

- [ ] `npx expo-doctor` passes for mobile.
- [ ] Expo web export completes and is deployable to HTTPS.
- [ ] Dashboard production build completes.
- [ ] Mobile lint and typecheck pass.
- [ ] Dashboard lint and typecheck pass.
- [ ] Edge Function Deno tests pass.
- [ ] Generate DB types with `supabase gen types typescript`; do not hand-maintain separate DB row interfaces in mobile, Edge Function and dashboard.
- [ ] Runtime schemas still validate untrusted request/AI payloads; generated DB types do not replace runtime validation. Prefer the vision provider's structured-output (JSON schema) mode, and keep runtime validation as the safety net.
- [ ] Inspect client bundles to confirm no vision API key or service-role key is included.

## 3. Unit tests: scoring function

Scoring v1:

```text
score = Math.round((65 * severity_component + 15 * road_component + 20 * community_component) / 100)

severity_component = (severity - 1) * 25
community_component = min(corroboration_count, 5) * 20
road_component = integer weight 0..100 (unknown = 40)
```

Confidence is not scored. It only sets `needs_human_review` below the configured threshold.

Required tests:

| ID   | Input                                                                | Expected                                                                                                                                                      |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | Severity 1, unknown road (40), corroboration 0                       | Score is integer 0–100; severity contribution is 0                                                                                                            |
| S-02 | Severity 5, primary road (100), corroboration 5                      | Score is 100                                                                                                                                                  |
| S-03 | Unknown road type                                                    | Uses road fallback 40                                                                                                                                         |
| S-04 | Confidence 0.59                                                      | Sets `needs_human_review=true`; does not change score                                                                                                         |
| S-05 | Confidence 0.60 and 0.99                                             | Same score for same other inputs; review flag follows configured threshold                                                                                    |
| S-06 | Missing/null severity                                                | Returns `needs_review` or validation error; never NaN                                                                                                         |
| S-07 | Severity 0 or 6                                                      | Rejects invalid input                                                                                                                                         |
| S-08 | Confidence below 0 or above 1                                        | Rejects invalid input                                                                                                                                         |
| S-09 | A distinct reporter submits a compatible duplicate                   | Corroboration RPC increments original `corroboration_count` exactly once and original score is recalculated; repeat by same reporter does not increment again |
| S-10 | Same input twice                                                     | Identical score and score version                                                                                                                             |
| S-11 | Corroboration count above 5                                          | Community component is capped at 100                                                                                                                          |
| S-12 | Road type missing                                                    | Stable unknown-road fallback                                                                                                                                  |
| S-13 | Duplicate with different damage type                                 | Does not corroborate/merge automatically                                                                                                                      |
| S-14 | Duplicate outside configured radius                                  | Does not corroborate                                                                                                                                          |
| S-15 | Severity 4, residential (45), corroboration 0                        | Score is 56, band `high`                                                                                                                                      |
| S-16 | Severity 4, residential (45), corroboration 1                        | Score is 60, band `high`                                                                                                                                      |
| S-17 | Severity 5, residential (45), corroboration 0 then 1                 | Score is 72 (`high`), then 76 (`urgent`)                                                                                                                      |
| S-18 | Original reporter submits a compatible duplicate of their own report | Corroboration RPC changes nothing; count and score stay the same                                                                                              |
| S-19 | Band boundaries                                                      | 34 is low, 35 is medium, 54 is medium, 55 is high, 74 is high, 75 is urgent                                                                                   |

S-09, S-13, S-14, and S-18 are verified at the database level by the user's SQL test and in the F-109 integration tests. They are not scoring-only cases and are therefore not asserted as database behavior by `scoring.test.ts`.

Example assertions:

```ts
expect(scoreReport(input).score).toBeGreaterThanOrEqual(0);
expect(scoreReport(input).score).toBeLessThanOrEqual(100);
expect(Number.isInteger(scoreReport(input).score)).toBe(true);
expect(scoreReport(input)).toEqual(scoreReport(input));
expect(scoreReport({ ...input, confidence: 0.2 }).score).toBe(
  scoreReport({ ...input, confidence: 0.9 }).score
);
expect(() => scoreReport({ ...input, severity: 6 })).toThrow();
```

Bands: low 0-34, medium 35-54, high 55-74, urgent 75-100. Keep the cutoffs in one exported function and test every boundary (S-19). All score arithmetic is integer-based, so S-15 and S-16 must pass exactly with no tolerance.

## 4. API and database contract checks

### Live F-105 vision smoke verification

Verified on 2026-11-14 with a real photo using Gemini:

- `VISION_PROVIDER=gemini`
- `VISION_MODEL=gemini-3.1-flash-lite`
- `VISION_TIMEOUT_MS=12000`
- Measured latency: approximately 3 seconds.
- Validated result: `damage_type=pothole`, `severity=4`, `confidence=0.98`, `source=live_ai`.

The API key was supplied through the local environment and was not recorded here.

### Create-report contract

- [ ] Valid authenticated request with owned Storage path passes.
- [ ] Missing image path fails.
- [ ] Unauthenticated request fails.
- [ ] Path owned by a different auth UUID fails.
- [ ] Latitude outside `[-90,90]` or longitude outside `[-180,180]` fails.
- [ ] Unsupported `location_source` fails; P0 accepts GPS only.
- [ ] Missing/oversized/unsupported image fails before vision call.
- [ ] Malformed AI JSON, missing keys, unknown enum, severity outside 1–5, or confidence outside 0–1 produces safe failure/review state.
- [ ] Error shape is always `{ "error": { "code": "...", "message": "..." } }`.
- [ ] Geocoding failure does not block report persistence.
- [ ] Duplicate response includes original report ID, distance, and updated corroboration count/score when applicable.
- [ ] With `ENABLE_CORROBORATION=false`, a duplicate is still linked via `duplicate_of` but the original's `corroboration_count` and score are unchanged.

### RLS, Storage and public dashboard access

- [ ] Anonymous sign-in creates a user UUID.
- [ ] User can upload only under their own `{auth.uid()}/` Storage prefix.
- [ ] User cannot upload to another user's prefix.
- [ ] Bucket is private; unauthenticated public object fetch fails.
- [ ] `anon` can select `public_reports`.
- [ ] `anon` cannot select base `reports` or `report_confirmations`.
- [ ] `public_reports` contains no image path, reporter ID, processing error, or private data.
- [ ] Dashboard loads without judge credentials.
- [ ] No service-role key is present in browser/mobile code.
- [ ] An authenticated anonymous user can select their own `reports` rows and cannot select another user's rows.
- [ ] Clients cannot insert, update or delete `reports` directly.
- [ ] `public_reports` returns no `duplicate` or `failed` rows.
- [ ] `scripts/rls-smoke.sh` passes against the live project.

`scripts/rls-smoke.sh` (needs `SUPABASE_URL` and `SUPABASE_ANON_KEY`; run it after every migration):

```bash
#!/usr/bin/env bash
set -euo pipefail
H=(-H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY")

# anon must not read private tables (either an error or an empty array is acceptable)
for t in reports report_confirmations geocode_cache; do
  body=$(curl -s "$SUPABASE_URL/rest/v1/$t?select=*&limit=1" "${H[@]}")
  if [ "$body" != "[]" ] && ! echo "$body" | grep -q '"code"'; then
    echo "FAIL: anon can read $t"; exit 1
  fi
  echo "ok: anon blocked on $t"
done

# public_reports must not expose private columns (selecting them must error)
for c in image_path reporter_id processing_error confidence; do
  body=$(curl -s "$SUPABASE_URL/rest/v1/public_reports?select=$c&limit=1" "${H[@]}")
  if ! echo "$body" | grep -q '"code"'; then
    echo "FAIL: public_reports exposes $c"; exit 1
  fi
  echo "ok: public_reports has no $c"
done

# public_reports must be readable and must not contain duplicates
body=$(curl -s "$SUPABASE_URL/rest/v1/public_reports?select=id&status=eq.duplicate&limit=1" "${H[@]}")
[ "$body" = "[]" ] || { echo "FAIL: duplicates visible in public_reports"; exit 1; }
echo "ok: public_reports readable, no duplicates"
```

Storage upload isolation and the select-own policy need an authenticated session, so test those by hand with two anonymous sessions (two browsers) and record the result.

### PostGIS and corroboration RPC

- [ ] `find_nearby_report` finds same-type report within 20 m.
- [ ] It does not return a report outside configured radius.
- [ ] Different damage types are not auto-merged.
- [ ] `add_report_corroboration` increments once for a distinct reporter.
- [ ] Repeated confirmation from same reporter does not increment.
- [ ] Original report priority is re-scored after increment.
- [ ] Concurrent duplicate submissions do not cause lost increments (transactional update).

## 5. Geocoding verification and caching

Public Nominatim returned HTTP 403 from the Supabase Edge environment, so the live pipeline uses Photon (`GEOCODE_PROVIDER=photon` default, `GEOCODE_RADIUS_M`, provider name in the cache key). Nominatim remains selectable but is not used in production.

Verified live: Strada Cluj, Timisoara (45.747285, 21.235311) returns highway/secondary, address `Strada Cluj, Timisoara`, score 61 for severity 4. A second report at the same point became a duplicate and raised the original to 65.

Photon is a free community service with no uptime guarantee. On failure `road_type` is `unknown` and the report is still created. `create-report` returns `geocode_status` (`ok`, `cached`, or `failed`) and `geocode_error`.

The `supabase/functions/.env.example` file stays documentation only.

## 6. External tester access: HTTPS web build

This is a P0 Living Labs requirement, not an optional deployment detail.

- [ ] By hour 6, publish a skeleton Expo web build (photo, GPS, anonymous sign-in, upload) to a stable HTTPS URL and test it on two real phones. Record results before building further (F-104A).
- [ ] At least one tester outside the team opens it on their own phone.
- [ ] Recruit five or more external testers if feasible; record actual number.
- [ ] Test photo selection/upload and browser geolocation on actual target devices.
- [ ] Verify upload separately on the native app and the web build (they use different code paths).
- [ ] Record phone model (or broad model family), OS/browser, permissions and result.
- [ ] Do not require Expo Go, a developer laptop, or the tester to be on the same Wi-Fi.
- [ ] If browser camera capture is unreliable, use the photo picker/file input as the test path.
- [ ] Record any platform limitation honestly; do not claim untested devices passed.

Native Expo app remains the preferred judge demo. The web build is the low-friction tester channel.

## 7. Three priority failure scenarios

Keep failure testing focused for the 48-hour schedule:

| Failure        | Test                               | Required behavior                                                                                   |
| -------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| GPS denied     | Deny location permission           | Explain permission requirement, offer retry/open settings, block submission; no fabricated location |
| Vision failure | Mock timeout/quota/malformed JSON  | Show failure or explicitly labelled demo fallback; never present fallback as live AI                |
| Offline        | Enable airplane mode before upload | Show offline state and no-success message; do not claim a report was submitted                      |

Also enforce image size/MIME validation and geocoder caching as normal request validation, not separate exploratory failure campaigns.

## 8. Manual demo checklist

### Before judges arrive

- [ ] Confirm native Expo app works on the actual demo phone.
- [ ] Confirm Supabase project is awake and secrets are correct.
- [ ] Confirm exact vision model/key/quota with a real image request.
- [ ] Confirm Photon cache has the demo coordinate or can make one request.
- [ ] Confirm the verified Photon road-class result is recorded.
- [ ] Seed at least five synthetic reports, all marked `source='seeded_demo'`.
- [ ] Confirm dashboard is public read-only and opens without login.
- [ ] Confirm map tiles and OpenStreetMap attribution.
- [ ] Confirm a live new report appears on the dashboard.
- [ ] If demonstrating live corroboration, prepare a second anonymous session (second device or private window). Corroboration from the same session is ignored by design.
- [ ] Keep a screenshot/video backup, clearly treated as recorded evidence.
- [ ] Pre-open app and dashboard; charge device and have hotspot/network fallback.

### Airplane-mode fallback

- [ ] Turn on airplane mode.
- [ ] Show the app's offline message.
- [ ] Do not claim a report was submitted or analyzed.
- [ ] Show already-loaded dashboard/seeded demo records only if clearly labelled.
- [ ] If showing a recording, say it is a recording, not a live transaction.
- [ ] Restore network for a live workflow if requested.

### Synthetic demo records

Seed:

- One urgent/high-priority pothole.
- Two medium-priority road-surface issues.
- One low-priority crack.
- One nearby compatible corroborating submission to demonstrate the counter and re-score.

Every synthetic row must be marked `seeded_demo`. Synthetic reports must not be counted as real corroborations, interviews, testers, feedback, or Living Labs metrics. If demonstrating corroboration with seed data, label it as a simulation.

### 60-second demo script

**0–8 sec: Problem:** "Road damage reports are scattered. FlowFix turns a citizen's photo into a location-aware maintenance signal."

**8–20 sec: Citizen:** Take/select a pothole photo; show GPS capture and upload.

**20–35 sec: Glue It Together:** "Supabase validates the upload, the vision API classifies damage, Photon adds address/road context, PostGIS checks nearby reports, and a deterministic score combines severity, road importance and corroboration."

**35–48 sec: Municipality:** Show the marker, priority band, score breakdown and corroboration count on the public dashboard.

**48–60 sec: Living Labs:** "We interviewed [actual n] people at [actual times]. [Real user observation]. We changed [real change] and retested with [actual n]. [Actual before/after measurement]."

If research has not happened, do not use the Living Labs script as a claim. State what has actually been completed and what remains untested.

## 9. Living Labs evidence checklist

All files must exist, but only real observations may be entered.

### `docs/evidence/interviews.md`

- [ ] Actual timestamp for each interview.
- [ ] Participant role/type; avoid unnecessary personal identifiers.
- [ ] Questions asked and actual answers.
- [ ] Quotes distinguished from team interpretation.
- [ ] Consent noted for any quote/recording shown publicly.
- [ ] No invented participants, quotes, or backdated notes.

### `docs/evidence/feedback.md`

- [ ] Prototype version and test date/time.
- [ ] Tester was outside the team; record actual device/browser.
- [ ] Task and observed completion/failure.
- [ ] Actual comments and usability issues.
- [ ] Actual sample size and conditions.
- [ ] No fabricated feedback.

### `docs/evidence/iterations.md`

- [ ] Each change links to a real feedback/interview item.
- [ ] Record what changed, why, and when.
- [ ] Before/after screenshots or commit reference where possible.
- [ ] Record whether retest improved, worsened, or did not change the result.

### `docs/evidence/metrics.md`

Suggested measurable metrics:

- Task completion rate = completed submissions / attempted submissions.
- Median time to submit a report.
- Percentage of testers who correctly interpret priority.
- Number of duplicate/corroboration cases correctly handled in a labelled test set.
- Vision schema-valid response rate across a stated number of real API calls.

Before/after template:

| Metric                          |             Before |              After | Sample size / conditions          |
| ------------------------------- | -----------------: | -----------------: | --------------------------------- |
| Submission completion rate      | `[observed value]` | `[observed value]` | `[n, device/browser, conditions]` |
| Median submission time          | `[observed value]` | `[observed value]` | `[n, device/browser, conditions]` |
| Correct priority interpretation | `[observed value]` | `[observed value]` | `[n, task wording, conditions]`   |

If not measured, write `Not measured`. Do not estimate or invent values.

## 10. Known risks: ranked

| Rank | Risk                                                           | Likelihood  | Impact               | Mitigation                                                                                                                                                                              |
| ---: | -------------------------------------------------------------- | ----------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | Vision API quota/latency/model access fails                    | High        | High                 | Verify exact model early; timeout; honest labelled fallback                                                                                                                             |
|    2 | Expo web geolocation/photo selection fails on a tester's phone | Medium–High | High for Living Labs | Deploy the skeleton web build by hour 6 and test on two real phones (F-104A); photo picker fallback; record coverage                                                                    |
|    3 | GPS permission denied on judge demo phone                      | Medium      | High                 | Preflight permission; clear retry/settings path; use a prepared demo device                                                                                                             |
|    4 | Edge Function timeout or orchestration bug                     | Medium      | High                 | Parallelize vision and geocoding with `Promise.allSettled`; cache; persist state                                                                                                        |
|    5 | Photon returns a non-highway object or is unavailable           | Medium      | Medium               | Use unknown road class on failure; cache; no Overpass                                                                                                                                    |
|    6 | Public dashboard view/RLS misconfigured                        | Medium      | High                 | Test anon access to view and denial on base tables before demo                                                                                                                          |
|    7 | PostGIS duplicate/corroboration race or false positive         | Medium      | Medium               | Transactional RPC, unique confirmation constraint, compatible type + radius                                                                                                             |
|    8 | Supabase free-tier quota/project pause                         | Low–Medium  | High                 | Verify current limits; keep seed and recording fallback                                                                                                                                 |
|    9 | Team cannot finish broad scope with one coder                  | Medium      | High                 | P0 only first; non-coders own research/testing; defer manual pin and optional detail; at hour 14 apply the cut rule (`ENABLE_CORROBORATION=false`) if the vertical slice is not working |
|   10 | Living Labs evidence is incomplete or misleading               | Medium      | High for award       | Timestamp interviews from hour 0; external testers on own phones; preserve raw notes                                                                                                    |

## 11. Release gate

Do not call the MVP demo-ready until all P0 items pass:

- [ ] Photo can be selected/captured and compressed.
- [ ] GPS works; denied permission shows retry/settings guidance and blocks invalid submission.
- [ ] At least one external tester who is not on the team completed a submission on their own phone using the HTTPS web build.
- [ ] Skeleton web build was tested on two real phones by hour 6, with results recorded.
- [ ] Anonymous Auth session is created.
- [ ] Photo uploads to private Storage under the user's own UUID path.
- [ ] Edge Function validates auth, ownership, file and request.
- [ ] Vision result is valid, or fallback is explicitly labelled.
- [ ] Photon result is cached; road class is valid highway type or `unknown`.
- [ ] PostGIS duplicate lookup runs.
- [ ] A distinct corroborating reporter increments original `corroboration_count` once and triggers re-score, the original reporter cannot corroborate their own report, or `ENABLE_CORROBORATION=false` is a recorded hour-14 decision.
- [ ] Score is deterministic, versioned, and confidence is not a score input.
- [ ] Report persists in Supabase.
- [ ] Public dashboard displays safe report fields without login.
- [ ] `scripts/check.sh` passes.
- [ ] `scripts/rls-smoke.sh` passes against the live project.
- [ ] End-to-end smoke test passes.
- [ ] Living Labs claims are backed by timestamped real evidence.

### F-110 timed mobile flow

The result flow uses one submission screen: open app, tap `Create a road-damage report`, tap `Choose photo` or `Take photo`, then tap `Capture GPS and submit`—three user taps before the result. Permission prompts are system interactions. The submit button is disabled while in flight, and retries reuse the existing Storage `image_path` without uploading again.
