# FlowFix: AI Coding Agent TODO

## Agent rules

1. Work in small tasks; finish and verify each before starting the next.
2. Never invent interviews, quotes, user feedback, timestamps, adoption, or metrics. Keep placeholders until the team records real evidence.
3. Never expose API keys or the service-role key in client code.
4. Keep exactly five components: Expo app, Supabase, one vision API, OSM/Photon, Next.js dashboard. No Overpass and no separate backend.
5. Use TypeScript and runtime validation for all external payloads.
6. Keep scoring deterministic, explainable, versioned, and unit-tested.
7. Do not invent location, AI results, road class, or test outcomes. Use explicit errors/unknown values or a clearly labelled demo fixture.
8. Leon is the only primary coder. Teammate 1 owns interviews/recruitment/evidence; Teammate 2 owns tester onboarding, UX observation, feedback capture, and demo operations. Both recruit external testers.
9. After each task, report changed files, commands run, and remaining failures.
10. Protect the vertical slice. Do not build optional features before the P0 path works.
11. Hour-14 cut rule: if the vertical slice (photo to dashboard) is not working end to end by hour 14, set `ENABLE_CORROBORATION=false` and demote F-107B to P1. Do not spend more time on it.
12. Test web and native separately. A feature is not done until it works in the HTTPS web build on a real phone.

**Priority:** P0 = required for demo/research path; P1 = reliability or useful fallback; P2 = optional polish.

## Phase 0: Setup + early Living Labs (0–3h)

### F-001 [P0] Create repository structure

- **Description:** Create the project tree in `PROJECT_STRUCTURE.md`, initialize Expo and Next.js, and create docs/evidence templates.
- **Files:** `mobile/**`, `dashboard/**`, `supabase/**`, `scripts/**`, `docs/**`, root `README.md`, `.gitignore`.
- **Dependencies:** None.
- **Acceptance criteria:**
  - Expo and Next.js TypeScript projects start.
  - `.gitignore` excludes real environment files and build outputs.
  - `scripts/check.sh` exists, initially with clear TODO-safe checks.
  - All four evidence files exist as blank templates and explicitly prohibit fabricated entries.

### F-002 [P0] Configure Supabase schema, auth, RLS, Storage and public view

**Status:** Complete. Verified against the live Supabase project by the user on 2026-11-14: `scripts/rls-smoke.ps1` passed and an equivalent SQL-editor test ended with `ALL TESTS PASSED`. The agent could not run `supabase test db` because Docker was inaccessible to its process.

- **Description:** Create initial migration with PostGIS, `reports`, `report_confirmations`, `geocode_cache`, RPCs, safe dashboard view, anonymous Auth assumptions, and private Storage policies.
- **Files:** `supabase/migrations/001_initial_schema.sql`, `supabase/config.toml`, `scripts/rls-smoke.sh`, `docs/PROJECT_STRUCTURE.md`.
- **Dependencies:** F-001.
- **Acceptance criteria:**
  - Migration enables PostGIS and creates all three tables.
  - `reports.location` has a GiST index.
- `find_nearby_report(p_lat, p_lon, p_radius_m, p_damage_type, p_exclude_id default null)` uses `ST_DWithin`, excludes the requested ID and seeded demo rows, rejects `unknown` damage type, and returns candidate ID/distance.
  - `add_report_corroboration` inserts a unique confirmation, increments count only once, and returns the updated original in one transaction. It changes nothing when the corroborating reporter is the original report's own reporter.
  - `public_reports` exposes only approved safe columns and only rows with status `ready` or `needs_review` (no duplicate or failed rows); anon can select the view but cannot select base `reports`, `report_confirmations` or `geocode_cache`.
  - RLS lets an authenticated (anonymous-auth) user select only their own `reports` rows (`reporter_id = auth.uid()`); clients cannot insert, update or delete `reports`.
  - Anonymous Auth is enabled/documented.
- Private Storage bucket policy allows authenticated users to upload only under their own `{auth.uid()}/` folder with the approved image MIME types and 5 MB limit; uploads use `upsert=false`; no public bucket.
  - Constraints reject invalid coordinates, severity, and priority scores.
  - `scripts/rls-smoke.sh` exists and passes against the live project (see `docs/VALIDATION.md`).

### F-003 [P0] Add environment templates and scripts

- **Description:** Add `.env.example` files, missing-variable checks, and root check command.
- **Files:** `mobile/.env.example`, `dashboard/.env.example`, `scripts/check.sh`, package manifests, `docs/PROJECT_STRUCTURE.md`.
- **Dependencies:** F-001.
- **Acceptance criteria:**
  - No real secrets are committed.
  - Mobile/dashboard expose only Supabase URL and anon key.
  - Vision and service-role secrets exist only in Supabase Edge Function secrets.
  - `scripts/check.sh` runs mobile lint/typecheck, dashboard lint/typecheck/build, and Deno function tests; exits non-zero on any failure.

### F-004 [P0] Establish team roles and evidence templates

- **Description:** Confirm the 3-person split: Leon codes/integrates; Teammate 1 interviews/recruits; Teammate 2 coordinates testing, observes UX, captures feedback, and runs demo operations.
- **Files:** `docs/evidence/interviews.md`, `docs/evidence/feedback.md`, `docs/evidence/iterations.md`, `docs/evidence/metrics.md`.
- **Dependencies:** F-001.
- **Acceptance criteria:**
  - Roles and named owners are recorded by the team.
  - Templates have date, participant role, questions/task, observations, and consent notes where relevant.
  - No invented research findings are present.

### F-201 [P0] Conduct first problem interviews immediately

- **Description:** During hours 0–3, Teammate 1 conducts short interviews with available citizens, cyclists, drivers, delivery workers, or municipal/community stakeholders. Do not wait for a working prototype. Aim for five or more, but record the actual count.
- **Files:** `docs/evidence/interviews.md`.
- **Dependencies:** F-004 only.
- **Acceptance criteria:**
  - Each entry has real timestamp, participant role, questions, and actual answers.
  - Separate direct quotes from team interpretation.
  - Note which assumptions were supported, contradicted, or remain unknown.
  - No invented participants, timestamps, or quotes.

### F-005 [P0] Verify geocoder road-class behavior

- **Description:** Public Nominatim returned HTTP 403 from the Supabase Edge environment, so the live pipeline uses Photon. Nominatim remains selectable but is not used in production. Do not build an Overpass dependency.
- **Files:** `docs/VALIDATION.md`, `docs/evidence/iterations.md` only if a real design decision results.
- **Dependencies:** F-004 (can run in parallel with F-201).
- **Acceptance criteria:**
  - Use Photon with `GEOCODE_PROVIDER=photon` by default and `GEOCODE_RADIUS_M` for its radius.
  - Include the provider name in the cache key.
  - If geocoding fails, use `road_type='unknown'` and still create the report.

## Phase 1: Core flow (3–20h)

### F-101 [P0] Generate database types and validate API schemas

- **Description:** Generate TypeScript DB types from Supabase and add runtime schemas for create-report and vision JSON. Avoid hand-maintaining the same DB row type in three apps.
- **Files:** `mobile/src/types/database.types.ts`, `dashboard/src/types/database.types.ts` or shared generated output, `supabase/functions/_shared/schemas.ts`, package scripts.
- **Dependencies:** F-002.
- **Operator command:** After authenticating locally, run `supabase gen types typescript --linked > supabase/types/database.types.ts`; replace the provisional migration-derived file and rerun type checks. The agent must not run this against the remote project.
- **Acceptance criteria:**
  - Types are generated using `supabase gen types typescript`.
  - Mobile and dashboard consume generated DB types or a single committed generated file.
  - Runtime schemas validate request and AI response separately.
  - Invalid coordinates, unsupported location source, missing image path, invalid severity, invalid confidence, and unknown status fail safely.

### F-102 [P0] Build photo capture/selection and compression

- **Description:** Implement camera or photo-library selection, preview, retake, MIME validation, and compression to ≤2 MB target.
- **Files:** `mobile/app/new-report.tsx`, `mobile/src/components/PhotoPreview.tsx`, `mobile/src/lib/image.ts`, `mobile/app.json`.
- **Dependencies:** F-001.
- **Acceptance criteria:**
  - User can select/capture and preview a photo.
  - User can retake/reselect.
  - Unsupported MIME types and oversize images are rejected or compressed.
  - Clear error appears if image preparation fails.

### F-103 [P0] Implement GPS permission and retry-only denial flow

- **Description:** Request foreground location permission and capture coordinates. Manual pin picker is explicitly out of P0 scope.
- **Files:** `mobile/src/lib/location.ts`, `mobile/app/new-report.tsx`.
- **Dependencies:** F-001.
- **Acceptance criteria:**
  - Granted permission returns valid latitude/longitude.
  - Denied permission shows a clear explanation and retry/open-settings action.
  - No fabricated coordinates and no submission without valid GPS coordinates.
  - Manual pin picker is not implemented in the P0 path.

### F-104 [P0] Configure anonymous Supabase Auth and private photo upload

- **Description:** Sign in anonymously on first launch and upload to the private bucket under the current auth UUID. The migration permits nullable `reporter_id` only for `seeded_demo` rows.
- **Files:** `mobile/src/lib/supabase.ts`, `mobile/src/lib/reports.ts`, `supabase/migrations/001_initial_schema.sql`.
- **Dependencies:** F-002, F-003, F-102.
- **Acceptance criteria:**
  - A session exists before upload.
  - Storage path starts with the current `auth.uid()`.
  - Upload returns an object path, not a public URL.
  - Upload uses `upsert=false` and the bucket enforces a 5 MB image limit with JPEG/PNG/WebP MIME types.
  - User cannot upload into another user's folder.
  - Service-role key is absent from app bundle.
  - Upload works on both code paths: native (file read as ArrayBuffer, for example from base64) and web (Blob/File). Test each separately.

### F-104A [P0] Early web spike: deploy and test on real phones (target: hour 6)

- **Description:** Deploy a skeleton Expo web build to a stable HTTPS URL with photo selection, GPS capture, anonymous sign-in and private upload only. No vision, no scoring. Test it on two real phones (ideally one Android and one iOS) before building the rest.
- **Files:** `mobile/app.json`, `mobile/package.json`, deployment config, `docs/VALIDATION.md`.
- **Dependencies:** F-102, F-103, F-104.
- **Acceptance criteria:**
  - The HTTPS URL opens on two real phones that are not on the developer's network.
  - Photo selection, geolocation permission and upload each work, or the exact browser limitation is recorded together with the chosen fallback (for example file picker instead of camera).
  - Device, OS and browser are recorded for each test. Do not claim untested platforms.
  - Decision recorded: web is the tester channel, yes or no. If no, fall back to EAS Update with Expo Go and tell Teammate 2 immediately.

### F-105 [P0] Implement vision adapter and labelled fallback

- **Description:** Call the selected vision API from Edge Function only. Require JSON fields `damage_type`, `severity`, `confidence`, `summary`. Use the provider's structured-output mode (JSON response schema) if available, and keep runtime validation as the safety net. Add deterministic sample fallback only behind an explicit demo-mode flag.
- **Files:** `supabase/functions/_shared/vision.ts`, `supabase/functions/_shared/schemas.ts`.
- **Dependencies:** F-003, F-101.
- **Acceptance criteria:**
  - API key is server-side.
  - Valid response passes schema validation.
  - Missing keys, invalid enums, malformed JSON, severity outside 1–5, and confidence outside 0–1 fail safely.
  - Timeout, quota, and malformed-response failures map to stable error codes.
  - If fallback is used, response and UI clearly say `DEMO_RESULT`; never imply it came from live AI.

### F-106 [P0] Implement geocoder adapter and Postgres cache

- **Description:** Use Photon by default, keep Nominatim selectable, use returned road data only for highway results, and cache by provider plus rounded lat/lon. Do not call Overpass.
- **Files:** `supabase/functions/_shared/osm.ts`, `supabase/migrations/001_initial_schema.sql`.
- **Dependencies:** F-002, F-005.
- **Acceptance criteria:**
  - Cache hit avoids a network call.
  - Cache miss makes one identified geocoder request and persists `address_label`, `road_type`, `fetched_at`.
  - If response is not a highway object or has no usable highway type, road type is `unknown`.
  - Timeout/rate-limit failure does not block report creation.
  - Photon is a free community service with no uptime guarantee; a failure uses `road_type='unknown'` and does not block report creation.

### F-107 [P0] Implement PostGIS duplicate lookup

- **Description:** Call `supabase.rpc('find_nearby_report', ...)` to find the nearest compatible report within the configured radius (`DUPLICATE_RADIUS_METERS`, default 20 m). A match links the new report to the original with `duplicate_of` and `duplicate_distance_m`. This task does not change counts or scores.
- **Files:** `supabase/functions/_shared/duplicate.ts`, `supabase/migrations/001_initial_schema.sql`.
- **Dependencies:** F-002, F-101.
- **Acceptance criteria:**
  - SQL RPC uses PostGIS `ST_DWithin`; the Edge Function does not attempt client-side spatial SQL.
  - Same damage type inside the radius is a duplicate candidate; outside the radius it is not.
  - Different damage types are not automatically merged.
  - The new submission is retained and linked with `duplicate_of`; the original is not overwritten.
  - Duplicates are labelled as candidates, not definitive truth.

### F-107B [P0 until the hour-14 cut, then P1] Implement corroboration RPC and re-score

- **Description:** Implement `add_report_corroboration` and the re-score of the original. Gate it behind `ENABLE_CORROBORATION` (default `true`) so it can be switched off without code changes.
- **Files:** `supabase/functions/_shared/duplicate.ts`, `supabase/functions/_shared/scoring.ts`, `supabase/migrations/001_initial_schema.sql`.
- **Dependencies:** F-107, F-108.
- **Acceptance criteria:**
  - The count increments only once per `(original_report_id, reporter_id)`.
  - A compatible submission from the original report's own reporter changes nothing.
  - The original is re-scored and updated only when a new confirmation was inserted.
  - With `ENABLE_CORROBORATION=false` the RPC is not called and `corroboration_count` stays unchanged, while `duplicate_of` linking still works.
  - Concurrent submissions do not lose increments (single transaction).

### F-108 [P0] Implement explainable deterministic scoring v1

- **Description:** Implement `severity 65% + road 15% + corroboration 20%` with integer arithmetic only: `Math.round((65 * sev + 15 * road + 20 * comm) / 100)`, where `sev = (severity - 1) * 25`, `comm = min(count, 5) * 20` and `road` is an integer weight 0..100. Confidence is only a human-review threshold, not a score input.
- **Files:** `supabase/functions/_shared/scoring.ts`.
- **Dependencies:** F-101.
- **Acceptance criteria:**
  - Same input always returns same integer score 0–100 and `score_version='v1'`.
  - Severity maps from 1–5 to 0–100; road unknown uses 40; corroboration is capped at 5.
  - Confidence below configured threshold sets `needs_human_review=true` without lowering priority score.
  - Missing/invalid severity returns `needs_review`, never NaN.
  - Score breakdown is returned for dashboard explanation.
  - Worked examples pass: severity 4 + residential + 0 corroborations = 56; same with 1 = 60; severity 5 + residential + 0 = 72; severity 5 + primary + 5 = 100.
  - One exported band function: low 0-34, medium 35-54, high 55-74, urgent 75-100, with boundary tests at 34/35, 54/55 and 74/75.

### F-109 [P0] Implement create-report Edge Function (complete task)

- **Description:** Orchestrate authentication, request validation, ownership check for the private Storage object, report creation, parallel enrichment, duplicate/corroboration handling, scoring, and persistence.
- **Files:** `supabase/functions/create-report/index.ts`, `supabase/functions/_shared/{schemas,vision,osm,duplicate,scoring}.ts`.
- **Dependencies:** F-104, F-105, F-106, F-107, F-108, plus F-107B unless cut.
- **Acceptance criteria:**
  - Reject unauthenticated requests and image paths not owned by the caller.
  - Validate image existence, MIME type, and server-side size limit before vision call.
  - Create a `processing` report row before external work.
  - Run vision and geocoding concurrently using `Promise.allSettled` with independent timeouts.
  - A vision failure sets `needs_review`/`failed` and uses a clearly labelled demo fallback only when explicit demo mode is enabled. Geocoding failure sets address null/road unknown and does not fail the report.
  - The response returns `geocode_status` (`ok`, `cached`, or `failed`) and `geocode_error`.
  - After vision classification, call PostGIS duplicate RPC. If a compatible candidate exists, retain the new report, link it as duplicate and, when `ENABLE_CORROBORATION` is true, call the transactional corroboration RPC and re-score the original only if a new confirmation was inserted.
  - For a non-duplicate, calculate score and persist result.
  - Return stable JSON/error shape and never log secrets or raw image bytes.
  - Ensure the function completes within the configured platform timeout; avoid sequential network waits.

### F-110 [P0] Build mobile submission/status flow

- **Description:** Connect anonymous sign-in, photo selection, GPS, private upload, create-report call, and result screen.
- **Files:** `mobile/app/new-report.tsx`, `mobile/app/report/[id].tsx`, `mobile/src/lib/reports.ts`, `mobile/src/components/StatusBadge.tsx`.
- **Dependencies:** F-102, F-103, F-104, F-109.
- **Acceptance criteria:**
  - One user can submit a photo with GPS and see actual processing status.
  - UI displays damage type, severity, score/band, and whether the result is live AI or demo fallback.
  - GPS denial shows retry/settings guidance; no manual pin picker in P0.
  - Vision failure shows honest failure or labelled fallback, never false success.
  - Retry does not create uncontrolled duplicate uploads.
  - The result screen reads the user's own report through the select-own RLS policy; a second anonymous session cannot see the first user's reports.

### F-111 [P0] Build public dashboard with safe read-only view

- **Description:** Build Next.js/Leaflet dashboard reading only `public_reports` with the anon key; no login or service-role key.
- **Files:** `dashboard/app/page.tsx`, `dashboard/src/components/ReportsMap.tsx`, `dashboard/src/components/ReportFilters.tsx`, `dashboard/src/components/ReportDetails.tsx`, `dashboard/src/lib/reports.ts`.
- **Dependencies:** F-002, F-109.
- **Acceptance criteria:**
  - Dashboard reads only safe columns from `public_reports`.
  - Judges can open it without credentials.
  - Load Leaflet map with `next/dynamic` and `ssr:false`.
  - Use `CircleMarker` with priority-based colors; do not rely on default Leaflet marker image paths.
  - Show OSM attribution, loading/empty/error states, report details, corroboration count, and score explanation.
  - Never display private image paths, reporter IDs, or processing errors.
  - Duplicate and failed rows never render as markers (the view excludes them; verify in the UI).

### F-112 [P0] Publish HTTPS Expo web build for external testers

- **Description:** Redeploy the full Expo web build to the same stable HTTPS URL used in F-104A. Teammates send the link/QR to at least five people outside the team for own-phone testing.
- **Files:** `mobile/app.json`, `mobile/package.json`, deployment config, `docs/VALIDATION.md`.
- **Dependencies:** F-104A, F-110.
- **Acceptance criteria:**
  - HTTPS URL opens on at least one Android and one iOS browser if available; record actual device/browser coverage.
  - External tester can select a photo and grant geolocation, or a documented browser limitation is recorded.
  - Testers do not need to install Expo Go or connect to a developer machine.
  - If web camera capture fails, photo library/file selection still allows completion.
  - URL and tested devices are recorded; do not claim unsupported platforms passed.

### F-113 [P0] End-to-end vertical-slice smoke test

- **Description:** Verify photo upload → vision → Photon/cache → PostGIS duplicate check → scoring → database → public dashboard.
- **Files:** `docs/VALIDATION.md`, test fixtures/scripts, implementation files only for fixes.
- **Dependencies:** F-109, F-110, F-111.
- **Acceptance criteria:**
  - One real photo completes the workflow, or explicit demo fallback is labelled.
  - Report row and score persist.
  - Duplicate lookup executes.
  - Dashboard marker and details display.
  - Test records whether each external integration was live, cached, unknown, or demo fallback.

## Phase 2: User testing (20–28h)

### F-202 [P0] Run first prototype usability tests

- **Description:** Teammate 2 coordinates at least five external testers if feasible. Each uses their own phone and the HTTPS web URL; ask them to complete a submission and explain the result.
- **Files:** `docs/evidence/feedback.md`, `docs/evidence/metrics.md`.
- **Dependencies:** F-112, F-201.
- **Acceptance criteria:**
  - Record actual participant count, device/browser, task, completion/failure, time, and verbatim feedback where consented.
  - Distinguish observed behavior from participant opinion.
  - If fewer than five people participate, record the actual number.
  - No invented or inferred feedback is written as fact.

### F-203 [P1] Select highest-impact iteration

- **Description:** Rank real feedback by user impact and implementation effort; choose one or two changes that fit the remaining time.
- **Files:** `docs/evidence/feedback.md`, `docs/evidence/iterations.md`.
- **Dependencies:** F-202.
- **Acceptance criteria:**
  - Every selected change links to a real feedback item.
  - Record why it was selected and what was deferred.
  - Do not claim consensus from a small sample.

## Phase 3: Fixes and retest (28–40h)

### F-301 [P0] Implement selected Living Labs change

- **Description:** Implement one or two high-impact changes supported by actual user feedback, without destabilizing the vertical slice.
- **Files:** Only affected source files; `docs/evidence/iterations.md`.
- **Dependencies:** F-203.
- **Acceptance criteria:**
  - Each change references a real feedback item.
  - Existing P0 smoke test still passes.
  - Record commit/version and before state.

### F-302 [P0] Retest with external users

- **Description:** Repeat the same task with external testers on their own phones, using the same metric definitions.
- **Files:** `docs/evidence/feedback.md`, `docs/evidence/metrics.md`, `docs/evidence/iterations.md`.
- **Dependencies:** F-301.
- **Acceptance criteria:**
  - Record actual retest sample size, device/browser, and conditions.
  - Compare before/after only when measurement definitions are comparable.
  - Report mixed/no improvement honestly.
  - Never fill missing values with estimates.

### F-303 [P1] Test the three likely demo failures

- **Description:** Test only the highest-value failure cases for the hackathon: GPS denied, vision provider failure with clearly labelled fallback, and offline/no network.
- **Files:** `mobile/**`, `supabase/functions/**`, `docs/VALIDATION.md`.
- **Dependencies:** F-113.
- **Acceptance criteria:**
  - GPS denial gives retry/settings guidance and prevents invalid submission.
  - Vision failure is visible; demo fallback is explicitly labelled and never presented as live AI.
  - Offline mode shows a clear message and never claims a report was submitted.
  - No silent false-success state.

### F-304 [P1] Seed synthetic demo reports

- **Description:** Add repeatable synthetic reports for map presentation, separate from real submissions and all research evidence.
- **Files:** `supabase/seed.sql`, dashboard filters.
- **Dependencies:** F-111.
- **Acceptance criteria:**
  - All synthetic rows use `source='seeded_demo'`.
  - Dashboard labels or filters seeded records.
  - Seed script is repeatable.
  - Synthetic records never count as users, corroborations, interviews, feedback, or metrics.

## Phase 4: Polish and pitch (40–48h)

### F-401 [P0] Run one-command release checks

- **Description:** Run `scripts/check.sh` and the end-to-end smoke test on the exact demo environment.
- **Files:** `scripts/check.sh`, `docs/VALIDATION.md`, release-blocking source files only.
- **Dependencies:** F-113, F-301, F-302.
- **Acceptance criteria:**
  - One command runs mobile lint/typecheck, dashboard lint/typecheck/build, and Deno tests.
  - All P0 checks pass or remaining failures are explicitly disclosed.
  - No secrets are present in client bundles.
  - `scripts/rls-smoke.sh` passes against the live project (run separately; it needs network).
  - End-to-end smoke test passes.

### F-402 [P0] Rehearse 60-second demo

- **Description:** Rehearse the live vertical slice and fallback with two team members operating/narrating.
- **Files:** `docs/VALIDATION.md`, pitch notes.
- **Dependencies:** F-401.
- **Acceptance criteria:**
  - Demo fits 60 seconds.
  - Live AI, cached OSM, unknown road type, and demo fallback are described accurately.
  - Backup screenshot/video exists but is not represented as live behavior.
  - If corroboration is shown live, it uses two distinct anonymous sessions (two devices, or one device plus a private window). Otherwise it is labelled as a simulation on seeded data.

### F-403 [P0] Assemble Glue It Together and Living Labs evidence

- **Description:** Prepare architecture integration proof and timestamped user-testing/iteration evidence.
- **Files:** `docs/evidence/**`, presentation assets.
- **Dependencies:** F-201, F-202, F-301, F-302.
- **Acceptance criteria:**
  - Glue It Together slide traces actual data across Expo, Supabase, vision, Photon, PostGIS and dashboard.
  - Living Labs evidence contains real timestamps, participant counts, feedback and before/after measurements.
  - Missing evidence is explicitly labelled missing; no fabricated proof.

### F-404 [P1] Final UX and pitch polish

- **Description:** Improve score explanation, status messaging, filters, map legend, accessibility, and concise pitch.
- **Files:** `mobile/**`, `dashboard/**`, pitch notes.
- **Dependencies:** F-401.
- **Acceptance criteria:**
  - A first-time user understands how to submit.
  - Score weights and corroboration meaning are visible.
  - OSM attribution is visible.
  - AI result is clearly described as preliminary triage, not official inspection.
