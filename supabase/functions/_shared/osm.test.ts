import { reverseGeocode, type GeocodeCache } from './osm.ts';

function cache(initial: Record<string, { address_label: string | null; road_type: string }> = {}) {
  const values = new Map(Object.entries(initial)); let writes = 0;
  const store: GeocodeCache = { get: async (key) => values.get(key) ?? null, upsert: async (row) => { writes += 1; values.set(row.cache_key, { address_label: row.address_label, road_type: row.road_type }); } };
  return { store, writes: () => writes };
}
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status }); }

Deno.test('cache hit makes no request', async () => {
  const c = cache({ '45.00000,25.00000': { address_label: 'cached', road_type: 'primary' } }); let calls = 0;
  const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => { calls += 1; return response({}); } });
  if (result.source !== 'cache' || calls !== 0) throw new Error('Cache was not used.');
});
Deno.test('cache miss requests zoom 17 with descriptive User-Agent and caches highway type', async () => {
  const c = cache(); let requested = ''; let agent = '';
  const result = await reverseGeocode(45.123456, 25.654321, c.store, { env: { APP_CONTACT: 'team@example.test' }, fetchImpl: async (input, init) => { requested = String(input); agent = String((init?.headers as Record<string, string>)['User-Agent']); return response({ display_name: 'Main Road', category: 'highway', type: 'secondary' }); } });
  if (!requested.includes('zoom=17') || !requested.includes('format=jsonv2') || !agent.includes('team@example.test') || result.roadType !== 'secondary' || c.writes() !== 1) throw new Error('Highway cache miss behavior failed.');
});
Deno.test('non-highway response stores unknown', async () => {
  const c = cache(); const result = await reverseGeocode(45, 25, c.store, { fetchImpl: async () => response({ display_name: 'Park', category: 'amenity', type: 'park' }) });
  if (result.roadType !== 'unknown') throw new Error('Non-highway was not unknown.');
});
Deno.test('rate limit and timeout return fallback without throwing', async () => {
  const rate = await reverseGeocode(45, 25, cache().store, { fetchImpl: async () => response({}, 429) });
  if (rate.errorCode !== 'GEOCODE_RATE_LIMITED' || rate.roadType !== 'unknown') throw new Error('Rate limit fallback failed.');
  const timeout = await reverseGeocode(45, 25, cache().store, { env: { NOMINATIM_TIMEOUT_MS: '1' }, fetchImpl: async (_input, init) => await new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
  if (timeout.errorCode !== 'GEOCODE_TIMEOUT') throw new Error('Timeout fallback failed.');
});
