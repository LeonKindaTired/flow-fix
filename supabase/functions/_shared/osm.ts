import { readNumber, readString, type Environment } from './config.ts';
import { ROAD_WEIGHTS } from './scoring.ts';

export type GeocodeStatus = 'ok' | 'cached' | 'failed';
export type GeocodeResult = {
  cacheKey: string;
  addressLabel: string | null;
  roadType: string;
  source: 'cache' | 'nominatim' | 'photon' | 'fallback';
  status: GeocodeStatus;
  errorCode?: 'GEOCODE_TIMEOUT' | 'GEOCODE_RATE_LIMITED' | 'GEOCODE_PROVIDER_ERROR' | 'GEOCODE_EMPTY_RESULT' | 'GEOCODE_CONFIGURATION';
};
export type GeocodeCache = {
  get(cacheKey: string): Promise<{ address_label: string | null; road_type: string } | null>;
  upsert(row: { cache_key: string; latitude_rounded: number; longitude_rounded: number; address_label: string | null; road_type: string; fetched_at: string }): Promise<void>;
};
type SupabaseCacheClient = { from(table: 'geocode_cache'): { select(columns: string): { eq(column: string, value: string): { maybeSingle(): Promise<{ data: { address_label: string | null; road_type: string } | null; error: unknown }> } }; upsert(row: Record<string, unknown>, options: { onConflict: string }): Promise<{ error: unknown }> } };

export function createSupabaseGeocodeCache(client: SupabaseCacheClient): GeocodeCache {
  return { async get(key) { const result = await client.from('geocode_cache').select('address_label,road_type').eq('cache_key', key).maybeSingle(); if (result.error) throw result.error; return result.data; }, async upsert(row) { const result = await client.from('geocode_cache').upsert(row, { onConflict: 'cache_key' }); if (result.error) throw result.error; } };
}

function rounded(value: number): number { return Number(value.toFixed(5)); }
function normalizeRoadType(value: unknown): string { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROAD_WEIGHTS, value) ? value : 'unknown'; }
function cacheKey(provider: string, latitude: number, longitude: number): string { return `${provider}:${rounded(latitude).toFixed(5)},${rounded(longitude).toFixed(5)}`; }
function failed(cacheKeyValue: string, errorCode: GeocodeResult['errorCode'], detail: string): GeocodeResult { console.error('GEOCODE_FAILED', detail); return { cacheKey: cacheKeyValue, addressLabel: null, roadType: 'unknown', source: 'fallback', status: 'failed', errorCode }; }
function label(properties: Record<string, unknown>): string | null { const values = [properties.name, properties.street, properties.city].filter((value): value is string => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()); return [...new Set(values)].join(', ') || null; }

export async function reverseGeocode(latitude: number, longitude: number, cache: GeocodeCache, options: { fetchImpl?: typeof fetch; env?: Environment } = {}): Promise<GeocodeResult> {
  const lat = rounded(latitude); const lon = rounded(longitude); const provider = (readString('GEOCODE_PROVIDER', 'photon', options.env) ?? 'photon').toLowerCase(); const key = cacheKey(provider, lat, lon);
  let cached: { address_label: string | null; road_type: string } | null = null;
  try { cached = await cache.get(key); } catch { console.error('GEOCODE_CACHE_READ_FAILED'); }
  if (cached) return { cacheKey: key, addressLabel: cached.address_label, roadType: cached.road_type || 'unknown', source: 'cache', status: 'cached' };
  const contact = readString('APP_CONTACT', 'flowfix-development-contact', options.env) ?? 'flowfix-development-contact';
  const baseUrl = readString('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org', options.env) ?? 'https://nominatim.openstreetmap.org';
  const timeoutMs = readNumber('NOMINATIM_TIMEOUT_MS', 5000, { min: 1 }, options.env);
  const radiusM = readNumber('GEOCODE_RADIUS_M', 50, { min: 1 }, options.env);
  let url: string;
  if (provider === 'photon') url = `${(readString('PHOTON_BASE_URL', 'https://photon.komoot.io', options.env) ?? 'https://photon.komoot.io').replace(/\/$/, '')}/reverse?lon=${lon}&lat=${lat}&radius=${radiusM / 1000}&osm_tag=highway`;
  else if (provider === 'nominatim') url = `${baseUrl.replace(/\/$/, '')}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=17`;
  else return failed(key, 'GEOCODE_CONFIGURATION', 'GEOCODE_PROVIDER');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try { response = await (options.fetchImpl ?? fetch)(url, { headers: { 'User-Agent': `FlowFix/0.1 (${contact})`, Accept: 'application/json' }, signal: controller.signal }); }
  catch (error) { clearTimeout(timer); const detail = error instanceof DOMException && error.name === 'AbortError' ? 'AbortError' : error instanceof Error ? error.name : 'TransportError'; return failed(key, detail === 'AbortError' ? 'GEOCODE_TIMEOUT' : 'GEOCODE_PROVIDER_ERROR', detail); }
  finally { clearTimeout(timer); }
  if (response.status === 403) return failed(key, 'GEOCODE_PROVIDER_ERROR', 'HTTP_403');
  if (response.status === 429) return failed(key, 'GEOCODE_RATE_LIMITED', 'HTTP_429');
  if (!response.ok) return failed(key, 'GEOCODE_PROVIDER_ERROR', `HTTP_${response.status}`);
  let payload: any;
  try { payload = await response.json(); } catch { return failed(key, 'GEOCODE_PROVIDER_ERROR', 'InvalidJSON'); }
  let addressLabel: string | null = null; let roadType = 'unknown';
  if (provider === 'photon') {
    const feature = Array.isArray(payload?.features) ? payload.features[0] : null;
    if (!feature || !feature.properties || typeof feature.properties !== 'object') return failed(key, 'GEOCODE_EMPTY_RESULT', 'EMPTY_RESULT');
    const properties = feature.properties as Record<string, unknown>; addressLabel = label(properties); roadType = properties.osm_key === 'highway' ? normalizeRoadType(properties.osm_value) : 'unknown';
  } else {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length === 0 || Object.prototype.hasOwnProperty.call(payload, 'error')) return failed(key, 'GEOCODE_EMPTY_RESULT', 'EMPTY_RESULT');
    addressLabel = typeof payload.display_name === 'string' ? payload.display_name : null;
    roadType = payload.category === 'highway' || payload.class === 'highway' ? normalizeRoadType(payload.type) : 'unknown';
  }
  const result: GeocodeResult = { cacheKey: key, addressLabel, roadType, source: provider as 'photon' | 'nominatim', status: 'ok' };
  try { await cache.upsert({ cache_key: key, latitude_rounded: lat, longitude_rounded: lon, address_label: addressLabel, road_type: roadType, fetched_at: new Date().toISOString() }); } catch { console.error('GEOCODE_CACHE_WRITE_FAILED'); }
  return result;
}
