type RecordValue = Record<string, unknown>;

function record(input: unknown): RecordValue {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected an object.');
  return input as RecordValue;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}

function integerBetween(value: unknown, name: string, min: number, max: number): number {
  const number = finiteNumber(value, name);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} is out of range.`);
  return number;
}

function oneOf<T extends string>(value: unknown, name: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${name} is invalid.`);
  return value as T;
}

const damageTypes = ['pothole', 'crack', 'surface_damage', 'other', 'unknown'] as const;
const statuses = ['uploaded', 'processing', 'ready', 'failed', 'needs_review', 'duplicate'] as const;

export const damageTypeSchema = { parse: (value: unknown) => oneOf(value, 'damage_type', damageTypes) };
export const locationSourceSchema = { parse: (value: unknown) => oneOf(value, 'location_source', ['gps'] as const) };
export const reportStatusSchema = { parse: (value: unknown) => oneOf(value, 'status', statuses) };

export type CreateReportRequest = {
  image_path: string;
  latitude: number;
  longitude: number;
  location_source: 'gps';
  damage_type?: typeof damageTypes[number];
  severity?: number;
};

export type VisionResult = {
  damage_type: typeof damageTypes[number];
  severity: number;
  confidence: number;
  summary: string;
};

export const createReportRequestSchema = {
  parse(input: unknown): CreateReportRequest {
    const value = record(input);
    if (typeof value.image_path !== 'string' || !/^[0-9a-f-]{36}\/[^/]+$/i.test(value.image_path)) throw new Error('image_path must start with a UUID folder and contain a filename.');
    const latitude = finiteNumber(value.latitude, 'latitude');
    const longitude = finiteNumber(value.longitude, 'longitude');
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('Coordinates are invalid.');
    const location_source = locationSourceSchema.parse(value.location_source);
    const damage_type = value.damage_type === undefined ? undefined : damageTypeSchema.parse(value.damage_type);
    const severity = value.severity === undefined ? undefined : integerBetween(value.severity, 'severity', 1, 5);
    return { image_path: value.image_path, latitude, longitude, location_source, damage_type, severity };
  },
};

export const visionResultSchema = {
  parse(input: unknown): VisionResult {
    const value = record(input);
    const damage_type = damageTypeSchema.parse(value.damage_type);
    const severity = integerBetween(value.severity, 'severity', 1, 5);
    const confidence = finiteNumber(value.confidence, 'confidence');
    if (confidence < 0 || confidence > 1) throw new Error('confidence is out of range.');
    if (typeof value.summary !== 'string' || value.summary.length === 0 || value.summary.length > 500) throw new Error('summary is invalid.');
    return { damage_type, severity, confidence, summary: value.summary };
  },
};

export const reportStatusResponseSchema = {
  parse(input: unknown) {
    const value = record(input);
    if (typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id)) throw new Error('id is invalid.');
    return { id: value.id, status: reportStatusSchema.parse(value.status) };
  },
};

export function parseCreateReportRequest(input: unknown): CreateReportRequest {
  return createReportRequestSchema.parse(input);
}

export function parseVisionResult(input: unknown): VisionResult {
  return visionResultSchema.parse(input);
}
