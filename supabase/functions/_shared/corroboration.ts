export type CorroborationResult = { original_report_id: string; corroboration_count: number; priority_score: number | null; priority_band: string | null; inserted: boolean };
export type CorroborationRpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };

export function corroborationEnabled(value = Deno.env.get('ENABLE_CORROBORATION')): boolean { return value !== 'false'; }

export async function addReportCorroboration(client: CorroborationRpcClient, input: { originalReportId: string; corroboratingReportId: string; reporterId: string; enabled?: boolean }): Promise<CorroborationResult> {
  if (input.enabled === false) return { original_report_id: input.originalReportId, corroboration_count: 0, priority_score: null, priority_band: null, inserted: false };
  const result = await client.rpc('add_report_corroboration', { p_original_report_id: input.originalReportId, p_corroborating_report_id: input.corroboratingReportId, p_reporter_id: input.reporterId });
  if (result.error || !Array.isArray(result.data) || !result.data[0]) throw new Error('Corroboration failed.');
  return result.data[0] as CorroborationResult;
}
