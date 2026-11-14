export const SCORE_VERSION = 'v1' as const;
export const DEFAULT_REVIEW_THRESHOLD = 0.60;

export const ROAD_WEIGHTS = {
  primary: 100,
  secondary: 80,
  tertiary: 65,
  residential: 45,
  service: 25,
  footway: 20,
  unknown: 40,
} as const;

export type PriorityBand = 'low' | 'medium' | 'high' | 'urgent';

export type ScoreInput = {
  severity: number | null | undefined;
  roadType?: string | null;
  corroborationCount: number;
  confidence?: number | null;
};

export type ScoreResult = {
  score: number;
  priority_band: PriorityBand;
  score_version: typeof SCORE_VERSION;
  needs_human_review: boolean;
  breakdown: {
    severity_component: number;
    road_component: number;
    community_component: number;
  };
};

export function priorityBand(score: number): PriorityBand {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error('score must be an integer from 0 to 100');
  if (score <= 34) return 'low';
  if (score <= 54) return 'medium';
  if (score <= 74) return 'high';
  return 'urgent';
}

export function roadWeight(roadType?: string | null): number {
  if (!roadType) return ROAD_WEIGHTS.unknown;
  return ROAD_WEIGHTS[roadType as keyof typeof ROAD_WEIGHTS] ?? ROAD_WEIGHTS.unknown;
}

export function scoreReport(input: ScoreInput, reviewThreshold = DEFAULT_REVIEW_THRESHOLD): ScoreResult {
  const severity = input.severity;
  if (typeof severity !== 'number' || !Number.isInteger(severity) || severity < 1 || severity > 5) {
    throw new Error('severity must be an integer from 1 to 5');
  }
  if (!Number.isInteger(input.corroborationCount) || input.corroborationCount < 0) {
    throw new Error('corroborationCount must be a non-negative integer');
  }
  if (!Number.isFinite(reviewThreshold) || reviewThreshold < 0 || reviewThreshold > 1) {
    throw new Error('reviewThreshold must be between 0 and 1');
  }
  if (input.confidence !== undefined && input.confidence !== null &&
      (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
    throw new Error('confidence must be between 0 and 1');
  }

  const severityComponent = (severity - 1) * 25;
  const roadComponent = roadWeight(input.roadType);
  const communityComponent = Math.min(input.corroborationCount, 5) * 20;
  const score = Math.round((65 * severityComponent + 15 * roadComponent + 20 * communityComponent) / 100);

  return {
    score,
    priority_band: priorityBand(score),
    score_version: SCORE_VERSION,
    needs_human_review: input.confidence !== undefined && input.confidence !== null && input.confidence < reviewThreshold,
    breakdown: {
      severity_component: severityComponent,
      road_component: roadComponent,
      community_component: communityComponent,
    },
  };
}
