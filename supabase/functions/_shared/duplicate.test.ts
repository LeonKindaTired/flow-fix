import { findNearbyReport } from './duplicate.ts';

Deno.test('duplicate adapter passes p_exclude_id and returns candidate', async () => {
  let args: Record<string, unknown> = {};
  const result = await findNearbyReport({ rpc: async (name, input) => { if (name !== 'find_nearby_report') throw new Error('wrong RPC'); args = input; return { data: [{ candidate_id: 'original', distance_m: 8, damage_type: 'pothole' }], error: null }; } }, { latitude: 1, longitude: 2, radiusM: 20, damageType: 'pothole', excludeId: 'new' });
  if (result?.candidate_id !== 'original' || args.p_exclude_id !== 'new') throw new Error('exclude ID was not passed.');
});
Deno.test('duplicate adapter skips unknown damage', async () => {
  let called = false;
  const result = await findNearbyReport({ rpc: async () => { called = true; return { data: [], error: null }; } }, { latitude: 1, longitude: 2, radiusM: 20, damageType: 'unknown', excludeId: 'new' });
  if (called || result !== null) throw new Error('unknown damage should skip lookup.');
});
