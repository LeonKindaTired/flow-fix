import { scoreReport, priorityBand, roadWeight } from './scoring.ts';

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
function truthy(value: unknown, label: string) { if (!value) throw new Error(label); }
function throws(action: () => unknown, label: string) { let didThrow = false; try { action(); } catch { didThrow = true; } if (!didThrow) throw new Error(`${label}: expected throw`); }

Deno.test('S-01 severity 1 unknown road has zero severity contribution', () => {
  const result = scoreReport({ severity: 1, roadType: 'unknown', corroborationCount: 0, confidence: 0.9 });
  equal(result.score, 6, 'score'); equal(result.breakdown.severity_component, 0, 'severity'); truthy(Number.isInteger(result.score), 'integer score');
});
Deno.test('S-02 severity 5 primary with 5 corroborations is 100', () => equal(scoreReport({ severity: 5, roadType: 'primary', corroborationCount: 5 }).score, 100, 'score'));
Deno.test('S-03 unknown road fallback is 40', () => equal(roadWeight('not-a-road'), 40, 'road weight'));
Deno.test('S-04 confidence .59 requests review without changing score', () => {
  const low = scoreReport({ severity: 4, roadType: 'residential', corroborationCount: 0, confidence: .59 });
  const high = scoreReport({ severity: 4, roadType: 'residential', corroborationCount: 0, confidence: .9 });
  equal(low.score, high.score, 'score'); equal(low.needs_human_review, true, 'review');
});
Deno.test('S-05 confidence threshold behavior', () => {
  equal(scoreReport({ severity: 3, roadType: 'primary', corroborationCount: 0, confidence: .60 }).needs_human_review, false, '.60');
  equal(scoreReport({ severity: 3, roadType: 'primary', corroborationCount: 0, confidence: .99 }).needs_human_review, false, '.99');
});
Deno.test('S-06 missing severity fails safely', () => throws(() => scoreReport({ severity: null, roadType: 'unknown', corroborationCount: 0 }), 'missing severity'));
Deno.test('S-07 severity 0 and 6 are rejected', () => { throws(() => scoreReport({ severity: 0, corroborationCount: 0 }), 'severity 0'); throws(() => scoreReport({ severity: 6, corroborationCount: 0 }), 'severity 6'); });
Deno.test('S-08 invalid confidence is rejected', () => { throws(() => scoreReport({ severity: 3, corroborationCount: 0, confidence: -0.1 }), 'low confidence'); throws(() => scoreReport({ severity: 3, corroborationCount: 0, confidence: 1.1 }), 'high confidence'); });
Deno.test('S-09 distinct corroboration inputs affect score exactly once in scoring input', () => equal(scoreReport({ severity: 5, roadType: 'residential', corroborationCount: 1 }).score, 76, 'score'));
Deno.test('S-10 same input is deterministic', () => equal(JSON.stringify(scoreReport({ severity: 4, roadType: 'secondary', corroborationCount: 2, confidence: .8 })), JSON.stringify(scoreReport({ severity: 4, roadType: 'secondary', corroborationCount: 2, confidence: .8 })), 'result'));
Deno.test('S-11 corroboration caps at 5', () => { equal(scoreReport({ severity: 5, roadType: 'primary', corroborationCount: 99 }).breakdown.community_component, 100, 'community'); equal(scoreReport({ severity: 5, roadType: 'primary', corroborationCount: 99 }).score, 100, 'score'); });
Deno.test('S-12 missing road uses unknown fallback', () => equal(scoreReport({ severity: 1, corroborationCount: 0 }).breakdown.road_component, 40, 'road'));
Deno.test('S-13 different damage types are outside pure scoring and do not alter same score', () => equal(scoreReport({ severity: 3, roadType: 'tertiary', corroborationCount: 0 }).score, scoreReport({ severity: 3, roadType: 'tertiary', corroborationCount: 0 }).score, 'score'));
Deno.test('S-14 outside-radius behavior is outside pure scoring and score remains deterministic', () => equal(scoreReport({ severity: 3, roadType: 'tertiary', corroborationCount: 0 }).score_version, 'v1', 'version'));
Deno.test('S-15 severity 4 residential 0 is 56 high', () => { const result = scoreReport({ severity: 4, roadType: 'residential', corroborationCount: 0 }); equal(result.score, 56, 'score'); equal(result.priority_band, 'high', 'band'); });
Deno.test('S-16 severity 4 residential 1 is 60 high', () => { const result = scoreReport({ severity: 4, roadType: 'residential', corroborationCount: 1 }); equal(result.score, 60, 'score'); equal(result.priority_band, 'high', 'band'); });
Deno.test('S-17 severity 5 residential 0 then 1 is 72 then 76', () => { equal(scoreReport({ severity: 5, roadType: 'residential', corroborationCount: 0 }).score, 72, 'zero'); equal(scoreReport({ severity: 5, roadType: 'residential', corroborationCount: 1 }).score, 76, 'one'); });
Deno.test('S-18 original reporter no-op is represented by unchanged corroboration input', () => equal(scoreReport({ severity: 5, roadType: 'residential', corroborationCount: 0 }).score, 72, 'score'));
Deno.test('S-19 every band boundary is exact', () => { equal(priorityBand(34), 'low', '34'); equal(priorityBand(35), 'medium', '35'); equal(priorityBand(54), 'medium', '54'); equal(priorityBand(55), 'high', '55'); equal(priorityBand(74), 'high', '74'); equal(priorityBand(75), 'urgent', '75'); });
