import { createReportHandler, InsertConflictError, type CreateReportDeps } from './handler.ts';

const user = '11111111-1111-1111-1111-111111111111';
const imagePath = `${user}/photo.jpg`;
function request(body: unknown, token = 'token', origin = 'http://localhost:3000') { return new Request('http://localhost/functions/v1/create-report', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function base(overrides: Partial<CreateReportDeps> = {}): CreateReportDeps {
  const reports = new Map<string, any>(); let sequence = 0;
  return {
    verifyToken: async (token) => token === 'token' ? { id: user } : null,
    findExisting: async (_reporter, path) => path === imagePath && reports.get('existing') ? reports.get('existing') : null,
    abandonStale: async () => {},
    countRecent: async () => 0,
    imageMetadata: async () => ({ mimeType: 'image/jpeg', size: 100, bytes: new Uint8Array([1]).buffer }),
    insertProcessing: async (row) => { const id = `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`; reports.set(id, { id, ...row, corroboration_count: 0 }); return id; },
    reprocessFailed: async (id) => ({ id, status: 'processing', attempts: 2 }),
    updateReport: async (id, fields) => { reports.set(id, { ...(reports.get(id) ?? { id }), ...fields }); },
    getReport: async (id) => reports.get(id) ?? { id, severity: 4, road_type: 'residential', confidence: .9, corroboration_count: 0, priority_score: 56, priority_band: 'high' },
    vision: async () => ({ damage_type: 'pothole', severity: 4, confidence: .9, summary: 'pothole', source: 'live_ai' }),
    geocode: async () => ({ cacheKey: 'x', addressLabel: 'Road', roadType: 'residential', source: 'nominatim', status: 'ok' as const }),
    nearby: async () => null,
    corroborate: async () => ({ original_report_id: 'original', corroboration_count: 1, priority_score: 60, priority_band: 'high', inserted: true }),
    ...overrides,
  };
}
async function body(response: Response): Promise<any> { return await response.json(); }

Deno.test('F-109 rejects missing JWT', async () => { const response = await createReportHandler(base())(request({ image_path: imagePath }, '')); if ((await body(response)).error.code !== 'UNAUTHENTICATED') throw new Error('missing JWT accepted'); });
Deno.test('F-109 rejects wrong reporter path', async () => { const response = await createReportHandler(base())(request({ image_path: '99999999-9999-4999-8999-999999999999/photo.jpg', latitude: 1, longitude: 2, location_source: 'gps' })); if ((await body(response)).error.code !== 'IMAGE_OWNERSHIP_MISMATCH') throw new Error('wrong path accepted'); });
Deno.test('F-109 rejects out-of-range coordinates', async () => { const response = await createReportHandler(base())(request({ image_path: imagePath, latitude: 91, longitude: 2, location_source: 'gps' })); if ((await body(response)).error.code !== 'INVALID_REQUEST') throw new Error('invalid coordinates accepted'); });
Deno.test('F-109 returns existing report for idempotent retry', async () => { const deps = base({ findExisting: async () => ({ id: 'existing', status: 'ready', damage_type: 'pothole', severity: 4, confidence: .9, road_type: 'residential', priority_score: 56, priority_band: 'high', corroboration_count: 0 }) }); const result = await body(await createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }))); if (result.report_id !== 'existing') throw new Error('retry did not return existing report'); });
Deno.test('F-109 final existing statuses return unchanged without new work', async () => {
  for (const status of ['ready', 'needs_review', 'duplicate']) {
    let visionCalled = false;
    let inserted = false;
    const deps = base({ findExisting: async () => ({ id: `existing-${status}`, status, damage_type: 'pothole', severity: 4, confidence: .9, road_type: 'residential', priority_score: 56, priority_band: 'high', corroboration_count: 2 }), vision: async () => { visionCalled = true; throw new Error('vision should not run'); }, insertProcessing: async () => { inserted = true; return 'unexpected'; } });
    const result = await body(await createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })));
    if (result.report_id !== `existing-${status}` || result.status !== status || visionCalled || inserted) throw new Error(`${status} retry was not unchanged`);
  }
});
Deno.test('F-109 unique insert violation applies idempotency rules', async () => {
  let visionCalled = false;
  const deps = base({ insertProcessing: async () => { throw new InsertConflictError({ id: 'winner', status: 'ready', damage_type: 'pothole', severity: 4, confidence: .9, road_type: 'residential', priority_score: 56, priority_band: 'high', corroboration_count: 0 }); }, vision: async () => { visionCalled = true; throw new Error('vision should not run'); } });
  const result = await body(await createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })));
  if (result.report_id !== 'winner' || result.status !== 'ready' || visionCalled) throw new Error('unique conflict did not return the existing report');
});
Deno.test('F-109 enforces hourly rate limit', async () => { const response = await createReportHandler(base({ countRecent: async () => 20 }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })); if ((await body(response)).error.code !== 'REPORT_RATE_LIMITED') throw new Error('rate limit failed'); });
Deno.test('F-109 fresh reporter is accepted while another reporter is over limit', async () => {
  let countedReporter = '';
  const response = await createReportHandler(base({ countRecent: async (reporter) => { countedReporter = reporter; return reporter === user ? 0 : 25; } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }));
  if ((await body(response)).status !== 'ready' || countedReporter !== user) throw new Error('fresh reporter was incorrectly rate limited');
});
Deno.test('F-109 counts concurrent processing rows toward the rate limit', async () => {
  const processingRows = Array.from({ length: 25 }, (_, index) => ({ id: `processing-${index}`, status: 'processing' }));
  let visionCalled = false;
  const response = await createReportHandler(base({ countRecent: async () => processingRows.length, vision: async () => { visionCalled = true; throw new Error('vision should not run'); } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }));
  if ((await body(response)).error.code !== 'REPORT_RATE_LIMITED' || visionCalled) throw new Error('processing rows were not counted');
});
Deno.test('F-109 abandons processing rows older than five minutes', async () => {
  let before = '';
  const response = await createReportHandler(base({ abandonStale: async (_reporter, cutoff) => { before = cutoff; } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }));
  if ((await body(response)).status !== 'ready' || Date.now() - Date.parse(before) < 4.5 * 60 * 1000) throw new Error('stale cleanup was not requested with a five-minute cutoff');
});
Deno.test('F-109 image validation failure creates no row and does not count toward the limit', async () => {
  let inserted = false;
  let counted = false;
  const response = await createReportHandler(base({ imageMetadata: async () => null, countRecent: async () => { counted = true; return 20; }, insertProcessing: async () => { inserted = true; return 'unexpected'; } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }));
  if ((await body(response)).error.code !== 'IMAGE_NOT_FOUND' || inserted || counted) throw new Error('validation failure created or counted a report');
});
Deno.test('F-109 MIME and size validation happen before insert and rate counting', async () => {
  for (const [label, metadata, code] of [
    ['MIME', { mimeType: 'image/gif', size: 100, bytes: new Uint8Array([1]).buffer }, 'IMAGE_TYPE_NOT_ALLOWED'],
    ['size', { mimeType: 'image/jpeg', size: 5 * 1024 * 1024 + 1, bytes: new Uint8Array([1]).buffer }, 'IMAGE_TOO_LARGE'],
  ] as const) {
    let inserted = false;
    let counted = false;
    const response = await createReportHandler(base({ imageMetadata: async () => metadata, countRecent: async () => { counted = true; return 20; }, insertProcessing: async () => { inserted = true; return 'unexpected'; } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }));
    if ((await body(response)).error.code !== code || inserted || counted) throw new Error(`${label} validation was too late`);
  }
});
Deno.test('F-109 unexpected pipeline failure finalizes the row as failed', async () => {
  const statuses: string[] = [];
  const response = await createReportHandler(base({ nearby: async () => { throw new Error('nearby failed'); }, updateReport: async (_id, fields) => { if (typeof fields.status === 'string') statuses.push(fields.status); } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }));
  if ((await body(response)).error.code !== 'INTERNAL_ERROR' || statuses.at(-1) !== 'failed' || statuses.includes('processing')) throw new Error(`unexpected final statuses: ${statuses.join(',')}`);
});
Deno.test('F-109 failed retry reuses the same row and clears the error', async () => {
  let visionCalled = false;
  let inserted = false;
  const updates: Record<string, unknown>[] = [];
  const deps = base({ findExisting: async () => ({ id: 'failed-existing', status: 'failed', processing_error: 'VISION_FAILED' } as any), insertProcessing: async () => { inserted = true; return 'unexpected'; }, reprocessFailed: async (id) => { updates.push({ status: 'processing', processing_error: null }); return { id, status: 'processing', attempts: 2 }; }, updateReport: async (_id, fields) => { updates.push(fields); }, vision: async () => { visionCalled = true; return { damage_type: 'pothole', severity: 4, confidence: .9, summary: 'pothole', source: 'live_ai' }; } });
  const result = await body(await createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })));
  if (result.report_id !== 'failed-existing' || result.status !== 'ready' || inserted || !visionCalled || updates[0]?.status !== 'processing' || updates[0]?.processing_error !== null) throw new Error('failed retry did not reuse and reset the row');
});
Deno.test('F-109 simultaneous failed retries allow only one conditional reprocess', async () => {
  let claimed = false;
  let visionCalls = 0;
  const deps = base({ findExisting: async () => ({ id: 'failed-existing', status: 'failed', attempts: 1 }), reprocessFailed: async () => { if (claimed) return null; claimed = true; return { id: 'failed-existing', status: 'processing', attempts: 2 }; }, vision: async () => { visionCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { damage_type: 'pothole', severity: 4, confidence: .9, summary: 'pothole', source: 'live_ai' }; } });
  const results = await Promise.all([1, 2].map(() => createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }))));
  const bodies = await Promise.all(results.map(body));
  if (visionCalls !== 1 || !bodies.some((item) => item.status === 'ready') || !bodies.some((item) => item.error?.code === 'IN_PROGRESS')) throw new Error('simultaneous retries were not conditionally claimed');
});
Deno.test('F-109 recent processing retry returns IN_PROGRESS', async () => {
  let visionCalled = false;
  const deps = base({ findExisting: async () => ({ id: 'processing-existing', status: 'processing', updated_at: new Date().toISOString() }), imageMetadata: async () => { throw new Error('image should not be read'); }, vision: async () => { visionCalled = true; throw new Error('vision should not run'); } });
  const result = await body(await createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })));
  if (result.error.code !== 'IN_PROGRESS' || visionCalled) throw new Error('recent processing retry was not rejected');
});
Deno.test('F-109 fourth failed attempt returns RETRY_LIMIT without vision', async () => {
  let visionCalled = false;
  let reprocessCalled = false;
  const deps = base({ findExisting: async () => ({ id: 'failed-existing', status: 'failed', attempts: 3 }), reprocessFailed: async () => { reprocessCalled = true; return null; }, vision: async () => { visionCalled = true; throw new Error('vision should not run'); } });
  const result = await body(await createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })));
  if (result.error.code !== 'RETRY_LIMIT' || visionCalled || reprocessCalled) throw new Error('retry limit was not enforced');
});
Deno.test('F-109 rate limit is checked only after image validation and before vision', async () => {
  let visionCalled = false;
  const response = await createReportHandler(base({ countRecent: async () => 20, vision: async () => { visionCalled = true; return { damage_type: 'pothole', severity: 4, confidence: .9, summary: 'pothole', source: 'live_ai' }; } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }));
  if ((await body(response)).error.code !== 'REPORT_RATE_LIMITED' || visionCalled) throw new Error('rate limit did not stop vision');
});
Deno.test('F-109 marks vision failure with typed error', async () => { const response = await createReportHandler(base({ vision: async () => { throw new Error('provider internals'); } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })); const result = await body(response); if (result.error.code !== 'VISION_FAILED' || result.error.message.includes('provider')) throw new Error('vision failure leaked internals'); });
Deno.test('F-109 duplicate with corroboration enabled stores duplicate status', async () => { let called = false; let storedStatus = ''; const response = await createReportHandler(base({ nearby: async () => ({ candidate_id: 'original', distance_m: 8, damage_type: 'pothole' }), updateReport: async (_id, fields) => { if (typeof fields.status === 'string') storedStatus = fields.status; }, getReport: async () => ({ id: 'original', status: 'ready', severity: 4, road_type: 'residential', confidence: .9, corroboration_count: 1, priority_score: 60, priority_band: 'high' }), corroborate: async () => { called = true; return { original_report_id: 'original', corroboration_count: 1, priority_score: 60, priority_band: 'high', inserted: true }; } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })); const result = await body(response); if (!called || result.status !== 'duplicate' || storedStatus !== 'duplicate' || result.original_report.corroboration_count !== 1) throw new Error('enabled duplicate path failed'); });
Deno.test('F-109 duplicate with corroboration disabled links only', async () => { let called = false; const deps = base({ nearby: async () => ({ candidate_id: 'original', distance_m: 8, damage_type: 'pothole' }), corroborate: async () => { called = true; return { original_report_id: 'original', corroboration_count: 1, priority_score: 60, priority_band: 'high', inserted: true }; } }); const response = await createReportHandler(deps, { enableCorroboration: false })(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' })); const result = await body(response); if (called || result.status !== 'duplicate') throw new Error('disabled duplicate path called corroboration'); });
Deno.test('F-109 own-reporter corroboration is ignored', async () => { const deps = base({ nearby: async () => ({ candidate_id: 'original', distance_m: 8, damage_type: 'pothole' }), corroborate: async () => ({ original_report_id: 'original', corroboration_count: 0, priority_score: 56, priority_band: 'high', inserted: false }) }); const result = await body(await createReportHandler(deps)(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }))); if (result.original_report.corroboration_count !== 0 || result.original_report.priority_score !== 56) throw new Error('own reporter changed original.'); });
Deno.test('F-109 geocoding failure still returns report', async () => { const result = await body(await createReportHandler(base({ geocode: async () => { throw new Error('Nominatim internals'); } }))(request({ image_path: imagePath, latitude: 1, longitude: 2, location_source: 'gps' }))); if (result.status !== 'ready') throw new Error('geocoding failure blocked report'); });
