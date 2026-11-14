import { analyzeImage } from '../supabase/functions/_shared/vision.ts';

const imagePath = Deno.args[0] === '--' ? Deno.args[1] : Deno.args[0];
if (!imagePath) throw new Error('Usage: deno run --allow-env --allow-read scripts/vision-smoke.ts <image-path>');

const extension = imagePath.toLowerCase().split('.').pop();
const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
const bytes = await Deno.readFile(imagePath);
const started = performance.now();
const result = await analyzeImage(bytes.buffer, mimeType);
const latencyMs = Math.round((performance.now() - started) * 100) / 100;
console.log(JSON.stringify({ latency_ms: latencyMs, result }, null, 2));
