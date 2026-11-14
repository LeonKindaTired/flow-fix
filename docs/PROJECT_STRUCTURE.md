# FlowFix: Project Structure

## Architecture decisions

**Goal:** a citizen submits a road-damage photo and location; FlowFix enriches it, checks for corroboration/duplicates, calculates an explainable priority, and displays it to municipal users.

**Five components only**

1. Expo / React Native app (native app for the judge demo; Expo web export for external testers).
2. Supabase (Postgres + PostGIS + Storage + Edge Functions + anonymous Auth).
3. One vision API (evaluate Google Gemini API first; verify current free-tier eligibility and quotas before choosing the exact model).
4. OpenStreetMap / Photon (Komoot) (reverse geocoding and best-effort road class).
5. Next.js dashboard with Leaflet.

The scoring function, duplicate logic, cache, and public dashboard view are part of Supabase, not separate components. Do not add Overpass, a separate API server, or another database.

**Team:** 3 people. Leon is the primary coder and integration owner. Teammate 1 owns interview recruitment, interviews, and evidence notes. Teammate 2 owns tester onboarding, UX observation, feedback capture, and demo operations. Both non-coders should be involved in recruiting at least five external testers and getting the prototype onto their own phones.

## Critical implementation choices

- Start Living Labs interviews in hours 0–3, before implementation decisions harden.
- Use Expo web export at an HTTPS URL for external phone testing; keep the native Expo app as the judge-demo path. Validate camera/photo selection and geolocation on the actual target mobile browsers early. If browser camera capture is unreliable, use the photo library/file picker for testing.
- Use anonymous Supabase Auth. Each app installation signs in anonymously; use the authenticated user's UUID for Storage paths and report ownership.
- Keep `report-photos` private. The client uploads only to its own `{auth.uid()}/...` folder. Edge Functions use server-side credentials.
- Public dashboard access is read-only through a carefully scoped `public_reports` view. Do not expose `image_path`, `processing_error`, reporter IDs, or the base table to `anon`.
- Use PostGIS and an SQL RPC for nearby-report lookup. `supabase-js` cannot express `ST_DWithin` directly.
- Use a 20 m initial duplicate radius, configurable in one place. A same-type nearby submission becomes a corroborating report, not a discarded report.
- Each accepted corroborating submission increments `corroboration_count` on the original and triggers a re-score of the original. Prevent one anonymous user from inflating the same report repeatedly with a unique confirmation record, and ignore corroboration from the original report's own reporter. Anonymous identities reset when browser storage is cleared, so corroboration is a rough signal.
- Public Nominatim returned HTTP 403 from the Supabase Edge environment, so the live pipeline uses Photon (`GEOCODE_PROVIDER=photon` default, `GEOCODE_RADIUS_M`, provider name in the cache key). Nominatim remains selectable but is not used in production.
- Run vision and Photon enrichment concurrently with `Promise.allSettled` (with timeouts). Cache results in Postgres (the cache mainly helps retries and repeated demo coordinates, because real GPS fixes rarely repeat to 5 decimals). A geocoding failure must not block a valid report.
- AI confidence is not part of the priority score. Use it only as a review signal (e.g. below 0.60 => `needs_human_review=true`).
- The score is a triage aid, not an engineering or official road-safety assessment.
- No offline submission claim: airplane mode must show a clear offline state. The dashboard can use already-loaded/seeded demo data, visibly labelled.
- Spike the web build early. By hour 6, deploy a skeleton Expo web build (photo selection, GPS, anonymous sign-in, private upload) to HTTPS and test it on two real phones. Web-specific failures are the most likely Living Labs blocker, so find them before the rest of the app exists.
- Upload has two code paths. Native needs the file read as an ArrayBuffer (for example from base64); web uses a Blob/File. Implement and test both in `reports.ts`.
- Scope cut rule. At hour 14, if the vertical slice (photo to dashboard) does not run end to end, set `ENABLE_CORROBORATION=false`. Duplicate lookup still links `duplicate_of`, but the count increment and re-score are skipped.

## Folder tree

```text
flowfix/
├── mobile/
│   ├── app/
│   │   ├── _layout.tsx                 # Expo Router root layout
│   │   ├── index.tsx                   # Home and recent submissions
│   │   ├── new-report.tsx              # Photo + GPS + upload workflow
│   │   └── report/[id].tsx             # Processing/result status screen
│   ├── src/
│   │   ├── components/
│   │   │   ├── PhotoPreview.tsx        # Photo preview and retake
│   │   │   └── StatusBadge.tsx         # Uploaded/processing/ready/failed states
│   │   ├── lib/
│   │   │   ├── supabase.ts             # Supabase client and anonymous session
│   │   │   ├── location.ts             # Foreground GPS permission and location
│   │   │   ├── image.ts                # Resize/compress and MIME validation
│   │   │   └── reports.ts              # Storage upload and Edge Function calls
│   │   └── types/
│   │       └── report.ts               # Client report types generated from DB types
│   ├── assets/
│   │   └── demo-pothole.jpg            # Redistributable demo image, with source note
│   ├── app.json                        # Expo config and native permissions
│   ├── package.json                    # Mobile dependencies/scripts
│   └── tsconfig.json                   # TypeScript configuration
├── supabase/
│   ├── functions/
│   │   ├── create-report/
│   │   │   └── index.ts                # Orchestrates vision, geocode, duplicate and score
│   │   ├── get-reports/
│   │   │   └── index.ts                # Optional authenticated detail/status endpoint
│   │   └── _shared/
│   │       ├── cors.ts                 # Shared CORS headers
│   │       ├── schemas.ts              # Runtime request and AI response validation
│   │       ├── vision.ts               # Vision API adapter and strict parser
│   │       ├── osm.ts                  # Photon/Nominatim reverse geocoding + cache access
│   │       ├── duplicate.ts             # Calls PostGIS RPC and records corroboration
│   │       ├── scoring.ts              # Pure, versioned score function (integer arithmetic)
│   │       ├── scoring.test.ts         # Deno unit tests: formula, bands, boundaries
│   │       └── schemas.test.ts         # Deno tests: request and AI response validation
│   ├── migrations/
│   │   └── 001_initial_schema.sql      # Tables, PostGIS RPC, view, RLS and Storage policies
│   ├── seed.sql                       # Clearly labelled synthetic dashboard records
│   └── config.toml                    # Supabase local/function configuration
├── dashboard/
│   ├── app/
│   │   ├── page.tsx                   # Public read-only municipal dashboard
│   │   └── layout.tsx                 # Dashboard shell
│   ├── src/
│   │   ├── components/
│   │   │   ├── ReportsMap.tsx          # Leaflet map with colored circle markers
│   │   │   ├── ReportFilters.tsx       # Priority/status filters
│   │   │   └── ReportDetails.tsx       # Selected report and score breakdown
│   │   └── lib/
│   │       ├── supabase.ts             # Browser-safe anon client
│   │       └── reports.ts              # Reads only public_reports view
│   ├── public/                         # Static assets
│   ├── package.json                    # Dashboard dependencies/scripts
│   └── tsconfig.json                   # TypeScript configuration
├── scripts/
│   ├── check.sh                        # One-command checks for mobile/dashboard/functions
│   └── rls-smoke.sh                    # Live check that anon cannot read private tables or columns
└── docs/
    ├── PROJECT_STRUCTURE.md            # This file
    ├── TODO.md                         # Agent execution plan
    ├── VALIDATION.md                   # Tests, demo and release gates
    └── evidence/
        ├── interviews.md               # Real interview notes only
        ├── feedback.md                 # Real usability observations only
        ├── iterations.md                # Feedback-linked product changes
        └── metrics.md                  # Measured values and before/after results
```

## Data model

Use UUID primary keys and UTC `timestamptz`. Enable PostGIS. Store location as `geography(Point,4326)` (and expose numeric latitude/longitude in the safe view if convenient).

### `reports`

| Field                  | Type                    | Purpose / constraints                                                    |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `id`                   | `uuid`                  | Primary key                                                              |
| `created_at`           | `timestamptz`           | Default `now()`                                                          |
| `updated_at`           | `timestamptz`           | Updated on processing/re-score                                           |
| `reporter_id`          | `uuid`                  | Nullable for `seeded_demo`; otherwise `auth.users.id`                   |
| `status`               | `text`                  | `uploaded`, `processing`, `ready`, `failed`, `needs_review`, `duplicate` |
| `image_path`           | `text`                  | Private Storage object path; never in public view                        |
| `location`             | `geography(Point,4326)` | Required report point                                                    |
| `latitude`             | `double precision`      | Optional denormalized coordinate for simple client display               |
| `longitude`            | `double precision`      | Optional denormalized coordinate for simple client display               |
| `location_source`      | `text`                  | `gps` only for MVP                                                       |
| `address_label`        | `text`                  | Nullable geocoder label                                                   |
| `road_type`            | `text`                  | OSM highway class or `unknown`                                           |
| `damage_type`          | `text`                  | `pothole`, `crack`, `surface_damage`, `other`, `unknown`                 |
| `severity`             | `smallint`              | 1–5; nullable before analysis                                            |
| `confidence`           | `numeric(4,3)`          | 0–1; review signal only, not scored                                      |
| `ai_summary`           | `text`                  | Short factual model description                                          |
| `priority_score`       | `smallint`              | 0–100                                                                    |
| `priority_band`        | `text`                  | `low`, `medium`, `high`, `urgent`                                        |
| `score_version`        | `text`                  | `v1`                                                                     |
| `corroboration_count`  | `integer`               | Default 0; distinct corroborating reporters                              |
| `duplicate_of`         | `uuid`                  | Nullable FK to original report                                           |
| `duplicate_distance_m` | `integer`               | Distance to original                                                     |
| `needs_human_review`   | `boolean`               | Default false; true for low confidence/uncertain context                 |
| `processing_error`     | `text`                  | Safe error code only; never provider secrets/raw payloads                |
| `source`               | `text`                  | `citizen` or `seeded_demo`                                               |

### `report_confirmations`

| Field                     | Type          | Purpose                              |
| ------------------------- | ------------- | ------------------------------------ |
| `id`                      | `uuid`        | Primary key                          |
| `original_report_id`      | `uuid`        | FK to corroborated report            |
| `corroborating_report_id` | `uuid`        | FK to new nearby report              |
| `reporter_id`             | `uuid`        | Anonymous-auth user who submitted it |
| `created_at`              | `timestamptz` | Default `now()`                      |

Add a unique constraint on `(original_report_id, reporter_id)` so one account can corroborate a given original only once. The RPC must also refuse a confirmation when `reporter_id` equals the original report's own `reporter_id`. Create the confirmation and increment `reports.corroboration_count` transactionally through an SQL RPC. A repeated submission by the same user must not increment the count again.

### `geocode_cache`

| Field               | Type           | Purpose                                                 |
| ------------------- | -------------- | ------------------------------------------------------- |
| `cache_key`         | `text`         | Primary key; rounded lat/lon key, e.g. 5 decimal places |
| `latitude_rounded`  | `numeric(8,5)` | Rounded latitude                                        |
| `longitude_rounded` | `numeric(8,5)` | Rounded longitude                                       |
| `address_label`     | `text`         | Nullable reverse-geocoded label                         |
| `road_type`         | `text`         | OSM highway class or `unknown`                          |
| `fetched_at`        | `timestamptz`  | Cache timestamp                                         |

### Database functions, indexes, and access

- Enable `postgis`.
- Add GiST index on `reports.location`; indexes on `reports(status)`, `reports(priority_score desc)`, and `reports(created_at desc)`.
- Create SQL RPC `find_nearby_report(p_lat, p_lon, p_radius_m, p_damage_type, p_exclude_id default null)` using `ST_DWithin(location, ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography, radius)` and compatible non-`unknown` damage type. Exclude `p_exclude_id` and `source='seeded_demo'`; return nearest candidate ID and distance.
- Create transactional RPC `add_report_corroboration(p_original_report_id, p_corroborating_report_id, p_reporter_id)`: return without changes if `p_reporter_id` equals the original report's `reporter_id`; otherwise insert into `report_confirmations` with `ON CONFLICT DO NOTHING`; only if inserted, increment `corroboration_count`, then return the updated original. Re-score that original in the Edge Function using the same score function.
- Create `public_reports` view restricted to rows whose `status` is `ready` or `needs_review` (duplicate and failed rows never reach the map), with only safe fields: ID, created time, latitude, longitude, address label, road type, damage type, severity, priority score/band, corroboration count, status, and source. Exclude `image_path`, `reporter_id`, `processing_error`, confidence, and private details. Grant `SELECT` to `anon`; revoke anon access to `reports` and `report_confirmations`. Use a tightly scoped view and test its actual privileges/RLS behavior.
- Enable anonymous sign-in in Supabase Auth.
- Add an RLS policy on `reports`: authenticated users (anonymous users included) may `select` only rows where `reporter_id = auth.uid()`, and clients get no insert, update or delete on `reports`. The mobile result screen reads through this policy. Verify with `scripts/rls-smoke.sh` and a second session.
- Private Storage bucket `report-photos`: authenticated users may insert/read only objects under their own `{auth.uid()}/` folder. Edge Functions with server-side service credentials may read uploaded objects. Do not create a public bucket.
- Do not expose the service-role key in mobile or dashboard bundles.

## Priority score v1

AI confidence is **not** a score component. It only sets `needs_human_review` when confidence is below a configured threshold (initially 0.60; tune only from validation evidence).

```text
priority = Math.round(
  (65 * severity_component + 15 * road_component + 20 * community_component) / 100
)  // all components are integers 0..100, so no floating-point weights

severity_component = (severity - 1) * 25
road_component = configured road importance (0..100)
community_component = min(corroboration_count, 5) * 20
```

Initial road weights (product assumptions, not official safety ratings): `primary=100`, `secondary=80`, `tertiary=65`, `residential=45`, `service=25`, `footway=20`, `unknown=40`.

When a nearby compatible report is found:

1. Insert the new report and mark it as `duplicate` with `duplicate_of` and distance; do not discard the submission.
2. If `ENABLE_CORROBORATION` is true, call `add_report_corroboration` with the original report and current reporter. It ignores the original report's own reporter.
3. If a new confirmation was inserted, increment the original's `corroboration_count` transactionally.
4. Recalculate and persist the original report's priority score/band.
5. Return both the new report's duplicate status and the updated original report score.

A distinct reporter is a rough corroboration signal, not proof of independent verification. Add basic rate limits and keep the score explanation visible.

### Priority bands and worked examples

Bands live in one exported function in `scoring.ts`: `low` 0-34, `medium` 35-54, `high` 55-74, `urgent` 75-100.

Use integer arithmetic so rounding never drifts. Worked examples (these are also test fixtures):

| Severity | Road             | Corroborations | Calculation                             | Score | Band   |
| -------: | ---------------- | -------------: | --------------------------------------- | ----: | ------ |
|        4 | residential (45) |              0 | (65*75 + 15*45 + 20\*0) / 100 = 55.5    |    56 | high   |
|        4 | residential (45) |              1 | (65*75 + 15*45 + 20\*20) / 100 = 59.5   |    60 | high   |
|        5 | residential (45) |              0 | (65*100 + 15*45) / 100 = 71.75          |    72 | high   |
|        5 | residential (45) |              1 | (65*100 + 15*45 + 20\*20) / 100 = 75.75 |    76 | urgent |
|        5 | primary (100)    |              5 | (6500 + 1500 + 2000) / 100              |   100 | urgent |
|        1 | unknown (40)     |              0 | (0 + 600) / 100                         |     6 | low    |

A single severity-5 report on a residential street scores 72 (high). Urgent needs a major road or at least one corroboration. That is intentional; tune only from real feedback.

## API contracts

### Upload photo

`POST /storage/v1/object/report-photos/{auth.uid}/{filename}`

- Binary JPEG/PNG/WebP, compressed to ≤2 MB where practical. Upload with `upsert=false` so retries do not overwrite an existing object.
- Client must have an anonymous authenticated session.
- Storage policy checks the first path segment against `auth.uid()`.

### Create report

`POST /functions/v1/create-report`

Request:

```json
{
  "image_path": "user-uuid/8b1d-photo.jpg",
  "latitude": 45.7489,
  "longitude": 21.2087,
  "location_source": "gps"
}
```

Response for a new report:

```json
{
  "report_id": "report-uuid",
  "status": "ready",
  "damage_type": "pothole",
  "severity": 4,
  "confidence": 0.91,
  "road_type": "residential",
  "priority_score": 56,
  "priority_band": "high",
  "corroboration_count": 0,
  "needs_human_review": false,
  "geocode_status": "ok",
  "geocode_error": null
}
```

Response when corroborating an existing report:

```json
{
  "report_id": "new-report-uuid",
  "status": "duplicate",
  "duplicate_of": "original-report-uuid",
  "duplicate_distance_m": 8,
  "geocode_status": "cached",
  "geocode_error": null,
  "original_report": {
    "priority_score": 60,
    "priority_band": "high",
    "corroboration_count": 1
  }
}
```

Error response:

```json
{
  "error": {
    "code": "VISION_FAILED",
    "message": "Image analysis is temporarily unavailable."
  }
}
```

Stable error codes: `INVALID_REQUEST`, `UNAUTHORIZED`, `IMAGE_NOT_FOUND`, `IMAGE_TOO_LARGE`, `VISION_FAILED`, `VISION_INVALID_RESPONSE`, `GEOCODING_FAILED`, `DATABASE_ERROR`.

### Public dashboard data

`GET /rest/v1/public_reports?select=*&order=priority_score.desc`

Read with the Supabase anon key. This endpoint reads only the safe view; it does not require judge login. Do not call a protected `get-reports` function from the public dashboard.

Example row:

```json
{
  "id": "report-uuid",
  "latitude": 45.7489,
  "longitude": 21.2087,
  "address_label": "Example Street, Timișoara",
  "road_type": "residential",
  "damage_type": "pothole",
  "severity": 4,
  "priority_score": 60,
  "priority_band": "high",
  "corroboration_count": 1,
  "status": "ready",
  "source": "citizen"
}
```

## Environment variables and services

### Mobile

| Variable                        | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | Supabase project URL                                      |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public anon key; safe only with correct RLS/view policies |

### Dashboard

| Variable                        | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key; dashboard reads only `public_reports` |

### Supabase Edge Function secrets

| Variable                             | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `SUPABASE_URL`                       | Project URL (usually injected)                             |
| `SUPABASE_SERVICE_ROLE_KEY`          | Server-side only                                           |
| `VISION_API_KEY`                     | Server-side vision API key                                 |
| `VISION_PROVIDER`                    | Configurable provider adapter, e.g. `gemini` or `openai`  |
| `VISION_MODEL`                       | Exact tested vision model ID                               |
| `VISION_TIMEOUT_MS`                  | Short vision request timeout, default `8000`               |
| `DEMO_MODE`                          | Explicitly enables labelled deterministic fallback         |
| `GEOCODE_PROVIDER`                   | `photon` by default; `nominatim` remains selectable        |
| `GEOCODE_RADIUS_M`                   | Photon search radius in metres                             |
| `NOMINATIM_BASE_URL`                 | Selectable Nominatim endpoint                             |
| `APP_CONTACT`                        | Identifying contact string for geocoder requests           |
| `DUPLICATE_RADIUS_METERS`            | Default `20`                                               |
| `VISION_CONFIDENCE_REVIEW_THRESHOLD` | Default `0.60`                                             |
| `ENABLE_CORROBORATION`               | Default `true`; set `false` to apply the hour-14 scope cut |

### Free-tier and policy caveats

- **Gemini:** Evaluate first because selected models have offered a no-cost API tier. Free eligibility, model availability, quotas, rate limits, regional access, and data-use terms change. Verify the exact model in the current official pricing/rate-limit docs and run a real image request before locking it in. Do not assume unlimited free usage. Keep sensitive faces/plates out of test images. Use the provider's structured-output mode (JSON response schema) if available, and still validate every response at runtime.
- **Supabase:** Free quotas and inactivity behavior can change; verify current limits before the event. Keep image sizes small and retention minimal. Use a local/seeded fallback for demo continuity.
- **Geocoding:** Public Nominatim returned HTTP 403 from the Supabase Edge environment, so production uses Photon (`GEOCODE_PROVIDER=photon` by default). Nominatim remains selectable but is not used in production. Photon is a free community service with no uptime guarantee. On failure `road_type` is `unknown` and the report is still created. Cache keys include provider name and `GEOCODE_RADIUS_M` configures the Photon radius.
- **OSM data/tiles:** Attribute OpenStreetMap contributors. Tile services have their own usage policies; do not treat public tiles as unrestricted production hosting.
- **No Overpass in MVP:** Photon road data is used when the returned object is a highway; otherwise `unknown`.
- **Expo web:** Camera and geolocation require HTTPS and browser permissions. Test with actual Android/iOS browsers. Use photo-library selection as fallback if web camera capture is unreliable.
- **Leaflet:** Use `next/dynamic` with `ssr: false` for the map component in Next.js. Use `CircleMarker` rather than default marker icon assets to avoid bundler icon-path issues and to encode priority color.

## MVP acceptance boundary

The MVP is complete when an external tester can submit a photo from their own phone using the HTTPS web build, the backend processes it (or clearly labels a vision fallback), the report is stored and scored, a nearby corroborating submission increments/re-scores the original, and the public read-only dashboard displays the result.
