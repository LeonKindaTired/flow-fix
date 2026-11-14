export type Environment = Record<string, string | undefined>;
export type NumberOptions = { min?: number };

export function readString(name: string, fallback?: string, env?: Environment): string | undefined {
  const value = env ? env[name] : Deno.env.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export function readNumber(name: string, fallback: number, options: NumberOptions = {}, env?: Environment): number {
  const raw = readString(name, undefined, env);
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) && (options.min === undefined || value >= options.min) ? value : fallback;
}
