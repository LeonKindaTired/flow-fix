import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { ensureAnonymousSession, supabase } from './supabase';
import { MAX_UPLOAD_BYTES, type PreparedImage } from './image';
import type { Coordinates } from './location';

export type ReportResult = {
  report_id: string;
  status: 'ready' | 'needs_review' | 'duplicate';
  damage_type: string;
  severity: number | null;
  confidence: number | null;
  road_type: string;
  address_label: string | null;
  priority_score: number | null;
  priority_band: string | null;
  corroboration_count: number;
  needs_human_review: boolean;
  duplicate_of?: string;
};

export class ReportClientError extends Error {
  constructor(public readonly code: string, message: string, public imagePath?: string) { super(message); }
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorMessage(code: string): string {
  switch (code) {
    case 'REPORT_RATE_LIMITED': case 'RATE_LIMIT': return 'Too many reports in the last hour. Please try again later.';
    case 'VISION_FAILED': case 'VISION_INVALID_RESPONSE': return 'Image analysis failed. You can retry this same upload.';
    case 'IN_PROGRESS': return 'This report is still processing. Please wait and try again.';
    case 'RETRY_LIMIT': return 'This report has reached its retry limit. Please choose a new photo.';
    case 'IMAGE_NOT_FOUND': case 'IMAGE_TYPE_NOT_ALLOWED': case 'IMAGE_TOO_LARGE': return 'The uploaded image is invalid. Choose or capture another photo.';
    case 'NETWORK_ERROR': return 'Network connection lost. Check your connection and retry this same upload.';
    default: return 'Report submission failed. Please retry.';
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function uploadBody(image: PreparedImage): Promise<Blob | ArrayBuffer> {
  if (typeof window !== 'undefined') {
    if (image.webBlob) return image.webBlob;
    const blob = await fetch(image.uri).then((response) => response.blob());
    if (blob.size === 0 || blob.size > MAX_UPLOAD_BYTES) {
      throw new Error('Prepared web image is missing or exceeds the 5 MB upload limit.');
    }
    return blob;
  }
  const base64 = await FileSystem.readAsStringAsync(image.uri, { encoding: FileSystem.EncodingType.Base64 });
  const buffer = base64ToArrayBuffer(base64);
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('Prepared native image is missing or exceeds the 5 MB upload limit.');
  }
  return buffer;
}

export async function uploadReportPhoto(image: PreparedImage): Promise<string> {
  let session;
  try { session = await ensureAnonymousSession(); }
  catch (error) { throw new Error(`Sign-in failed: ${detail(error)}`); }
  const extension = image.mimeType.split('/')[1] === 'jpeg' ? 'jpg' : image.mimeType.split('/')[1];
  const path = `${session.user.id}/${Crypto.randomUUID()}.${extension}`;
  let body: Blob | ArrayBuffer;
  try { body = await uploadBody(image); }
  catch (error) { throw new Error(`Image read failed: ${detail(error)}`); }
  const result = await supabase.storage.from('report-photos').upload(path, body, {
    contentType: image.mimeType,
    upsert: false,
  });
  if (result.error) throw new Error(`Photo upload failed: ${result.error.message}`);
  return result.data.path;
}

export async function submitReport(image: PreparedImage, coordinates: Coordinates, existingImagePath?: string): Promise<ReportResult & { imagePath: string }> {
  let session;
  try { session = await ensureAnonymousSession(); }
  catch (error) { throw new ReportClientError('AUTH_ERROR', `Sign-in failed: ${detail(error)}`); }
  let imagePath = existingImagePath;
  if (!imagePath) {
    try { imagePath = await uploadReportPhoto(image); }
    catch (error) {
      const text = error instanceof Error ? error.message : '';
      const code = /5 MB|unsupported|image/i.test(text) ? 'INVALID_IMAGE' : 'UPLOAD_ERROR';
      throw new ReportClientError(code, text || errorMessage(code));
    }
  }
  try {
    const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/create-report`, {
      method: 'POST',
      headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: imagePath, latitude: coordinates.latitude, longitude: coordinates.longitude, location_source: 'gps' }),
    });
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } & Partial<ReportResult>;
    if (!response.ok || payload.error) {
      const code = payload.error?.code ?? `HTTP_${response.status}`;
      throw new ReportClientError(code, payload.error?.message ?? `Report service returned HTTP ${response.status}.`, imagePath);
    }
    if (!payload.report_id) throw new ReportClientError('NETWORK_ERROR', 'The report response was incomplete. Retry this same upload.', imagePath);
    const own: any = await supabase.from('reports').select('id,status,damage_type,severity,confidence,road_type,address_label,priority_score,priority_band,corroboration_count,needs_human_review,duplicate_of').eq('id', payload.report_id).single();
    if (own.error || !own.data) throw new ReportClientError('DATABASE_READ_ERROR', `Report was created but could not be read back: ${own.error?.message ?? 'no row returned'}`, imagePath);
    const ownData = own.data as unknown as ReportResult;
    return { ...ownData, report_id: ownData.report_id ?? payload.report_id, imagePath };
  } catch (error) {
    if (error instanceof ReportClientError) throw error;
    throw new ReportClientError('REQUEST_ERROR', `Could not reach the report service: ${detail(error)}`, imagePath);
  }
}

export async function prepareReportLocation(): Promise<Coordinates> {
  const session = await ensureAnonymousSession();
  if (!session.user.id) throw new Error('Anonymous session has no user ID.');
  const { getGpsLocation } = await import('./location');
  return getGpsLocation();
}
