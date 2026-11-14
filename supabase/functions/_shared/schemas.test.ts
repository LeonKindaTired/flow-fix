import { parseCreateReportRequest, parseVisionResult } from './schemas.ts';

function assertThrows(action: () => unknown): void {
  let threw = false;
  try { action(); } catch { threw = true; }
  if (!threw) throw new Error('Expected the action to throw.');
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}.`);
}

Deno.test('create-report schema rejects invalid coordinates and missing image', () => {
  assertThrows(() => parseCreateReportRequest({ latitude: 100, longitude: 0, location_source: 'gps' }));
  assertThrows(() => parseCreateReportRequest({ image_path: 'x', latitude: 0, longitude: 0, location_source: 'manual' }));
});

Deno.test('vision schema rejects invalid confidence and severity', () => {
  assertThrows(() => parseVisionResult({ damage_type: 'pothole', severity: 6, confidence: 0.5, summary: 'x' }));
  assertThrows(() => parseVisionResult({ damage_type: 'pothole', severity: 3, confidence: 2, summary: 'x' }));
});

Deno.test('schemas accept valid values', () => {
  assertEqual(parseCreateReportRequest({ image_path: '00000000-0000-4000-8000-000000000000/a.jpg', latitude: 0, longitude: 0, location_source: 'gps' }).location_source, 'gps');
  assertEqual(parseVisionResult({ damage_type: 'pothole', severity: 3, confidence: 0.8, summary: 'pothole' }).severity, 3);
});
