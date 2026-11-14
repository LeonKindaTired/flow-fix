import { createClient } from 'npm:@supabase/supabase-js@2';
import { createReportHandler, InsertConflictError } from './handler.ts';
import { findNearbyReport } from '../_shared/duplicate.ts';
import { addReportCorroboration } from '../_shared/corroboration.ts';
import { reverseGeocode, createSupabaseGeocodeCache } from '../_shared/osm.ts';
import { analyzeImage } from '../_shared/vision.ts';
import { readNumber, readString } from '../_shared/config.ts';

const supabaseUrl = readString('SUPABASE_URL');
const serviceRoleKey = readString('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase function configuration is incomplete.');
const service = createClient(supabaseUrl, serviceRoleKey);
const maxBytes = 5 * 1024 * 1024;

const handler = createReportHandler({
  async verifyToken(token) {
    const result = await service.auth.getUser(token);
    return result.error || !result.data.user ? null : { id: result.data.user.id };
  },
  async findExisting(reporterId, imagePath) {
    const result = await service.from('reports').select('id,status,attempts,created_at,updated_at,duplicate_of,damage_type,severity,confidence,road_type,priority_score,priority_band,corroboration_count').eq('reporter_id', reporterId).eq('image_path', imagePath).maybeSingle();
    if (result.error) throw new Error('idempotency lookup failed');
    return result.data;
  },
  async abandonStale(reporterId, before) {
    const result = await service.from('reports').update({ status: 'failed', processing_error: 'TIMEOUT_ABANDONED', updated_at: new Date().toISOString() }).eq('reporter_id', reporterId).eq('status', 'processing').lt('updated_at', before);
    if (result.error) throw new Error('stale report cleanup failed');
  },
  async countRecent(reporterId, since) {
    const result = await service.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', reporterId).gte('created_at', since);
    if (result.error) throw new Error('rate lookup failed');
    return result.count ?? 0;
  },
  async imageMetadata(imagePath) {
    const download = await service.storage.from('report-photos').download(imagePath);
    if (download.error || !download.data) return null;
    const metadata = await service.schema('storage').from('objects').select('metadata').eq('bucket_id', 'report-photos').eq('name', imagePath).maybeSingle();
    const objectMetadata = metadata.data?.metadata as { mimetype?: unknown; mimeType?: unknown; size?: unknown } | null;
    const size = Number(objectMetadata?.size ?? 0);
    return { mimeType: String(objectMetadata?.mimetype ?? objectMetadata?.mimeType ?? download.data.type), size: size || download.data.size, bytes: await download.data.arrayBuffer() };
  },
  async insertProcessing(row) {
    const result = await service.from('reports').insert(row).select('id').single();
    if (result.error?.code === '23505') {
      const existing = await service.from('reports').select('id,status,attempts,created_at,updated_at,duplicate_of,damage_type,severity,confidence,road_type,priority_score,priority_band,corroboration_count').eq('reporter_id', String(row.reporter_id)).eq('image_path', String(row.image_path)).single();
      if (existing.error || !existing.data) throw new Error('idempotency conflict lookup failed');
      throw new InsertConflictError(existing.data);
    }
    if (result.error || !result.data) throw new Error('report insert failed');
    return result.data.id;
  },
  async reprocessFailed(id) {
    const result = await service.rpc('reprocess_failed_report', { p_report_id: id });
    if (result.error) throw new Error('retry update failed');
    return Array.isArray(result.data) ? result.data[0] ?? null : result.data;
  },
  async updateReport(id, fields) {
    const result = await service.from('reports').update(fields).eq('id', id);
    if (result.error) throw new Error('report update failed');
  },
  async getReport(id) {
    const result = await service.from('reports').select('id,status,damage_type,severity,confidence,road_type,priority_score,priority_band,corroboration_count').eq('id', id).maybeSingle();
    if (result.error) throw new Error('report read failed');
    return result.data;
  },
  async vision(bytes, mimeType) { return analyzeImage(bytes, mimeType); },
  async geocode(latitude, longitude) { return reverseGeocode(latitude, longitude, createSupabaseGeocodeCache(service as never)); },
  async nearby(input) { return findNearbyReport(service, input); },
  async corroborate(input) { return addReportCorroboration(service, input); },
}, {
  allowedOrigins: readString('ALLOWED_ORIGINS'),
  maxReportsPerHour: readNumber('MAX_REPORTS_PER_HOUR', 20, { min: 1 }),
  duplicateRadiusM: readNumber('DUPLICATE_RADIUS_METERS', 20, { min: 1 }),
  reviewThreshold: readNumber('VISION_CONFIDENCE_REVIEW_THRESHOLD', 0.60, { min: 0.0001 }),
  enableCorroboration: readString('ENABLE_CORROBORATION', 'true') !== 'false',
});

if (import.meta.main) Deno.serve(handler);
