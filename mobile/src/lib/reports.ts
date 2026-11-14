import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { ensureAnonymousSession, supabase } from './supabase';
import { MAX_UPLOAD_BYTES, type PreparedImage } from './image';
import type { Coordinates } from './location';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function uploadBody(image: PreparedImage): Promise<Blob | ArrayBuffer> {
  if (typeof window !== 'undefined') {
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
  const session = await ensureAnonymousSession();
  const extension = image.mimeType.split('/')[1] === 'jpeg' ? 'jpg' : image.mimeType.split('/')[1];
  const path = `${session.user.id}/${Crypto.randomUUID()}.${extension}`;
  const body = await uploadBody(image);
  const result = await supabase.storage.from('report-photos').upload(path, body, {
    contentType: image.mimeType,
    upsert: false,
  });
  if (result.error) throw new Error(`Photo upload failed: ${result.error.message}`);
  return result.data.path;
}

export async function prepareReportLocation(): Promise<Coordinates> {
  const session = await ensureAnonymousSession();
  if (!session.user.id) throw new Error('Anonymous session has no user ID.');
  const { getGpsLocation } = await import('./location');
  return getGpsLocation();
}
