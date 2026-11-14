import { readNumber } from './config.ts';

for (const [name, fallback, min] of [
  ['MAX_REPORTS_PER_HOUR', 20, 1],
  ['DUPLICATE_RADIUS_METERS', 20, 1],
  ['VISION_TIMEOUT_MS', 8000, 1],
  ['NOMINATIM_TIMEOUT_MS', 5000, 1],
  ['VISION_CONFIDENCE_REVIEW_THRESHOLD', 0.6, 0.0001],
] as const) {
  Deno.test(`${name} invalid values use default`, () => {
    for (const value of ['', '  ', '0', 'abc']) {
      if (readNumber(name, fallback, { min }, { [name]: value }) !== fallback) throw new Error(`${name} did not default for ${JSON.stringify(value)}`);
    }
    if (readNumber(name, fallback, { min }, {}) !== fallback) throw new Error(`${name} did not default when unset`);
  });
}
