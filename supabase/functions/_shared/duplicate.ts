export type NearbyCandidate = { candidate_id: string; distance_m: number; damage_type: string };
export type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };

export class DuplicateLookupError extends Error { constructor(message: string) { super(message); this.name = 'DuplicateLookupError'; } }

export async function findNearbyReport(client: RpcClient, input: { latitude: number; longitude: number; radiusM: number; damageType: string; excludeId: string }): Promise<NearbyCandidate | null> {
  if (input.damageType === 'unknown') return null;
  const result = await client.rpc('find_nearby_report', {
    p_lat: input.latitude,
    p_lon: input.longitude,
    p_radius_m: input.radiusM,
    p_damage_type: input.damageType,
    p_exclude_id: input.excludeId,
  });
  if (result.error) throw new DuplicateLookupError('Nearby report lookup failed.');
  const rows = Array.isArray(result.data) ? result.data as NearbyCandidate[] : [];
  return rows[0] ?? null;
}
