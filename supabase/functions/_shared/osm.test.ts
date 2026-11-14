import { reverseGeocode, type GeocodeCache } from './osm.ts';

function cache(initial: Record<string, { address_label: string | null; road_type: string }> = {}, options: { readError?: boolean; writeError?: boolean } = {}) {
  const values = new Map(Object.entries(initial)); let writes = 0;
  const store: GeocodeCache = {
    get: async (key) => { if (options.readError) throw new Error('cache read failure'); return values.get(key) ?? null; },
    upsert: async (row) => { writes += 1; if (options.writeError) throw new Error('cache write failure'); values.set(row.cache_key, { address_label: row.address_label, road_type: row.road_type }); },
  };
  return { store, writes: () => writes };
}
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status }); }
function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }

Deno.test('cache hit makes no request', async () => {
  const c = cache({ '45.00000,25.00000': { address_label: 'cached', road_type: 'primary' } }); let calls = 0;
  const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => { calls += 1; return response({}); } });
  assert(result.source === 'cache' && calls === 0 && c.writes() === 0, 'cache hit was not used');
});

Deno.test('successful highway result is cached', async () => {
  const c = cache(); let requested = ''; let agent = '';
  const result = await reverseGeocode(45.123456, 25.654321, c.store, { env: { APP_CONTACT: 'team@example.test' }, fetchImpl: async (input, init) => { requested = String(input); agent = String((init?.headers as Record<string, string>)['User-Agent']); return response({ display_name: 'Main Road', category: 'highway', type: 'secondary' }); } });
  assert(requested.includes('zoom=17') && requested.includes('format=jsonv2') && agent.includes('team@example.test') && result.roadType === 'secondary' && c.writes() === 1, 'successful highway cache behavior failed');
});

Deno.test('legitimate non-road result is cached with unknown road type', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({ display_name: 'Park', category: 'amenity', type: 'park' }) });
  assert(result.roadType === 'unknown' && result.source === 'nominatim' && c.writes() === 1, 'non-road result was not cached as unknown');
});

Deno.test('HTTP 429 does not write cache', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({}, 429) });
  assert(result.errorCode === 'GEOCODE_RATE_LIMITED' && c.writes() === 0, '429 was cached');
});

Deno.test('timeout does not write cache', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { env: { NOMINATIM_TIMEOUT_MS: '1' }, fetchImpl: async (_input, init) => await new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
  assert(result.errorCode === 'GEOCODE_TIMEOUT' && c.writes() === 0, 'timeout was cached');
});

Deno.test('HTTP 5xx does not write cache', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({}, 503) });
  assert(result.errorCode === 'GEOCODE_PROVIDER_ERROR' && c.writes() === 0, '5xx was cached');
});

Deno.test('network error does not write cache', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => { throw new Error('network'); } });
  assert(result.errorCode === 'GEOCODE_PROVIDER_ERROR' && c.writes() === 0, 'network error was cached');
});

Deno.test('unparseable body does not write cache', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => new Response('not-json', { status: 200 }) });
  assert(result.errorCode === 'GEOCODE_PROVIDER_ERROR' && c.writes() === 0, 'unparseable body was cached');
});

Deno.test('empty payload does not write cache', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({}) });
  assert(result.errorCode === 'GEOCODE_PROVIDER_ERROR' && c.writes() === 0, 'empty payload was cached');
});

Deno.test('payload with error field does not write cache', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({ error: 'Unable to geocode' }) });
  assert(result.errorCode === 'GEOCODE_PROVIDER_ERROR' && c.writes() === 0, 'error payload was cached');
});

Deno.test('cache read failure does not block live lookup', async () => {
  const c = cache({}, { readError: true }); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({ display_name: 'Building', category: 'building', type: 'yes' }) });
  assert(result.source === 'nominatim' && result.roadType === 'unknown' && c.writes() === 1, 'cache read failure blocked lookup');
});

Deno.test('cache write failure does not block result', async () => {
  const c = cache({}, { writeError: true }); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({ display_name: 'Building', category: 'building', type: 'yes' }) });
  assert(result.source === 'nominatim' && result.addressLabel === 'Building' && result.roadType === 'unknown' && c.writes() === 1, 'cache write failure blocked result');
});
