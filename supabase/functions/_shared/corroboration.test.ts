import { addReportCorroboration, corroborationEnabled } from './corroboration.ts';

Deno.test('corroboration adapter calls RPC when enabled', async () => {
  let name = ''; let args: Record<string, unknown> = {};
  const result = await addReportCorroboration({ rpc: async (rpcName, rpcArgs) => { name = rpcName; args = rpcArgs; return { data: [{ original_report_id: 'o', corroboration_count: 1, priority_score: 60, priority_band: 'high', inserted: true }], error: null }; } }, { originalReportId: 'o', corroboratingReportId: 'n', reporterId: 'r', enabled: true });
  if (name !== 'add_report_corroboration' || args.p_reporter_id !== 'r' || !result.inserted) throw new Error('corroboration RPC was not called correctly.');
});
Deno.test('corroboration adapter skips RPC when disabled', async () => {
  let called = false;
  const result = await addReportCorroboration({ rpc: async () => { called = true; return { data: [], error: null }; } }, { originalReportId: 'o', corroboratingReportId: 'n', reporterId: 'r', enabled: false });
  if (called || result.inserted) throw new Error('disabled corroboration called RPC.');
  if (corroborationEnabled('false') || !corroborationEnabled('true') || !corroborationEnabled(undefined)) throw new Error('flag parsing failed.');
});
