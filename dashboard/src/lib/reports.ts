export type PriorityBand = 'low' | 'medium' | 'high' | 'urgent';
export type PublicReport = {
  id: string; created_at: string; latitude: number; longitude: number; address_label: string | null;
  road_type: string; damage_type: string; severity: number | null; priority_score: number | null;
  priority_band: PriorityBand | null; corroboration_count: number; status: 'ready' | 'needs_review'; source: 'citizen' | 'seeded_demo';
};
const fields = 'id,created_at,latitude,longitude,address_label,road_type,damage_type,severity,priority_score,priority_band,corroboration_count,status,source';
export async function fetchReports(): Promise<PublicReport[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Dashboard Supabase configuration is missing.');
  const response = await fetch(`${url}/rest/v1/public_reports?select=${fields}&order=priority_score.desc`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load public reports.');
  return await response.json() as PublicReport[];
}
