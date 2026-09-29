import { getDb } from '../database/db';

/** Key used by the visibility map: `${provider}\0${modelId}`. */
export const visibilityKey = (provider: string, modelId: string): string => `${provider}\0${modelId}`;

/**
 * Rhythm's user-curated model visibility (`agent_model_visibility`, managed by
 * PATCH /agent-models/visibility). Absent key = no curation row (provider policy default
 * applies); true = explicit opt-in; false = explicit hide. Synchronous and never throws:
 * any DB error (table missing on first run, DB not initialised) yields "no rows".
 */
export function loadModelVisibility(): Map<string, boolean> {
  const visibility = new Map<string, boolean>();
  try {
    const rows = getDb().prepare(
      'SELECT provider, model_id, visible FROM agent_model_visibility',
    ).all() as { provider: string; model_id: string; visible: number }[];
    for (const row of rows) {
      visibility.set(visibilityKey(row.provider, row.model_id), row.visible === 1);
    }
  } catch {
    // Table may not exist on first run.
  }
  return visibility;
}
