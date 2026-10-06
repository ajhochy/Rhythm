/**
 * Generic memory surfaces never release Dayflow activity. Dayflow has a
 * separate recipient-qualified source/consent/expiry reader and a per-turn
 * receiving manifest; the generic index cannot attest those facts. A
 * malformed Dayflow-shaped metadata record stays withheld rather than
 * becoming an ordinary-memory escape hatch.
 *
 * This is the ONE pure decision. The JS guard, the registered SQLite scalar
 * (so membership is decided before any LIMIT/OFFSET/count/search budget) and
 * retrieval all call it; nothing approximates it with a raw-text substring.
 * Semantics: the `source` string, then each metadata column is JSON.parsed and
 * every string found in its decoded values (nested arrays/objects, root
 * strings, duplicate keys resolved by JSON.parse; keys are NOT values) is
 * tested; a column that is not valid JSON is tested literally. Null columns
 * contribute nothing.
 */
export interface GenericAdmissionFields {
  source?: string | null;
  tagsJson?: string | null;
  sourcesJson?: string | null;
}

function hasDayflowMarker(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().toLowerCase().includes('dayflow');
  if (Array.isArray(value)) return value.some((candidate) => hasDayflowMarker(candidate));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((candidate) => hasDayflowMarker(candidate));
}

export function isGenericMemoryAdmissionAllowedFields(fields: GenericAdmissionFields): boolean {
  if (typeof fields.source === 'string' && /dayflow/iu.test(fields.source)) return false;
  for (const raw of [fields.tagsJson, fields.sourcesJson]) {
    if (typeof raw !== 'string') continue;
    try {
      if (hasDayflowMarker(JSON.parse(raw))) return false;
    } catch {
      // A literal marker in malformed metadata is still enough to withhold.
      if (/dayflow/iu.test(raw)) return false;
    }
  }
  return true;
}

/** Name of the deterministic SQLite scalar registered by the database layer. */
export const GENERIC_ADMISSION_SQL_FUNCTION = 'rhythm_generic_memory_admitted';

/** SQLite scalar body: 1 when admitted, 0 when withheld. */
export function genericAdmissionScalar(
  source: unknown,
  tagsJson: unknown,
  sourcesJson: unknown,
): number {
  return isGenericMemoryAdmissionAllowedFields({
    source: typeof source === 'string' ? source : null,
    tagsJson: typeof tagsJson === 'string' ? tagsJson : null,
    sourcesJson: typeof sourcesJson === 'string' ? sourcesJson : null,
  }) ? 1 : 0;
}
