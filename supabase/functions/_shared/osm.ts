export type GeocodeResult = {
  cacheKey: string;
  addressLabel: string | null;
  roadType: string;
  source: 'cache' | 'nominatim' | 'fallback';
  errorCode?: 'GEOCODE_TIMEOUT' | 'GEOCODE_RATE_LIMITED' | 'GEOCODE_PROVIDER_ERROR';
};

export type GeocodeCache = {
  get(cacheKey: string): Promise<{ address_label: string | null; road_type: string } | null>;
  upsert(row: { cache_key: string; latitude_rounded: number; longitude_rounded: number; address_label: string | null; road_type: string; fetched_at: string }): Promise<void>;
};

type SupabaseCacheClient = {
  from(table: 'geocode_cache'): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): Promise<{ data: { address_label: string | null; road_type: string } | null; error: unknown }> } };
    upsert(row: Record<string, unknown>, options: { onConflict: string }): Promise<{ error: unknown }>;
  };
};

export function createSupabaseGeocodeCache(client: SupabaseCacheClient): GeocodeCache {
  return {
    async get(key) {
      const result = await client.from('geocode_cache').select('address_label,road_type').eq('cache_key', key).maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    async upsert(row) {
      const result = await client.from('geocode_cache').upsert(row, { onConflict: 'cache_key' });
      if (result.error) throw result.error;
    },
  };
}

function rounded(value: number): number { return Number(value.toFixed(5)); }
function cacheKey(latitude: number, longitude: number): string { return `${rounded(latitude).toFixed(5)},${rounded(longitude).toFixed(5)}`; }

export async function reverseGeocode(latitude: number, longitude: number, cache: GeocodeCache, options: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<GeocodeResult> {
  const lat = rounded(latitude); const lon = rounded(longitude); const key = cacheKey(lat, lon);
  let cached: { address_label: string | null; road_type: string } | null = null;
  try {
    cached = await cache.get(key);
  } catch {
    console.error('GEOCODE_CACHE_READ_FAILED');
  }
  if (cached) return { cacheKey: key, addressLabel: cached.address_label, roadType: cached.road_type || 'unknown', source: 'cache' };
  const readEnv = (name: string) => options.env?.[name] ?? Deno.env.get(name);
  const contact = readEnv('APP_CONTACT') ?? 'flowfix-development-contact';
  const baseUrl = readEnv('NOMINATIM_BASE_URL') ?? 'https://nominatim.openstreetmap.org';
  const timeoutMs = Number(readEnv('NOMINATIM_TIMEOUT_MS') ?? 5000);
  const url = `${baseUrl.replace(/\/$/, '')}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=17`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000);
  let response: Response;
  try { response = await (options.fetchImpl ?? fetch)(url, { headers: { 'User-Agent': `FlowFix/0.1 (${contact})`, Accept: 'application/json' }, signal: controller.signal }); }
  catch (error) {
    clearTimeout(timer);
    const errorCode = error instanceof DOMException && error.name === 'AbortError' ? 'GEOCODE_TIMEOUT' : 'GEOCODE_PROVIDER_ERROR';
    return { cacheKey: key, addressLabel: null, roadType: 'unknown', source: 'fallback', errorCode };
  }
  finally { clearTimeout(timer); }
  if (response.status === 429) return { cacheKey: key, addressLabel: null, roadType: 'unknown', source: 'fallback', errorCode: 'GEOCODE_RATE_LIMITED' };
  if (!response.ok) return { cacheKey: key, addressLabel: null, roadType: 'unknown', source: 'fallback', errorCode: 'GEOCODE_PROVIDER_ERROR' };
  let payload: Record<string, unknown> | null;
  try {
    const parsed: unknown = await response.json();
    payload = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return { cacheKey: key, addressLabel: null, roadType: 'unknown', source: 'fallback', errorCode: 'GEOCODE_PROVIDER_ERROR' };
  }
  if (!payload || Object.keys(payload).length === 0 || Object.prototype.hasOwnProperty.call(payload, 'error')) {
    return { cacheKey: key, addressLabel: null, roadType: 'unknown', source: 'fallback', errorCode: 'GEOCODE_PROVIDER_ERROR' };
  }
  const addressLabel = typeof payload?.display_name === 'string' ? payload.display_name : null;
  const isHighway = payload?.category === 'highway' || payload?.class === 'highway';
  const roadType = isHighway && typeof payload?.type === 'string' && payload.type.length > 0 ? payload.type : 'unknown';
  const result: GeocodeResult = { cacheKey: key, addressLabel, roadType, source: 'nominatim' };
  try {
    await cache.upsert({ cache_key: key, latitude_rounded: lat, longitude_rounded: lon, address_label: addressLabel, road_type: roadType, fetched_at: new Date().toISOString() });
  } catch {
    console.error('GEOCODE_CACHE_WRITE_FAILED');
  }
  return result;
}
