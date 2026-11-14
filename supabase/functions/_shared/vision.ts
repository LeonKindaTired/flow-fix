import { parseVisionResult, type VisionResult } from './schemas.ts';
import { readNumber, readString, type Environment } from './config.ts';

export type VisionErrorCode = 'VISION_CONFIGURATION' | 'VISION_TIMEOUT' | 'VISION_RATE_LIMITED' | 'VISION_PROVIDER_ERROR' | 'VISION_INVALID_RESPONSE';
export class VisionAdapterError extends Error { constructor(public readonly code: VisionErrorCode, message: string) { super(message); } }
export type VisionOutput = VisionResult & { source: 'live_ai' | 'DEMO_RESULT' };
type FetchLike = typeof fetch;

const allowedDamageTypes = new Set(['pothole', 'crack', 'surface_damage', 'other', 'unknown']);
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}
function normalizeDamage(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value;
  return allowedDamageTypes.has(value) ? value : 'unknown';
}
function jsonText(text: string): unknown {
  const fenced = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  const candidate = fenced ? fenced[1] : text.trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) throw new VisionAdapterError('VISION_INVALID_RESPONSE', 'Provider returned prose instead of a JSON object.');
  try { return JSON.parse(candidate); } catch { throw new VisionAdapterError('VISION_INVALID_RESPONSE', 'Provider returned malformed JSON.'); }
}
export async function analyzeImage(image: ArrayBuffer | Blob, mimeType: string, options: { fetchImpl?: FetchLike; env?: Environment } = {}): Promise<VisionOutput> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const demoMode = readString('DEMO_MODE', undefined, options.env) === 'true';
  const provider = (readString('VISION_PROVIDER', 'gemini', options.env) ?? 'gemini').toLowerCase();
  const model = readString('VISION_MODEL', undefined, options.env);
  const apiKey = readString('VISION_API_KEY', undefined, options.env);
  const timeoutMs = readNumber('VISION_TIMEOUT_MS', 8000, { min: 1 }, options.env);
  if (!model || !apiKey) {
    const missing = [!model ? 'VISION_MODEL' : '', !apiKey ? 'VISION_API_KEY' : ''].filter(Boolean).join(',');
    console.error('VISION_CONFIGURATION_MISSING', missing);
    throw new VisionAdapterError('VISION_CONFIGURATION', 'VISION_MODEL and VISION_API_KEY are required.');
  }
  try {
    const bytes = image instanceof Blob ? await image.arrayBuffer() : image;
    const encoded = bytesToBase64(new Uint8Array(bytes));
    const schema = { type: 'OBJECT', properties: { damage_type: { type: 'STRING', enum: ['pothole', 'crack', 'surface_damage', 'other', 'unknown'] }, severity: { type: 'INTEGER' }, confidence: { type: 'NUMBER' }, summary: { type: 'STRING' } }, required: ['damage_type', 'severity', 'confidence', 'summary'] };
    let request: { url: string; body: unknown; headers: Record<string, string> };
    if (provider === 'gemini') {
      request = { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, body: { contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: encoded } }, { text: 'Classify this road-damage image. Return only the required JSON fields.' }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }, headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' } };
    } else if (provider === 'openai') {
      request = { url: 'https://api.openai.com/v1/chat/completions', body: { model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Classify this road-damage image. Return only the required JSON fields.' }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${encoded}` } }] }], response_format: { type: 'json_object' } }, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } };
    } else {
      throw new VisionAdapterError('VISION_CONFIGURATION', `Unsupported VISION_PROVIDER: ${provider}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try { response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal }); }
    catch (error) {
      if (error instanceof VisionAdapterError) throw error;
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown transport error';
      throw new VisionAdapterError(error instanceof DOMException && error.name === 'AbortError' ? 'VISION_TIMEOUT' : 'VISION_PROVIDER_ERROR', `Vision provider request failed: ${detail}`);
    }
    finally { clearTimeout(timer); }
    if (response.status === 429) throw new VisionAdapterError('VISION_RATE_LIMITED', 'Vision provider rate limit reached.');
    if (!response.ok) {
      let providerMessage = '';
      try {
        const errorPayload = await response.clone().json() as { error?: { message?: unknown } };
        if (typeof errorPayload.error?.message === 'string') providerMessage = `: ${errorPayload.error.message}`;
      } catch {
        // Keep the stable status-only error when the provider body is not JSON.
      }
      throw new VisionAdapterError('VISION_PROVIDER_ERROR', `Vision provider ${provider}/${model} returned HTTP ${response.status}${providerMessage}`);
    }
    const payload = await response.json().catch(() => { throw new VisionAdapterError('VISION_INVALID_RESPONSE', 'Vision provider response was not valid JSON.'); });
    const text = provider === 'gemini' ? payload?.candidates?.[0]?.content?.parts?.[0]?.text : payload?.choices?.[0]?.message?.content;
    const parsed = jsonText(text);
    const normalized = parsed && typeof parsed === 'object' ? { ...(parsed as Record<string, unknown>), damage_type: normalizeDamage((parsed as Record<string, unknown>).damage_type) } : parsed;
    return { ...parseVisionResult(normalized), source: 'live_ai' };
  } catch (error) {
    const adapterError = error instanceof VisionAdapterError ? error : new VisionAdapterError('VISION_INVALID_RESPONSE', 'Vision result failed validation.');
    if (demoMode) return demoResult();
    throw adapterError;
  }
}

function demoResult(): VisionOutput { return { damage_type: 'pothole', severity: 3, confidence: 0.5, summary: 'DEMO_RESULT: deterministic sample; not live AI.', source: 'DEMO_RESULT' }; }
