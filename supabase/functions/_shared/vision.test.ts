import { analyzeImage, VisionAdapterError } from './vision.ts';

const env = { VISION_PROVIDER: 'gemini', VISION_MODEL: 'test-model', VISION_API_KEY: 'test-key', VISION_TIMEOUT_MS: '20' };
const image = new Uint8Array([1, 2, 3]).buffer;
function response(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); }
function geminiText(text: string) { return { candidates: [{ content: { parts: [{ text }] } }] }; }
async function expectCode(action: () => Promise<unknown>, code: string) { try { await action(); throw new Error(`Expected ${code}`); } catch (error) { if (!(error instanceof VisionAdapterError) || error.code !== code) throw error; } }

Deno.test('vision accepts structured JSON and maps unknown damage to unknown', async () => {
  let requestUrl = '';
  let requestHeaders: HeadersInit | undefined;
  const result = await analyzeImage(image, 'image/jpeg', { env, fetchImpl: async (input, init) => { requestUrl = String(input); requestHeaders = init?.headers; return response(geminiText('{"damage_type":"fallen_tree","severity":3,"confidence":0.8,"summary":"tree"}')); } });
  const headerValue = new Headers(requestHeaders).get('x-goog-api-key');
  if (requestUrl.includes('key=') || headerValue !== 'test-key') throw new Error('Gemini key must be header-only and URL must contain no key.');
  if (result.source !== 'live_ai' || result.damage_type !== 'unknown') throw new Error('Expected live normalized result.');
});
Deno.test('vision accepts fenced JSON', async () => {
  const result = await analyzeImage(image, 'image/jpeg', { env, fetchImpl: async () => response(geminiText('```json\n{"damage_type":"pothole","severity":2,"confidence":0.8,"summary":"pothole"}\n```')) });
  if (result.severity !== 2) throw new Error('Expected fenced JSON to parse.');
});
Deno.test('vision rejects prose', async () => await expectCode(() => analyzeImage(image, 'image/jpeg', { env, fetchImpl: async () => response(geminiText('The image shows a pothole.')) }), 'VISION_INVALID_RESPONSE'));
Deno.test('vision rejects malformed JSON', async () => await expectCode(() => analyzeImage(image, 'image/jpeg', { env, fetchImpl: async () => response(geminiText('{bad')) }), 'VISION_INVALID_RESPONSE'));
Deno.test('vision rejects missing fields', async () => await expectCode(() => analyzeImage(image, 'image/jpeg', { env, fetchImpl: async () => response(geminiText('{"damage_type":"pothole"}')) }), 'VISION_INVALID_RESPONSE'));
Deno.test('vision rejects invalid severity and confidence', async () => {
  await expectCode(() => analyzeImage(image, 'image/jpeg', { env, fetchImpl: async () => response(geminiText('{"damage_type":"pothole","severity":6,"confidence":0.8,"summary":"x"}')) }), 'VISION_INVALID_RESPONSE');
  await expectCode(() => analyzeImage(image, 'image/jpeg', { env, fetchImpl: async () => response(geminiText('{"damage_type":"pothole","severity":2,"confidence":1.2,"summary":"x"}')) }), 'VISION_INVALID_RESPONSE');
});
Deno.test('vision maps HTTP 429', async () => await expectCode(() => analyzeImage(image, 'image/jpeg', { env, fetchImpl: async () => response({}, 429) }), 'VISION_RATE_LIMITED'));
Deno.test('vision maps timeout', async () => {
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))));
  await expectCode(() => analyzeImage(image, 'image/jpeg', { env: { ...env, VISION_TIMEOUT_MS: '1' }, fetchImpl }), 'VISION_TIMEOUT');
});
Deno.test('vision empty model or key returns configuration error without values', async () => {
  const messages: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { messages.push(args.join(' ')); };
  try {
    await expectCode(() => analyzeImage(image, 'image/jpeg', { env: { ...env, VISION_MODEL: '  ' } }), 'VISION_CONFIGURATION');
    await expectCode(() => analyzeImage(image, 'image/jpeg', { env: { ...env, VISION_API_KEY: '' } }), 'VISION_CONFIGURATION');
  } finally { console.error = original; }
  if (messages.some((message) => message.includes('test-key') || message.includes('test-model'))) throw new Error('configuration logging exposed a value');
  if (!messages.some((message) => message.includes('VISION_MODEL')) || !messages.some((message) => message.includes('VISION_API_KEY'))) throw new Error('configuration variable name was not logged');
});
Deno.test('vision demo fallback is explicitly labelled', async () => {
  const result = await analyzeImage(image, 'image/jpeg', { env: { ...env, DEMO_MODE: 'true' }, fetchImpl: async () => response({}, 500) });
  if (result.source !== 'DEMO_RESULT' || !result.summary.startsWith('DEMO_RESULT:')) throw new Error('Fallback was not labelled.');
});
