import { createHash } from 'node:crypto';

export function evaluationCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(evaluationCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${evaluationCanonicalJson(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export const evaluationDigest = (text: string): string => createHash('sha256').update(text).digest('hex');
