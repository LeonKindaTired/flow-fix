import { parseVisionResult, type VisionResult } from './schemas.ts';

export type VisionErrorCode = 'VISION_CONFIGURATION' | 'VISION_TIMEOUT' | 'VISION_RATE_LIMITED' | 'VISION_PROVIDER_ERROR' | 'VISION_INVALID_RESPONSE';
export class VisionAdapterError extends Error { constructor(public readonly code: VisionErrorCode, message: string) { super(message); } }
export type VisionOutput = VisionResult & { source: 'live_ai' | 'DEMO_RESULT' };
type FetchLike = typeof fetch;

const allowedDamageTypes = new Set(['pothole', 'crack', 'surface_damage', 'other', 'unknown']);
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
export async function analyzeImage(image: ArrayBuffer | Blob, mimeType: string, options: { fetchImpl?: FetchLike; env?: Record<string, string | undefined> } = {}): Promise<VisionOutput> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnv = (name: string) => options.env?.[name] ?? Deno.env.get(name);
  const demoMode = readEnv('DEMO_MODE') === 'true';
  const provider = (readEnv('VISION_PROVIDER') ?? 'gemini').toLowerCase();
  const model = readEnv('VISION_MODEL');
  const apiKey = readEnv('VISION_API_KEY');
  const configuredTimeout = Number(readEnv('VISION_TIMEOUT_MS') ?? 8000);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 8000;
  if (!model || !apiKey) {
    if (demoMode) return demoResult();
    throw new VisionAdapterError('VISION_CONFIGURATION', 'VISION_MODEL and VISION_API_KEY are required.');
  }
  try {
    const bytes = image instanceof Blob ? await image.arrayBuffer() : image;
    const base64 = Uint8Array.from(new Uint8Array(bytes), (byte) => byte).reduce((out, byte) => out + String.fromCharCode(byte), '');
    const encoded = btoa(base64);
    const schema = { type: 'OBJECT', properties: { damage_type: { type: 'STRING', enum: ['pothole', 'crack', 'surface_damage', 'other', 'unknown'] }, severity: { type: 'INTEGER' }, confidence: { type: 'NUMBER' }, summary: { type: 'STRING' } }, required: ['damage_type', 'severity', 'confidence', 'summary'] };
    let request: { url: string; body: unknown; headers: Record<string, string> };
    if (provider === 'gemini') {
      request = { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, body: { contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: encoded } }, { text: 'Classify this road-damage image. Return only the required JSON fields.' }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }, headers: { 'Content-Type': 'application/json' } };
    } else if (provider === 'openai') {
      request = { url: 'https://api.openai.com/v1/chat/completions', body: { model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Classify this road-damage image. Return only the required JSON fields.' }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${encoded}` } }] }], response_format: { type: 'json_object' } }, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } };
    } else {
      throw new VisionAdapterError('VISION_CONFIGURATION', `Unsupported VISION_PROVIDER: ${provider}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try { response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal }); }
    catch (error) { if (error instanceof VisionAdapterError) throw error; throw new VisionAdapterError(error instanceof DOMException && error.name === 'AbortError' ? 'VISION_TIMEOUT' : 'VISION_PROVIDER_ERROR', 'Vision provider request failed.'); }
    finally { clearTimeout(timer); }
    if (response.status === 429) throw new VisionAdapterError('VISION_RATE_LIMITED', 'Vision provider rate limit reached.');
    if (!response.ok) throw new VisionAdapterError('VISION_PROVIDER_ERROR', `Vision provider returned HTTP ${response.status}.`);
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
