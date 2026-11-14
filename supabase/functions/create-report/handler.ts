import { createReportRequestSchema } from '../_shared/schemas.ts';
import { scoreReport, type ScoreResult } from '../_shared/scoring.ts';
import type { NearbyCandidate } from '../_shared/duplicate.ts';
import type { CorroborationResult } from '../_shared/corroboration.ts';
import type { VisionOutput } from '../_shared/vision.ts';
import type { GeocodeResult } from '../_shared/osm.ts';

export class ApiError extends Error { constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); } }
export type ExistingReport = { id: string; status: string; attempts?: number; created_at?: string; updated_at?: string; duplicate_of?: string | null; damage_type?: string; severity?: number | null; confidence?: number | null; road_type?: string; priority_score?: number | null; priority_band?: string | null; corroboration_count?: number };
export class InsertConflictError extends Error { constructor(public readonly existing: ExistingReport) { super('report already exists'); this.name = 'InsertConflictError'; } }
type ImageMetadata = { mimeType: string; size: number; bytes: ArrayBuffer };
export type CreateReportDeps = {
  verifyToken(token: string): Promise<{ id: string } | null>;
  findExisting(reporterId: string, imagePath: string): Promise<ExistingReport | null>;
  abandonStale(reporterId: string, before: string): Promise<void>;
  countRecent(reporterId: string, since: string): Promise<number>;
  imageMetadata(imagePath: string): Promise<ImageMetadata | null>;
  insertProcessing(row: Record<string, unknown>): Promise<string>;
  reprocessFailed(id: string): Promise<ExistingReport | null>;
  updateReport(id: string, fields: Record<string, unknown>): Promise<void>;
  getReport(id: string): Promise<ExistingReport | null>;
  vision(bytes: ArrayBuffer, mimeType: string): Promise<VisionOutput>;
  geocode(latitude: number, longitude: number): Promise<GeocodeResult>;
  nearby(input: { latitude: number; longitude: number; radiusM: number; damageType: string; excludeId: string }): Promise<NearbyCandidate | null>;
  corroborate(input: { originalReportId: string; corroboratingReportId: string; reporterId: string; enabled: boolean }): Promise<CorroborationResult>;
};

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const defaultOrigins = ['http://localhost:3000', 'http://localhost:8081', 'http://localhost:19006'];
function origins(value?: string): string[] { return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean).concat(defaultOrigins); }
function headers(origin: string | null, allowed: string[]): HeadersInit { const result: Record<string, string> = { 'Content-Type': 'application/json' }; if (origin && allowed.includes(origin)) result['Access-Control-Allow-Origin'] = origin; result['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type'; result['Access-Control-Allow-Methods'] = 'POST, OPTIONS'; return result; }
function json(data: unknown, status: number, origin: string | null, allowed: string[]) { return new Response(JSON.stringify(data), { status, headers: headers(origin, allowed) }); }
function publicError(error: unknown): ApiError { return error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 'Report processing failed.', 500); }
function existingResponse(report: ExistingReport) { return { report_id: report.id, status: report.status, damage_type: report.damage_type ?? 'unknown', severity: report.severity ?? null, confidence: report.confidence ?? null, road_type: report.road_type ?? 'unknown', priority_score: report.priority_score ?? null, priority_band: report.priority_band ?? null, corroboration_count: report.corroboration_count ?? 0, needs_human_review: false }; }

export function createReportHandler(deps: CreateReportDeps, config: { allowedOrigins?: string; maxReportsPerHour?: number; duplicateRadiusM?: number; reviewThreshold?: number; enableCorroboration?: boolean } = {}) {
  const allowed = origins(config.allowedOrigins);
  const maxReports = config.maxReportsPerHour ?? 20;
  const radiusM = config.duplicateRadiusM ?? 20;
  const reviewThreshold = config.reviewThreshold ?? 0.60;
  const enableCorroboration = config.enableCorroboration ?? true;
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin ?? '') ? 204 : 403, headers: headers(origin, allowed) });
    if (request.method !== 'POST' || (origin !== null && !allowed.includes(origin))) return json({ error: { code: 'CORS_ORIGIN_DENIED', message: 'Request origin is not allowed.' } }, 403, origin, allowed);
    try {
      const authorization = request.headers.get('Authorization') ?? '';
      if (!authorization.startsWith('Bearer ')) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.', 401);
      const user = await deps.verifyToken(authorization.slice(7));
      if (!user) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.', 401);
      let input: ReturnType<typeof createReportRequestSchema.parse>;
      try { input = createReportRequestSchema.parse(await request.json()); } catch { throw new ApiError('INVALID_REQUEST', 'Report request is invalid.', 400); }
      if (!input.image_path.startsWith(`${user.id}/`)) throw new ApiError('IMAGE_OWNERSHIP_MISMATCH', 'Image path is not owned by the authenticated user.', 403);
      await deps.abandonStale(user.id, new Date(Date.now() - 5 * 60 * 1000).toISOString());
      let existing = await deps.findExisting(user.id, input.image_path);
      if (existing && ['ready', 'needs_review', 'duplicate'].includes(existing.status)) return json(existingResponse(existing), 200, origin, allowed);
      if (existing?.status === 'processing') throw new ApiError('IN_PROGRESS', 'Report is still being processed.', 409);
      const metadata = await deps.imageMetadata(input.image_path);
      if (!metadata) throw new ApiError('IMAGE_NOT_FOUND', 'Uploaded image was not found.', 400);
      if (!allowedMimeTypes.has(metadata.mimeType)) throw new ApiError('IMAGE_TYPE_NOT_ALLOWED', 'Image type is not supported.', 400);
      if (metadata.size > 5 * 1024 * 1024) throw new ApiError('IMAGE_TOO_LARGE', 'Image exceeds the upload limit.', 400);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      if (await deps.countRecent(user.id, since) >= maxReports) throw new ApiError('REPORT_RATE_LIMITED', 'Report limit reached. Try again later.', 429);
      let reportId: string;
      if (existing?.status === 'failed') {
        if ((existing.attempts ?? 1) >= 3) throw new ApiError('RETRY_LIMIT', 'Report retry limit reached.', 409);
        const reprocessed = await deps.reprocessFailed(existing.id);
        if (!reprocessed) throw new ApiError('IN_PROGRESS', 'Report is still being processed.', 409);
        reportId = reprocessed.id;
      } else {
        try {
          reportId = await deps.insertProcessing({ reporter_id: user.id, image_path: input.image_path, latitude: input.latitude, longitude: input.longitude, location_source: input.location_source, status: 'processing', source: 'citizen' });
        } catch (error) {
          if (!(error instanceof InsertConflictError)) throw error;
          existing = error.existing;
          if (['ready', 'needs_review', 'duplicate'].includes(existing.status)) return json(existingResponse(existing), 200, origin, allowed);
          if (existing.status === 'processing') throw new ApiError('IN_PROGRESS', 'Report is still being processed.', 409);
          if (existing.status !== 'failed') throw new ApiError('IN_PROGRESS', 'Report is still being processed.', 409);
          if ((existing.attempts ?? 1) >= 3) throw new ApiError('RETRY_LIMIT', 'Report retry limit reached.', 409);
          const reprocessed = await deps.reprocessFailed(existing.id);
          if (!reprocessed) throw new ApiError('IN_PROGRESS', 'Report is still being processed.', 409);
          reportId = reprocessed.id;
        }
      }
      console.log('CREATE_REPORT_STARTED', reportId);
      let finalized = false;
      let failureCode = 'INTERNAL_ERROR';
      try {
        let vision: VisionOutput;
        let geocode: GeocodeResult;
        try {
          [vision, geocode] = await Promise.all([
            deps.vision(metadata.bytes, metadata.mimeType),
            deps.geocode(input.latitude, input.longitude).catch(() => ({ cacheKey: '', addressLabel: null, roadType: 'unknown', source: 'fallback' as const, errorCode: 'GEOCODE_PROVIDER_ERROR' as const })),
          ]);
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'VISION_FAILED';
          failureCode = code;
          throw new ApiError(code, 'Image analysis is temporarily unavailable.', 502);
        }
        const initialScore = scoreReport({ severity: vision.severity, roadType: geocode.roadType, corroborationCount: 0, confidence: vision.confidence }, reviewThreshold);
        const candidate = vision.damage_type === 'unknown' ? null : await deps.nearby({ latitude: input.latitude, longitude: input.longitude, radiusM, damageType: vision.damage_type, excludeId: reportId });
        if (candidate) {
          let originalReport: ExistingReport | null = null;
          let originalScore: ScoreResult | null = null;
          if (enableCorroboration) {
            const confirmation = await deps.corroborate({ originalReportId: candidate.candidate_id, corroboratingReportId: reportId, reporterId: user.id, enabled: true });
            originalReport = await deps.getReport(candidate.candidate_id);
            if (confirmation.inserted) {
              if (originalReport?.severity) {
                originalScore = scoreReport({ severity: originalReport.severity, roadType: originalReport.road_type, corroborationCount: confirmation.corroboration_count, confidence: originalReport.confidence }, reviewThreshold);
                await deps.updateReport(candidate.candidate_id, { priority_score: originalScore.score, priority_band: originalScore.priority_band, corroboration_count: confirmation.corroboration_count, score_version: originalScore.score_version, needs_human_review: originalScore.needs_human_review });
              }
            }
          }
          await deps.updateReport(reportId, { status: 'duplicate', duplicate_of: candidate.candidate_id, duplicate_distance_m: Math.round(candidate.distance_m), damage_type: vision.damage_type, severity: vision.severity, confidence: vision.confidence, ai_summary: vision.summary, address_label: geocode.addressLabel, road_type: geocode.roadType, priority_score: initialScore.score, priority_band: initialScore.priority_band, score_version: initialScore.score_version, needs_human_review: initialScore.needs_human_review });
          finalized = true;
          return json({ report_id: reportId, status: 'duplicate', duplicate_of: candidate.candidate_id, duplicate_distance_m: Math.round(candidate.distance_m), original_report: { priority_score: originalScore?.score ?? originalReport?.priority_score ?? null, priority_band: originalScore?.priority_band ?? originalReport?.priority_band ?? null, corroboration_count: originalScore ? (await deps.getReport(candidate.candidate_id))?.corroboration_count ?? 0 : originalReport?.corroboration_count ?? 0 } }, 200, origin, allowed);
        }
        const finalStatus = initialScore.needs_human_review ? 'needs_review' : 'ready';
        await deps.updateReport(reportId, { status: finalStatus, damage_type: vision.damage_type, severity: vision.severity, confidence: vision.confidence, ai_summary: vision.summary, address_label: geocode.addressLabel, road_type: geocode.roadType, priority_score: initialScore.score, priority_band: initialScore.priority_band, score_version: initialScore.score_version, needs_human_review: initialScore.needs_human_review, corroboration_count: 0 });
        finalized = true;
        return json({ report_id: reportId, status: finalStatus, damage_type: vision.damage_type, severity: vision.severity, confidence: vision.confidence, road_type: geocode.roadType, priority_score: initialScore.score, priority_band: initialScore.priority_band, corroboration_count: 0, needs_human_review: initialScore.needs_human_review }, 200, origin, allowed);
      } catch (error) {
        const safe = publicError(error);
        failureCode = safe.code;
        console.error('CREATE_REPORT_FAILED', reportId, safe.code);
        return json({ error: { code: safe.code, message: safe.message } }, safe.status, origin, allowed);
      } finally {
        if (!finalized) {
          try {
            await deps.updateReport(reportId, { status: 'failed', processing_error: failureCode });
          } catch {
            console.error('CREATE_REPORT_FINALIZE_FAILED', reportId);
          }
        }
      }
    } catch (error) {
      const safe = publicError(error);
      return json({ error: { code: safe.code, message: safe.message } }, safe.status, origin, allowed);
    }
  };
}
