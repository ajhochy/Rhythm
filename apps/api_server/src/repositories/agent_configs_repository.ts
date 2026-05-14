import { getDb } from '../database/db';

export interface AgentConfig {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  isAgent: boolean;
  presetId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // Legacy CLI fields — retained on the row but no longer used by the
  // Opencode-based client. Marked optional so consumers do not depend on
  // them. New writes set these to NULL / empty defaults (issue #581).
  command?: string;
  canResume?: boolean;
  resumeCommand?: string | null;
  sessionIdPattern?: string | null;
  outputMarker?: string | null;
}

export interface AgentConfigInput {
  id?: string;
  label: string;
  icon: string;
  enabled?: boolean;
  isAgent?: boolean;
  presetId?: string | null;
  sortOrder?: number;
  // Legacy fields — accepted on the input shape for back-compat with stale
  // clients, but silently ignored by insert()/update() (issue #581).
  command?: string;
  canResume?: boolean;
  resumeCommand?: string | null;
  sessionIdPattern?: string | null;
  outputMarker?: string | null;
}

interface AgentConfigRow {
  id: string;
  label: string;
  icon: string;
  command: string;
  enabled: number;
  is_agent: number;
  can_resume: number;
  resume_command: string | null;
  session_id_pattern: string | null;
  output_marker: string | null;
  preset_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToModel(row: AgentConfigRow): AgentConfig {
  // Legacy CLI columns (command, can_resume, resume_command, session_id_pattern,
  // output_marker) are intentionally NOT mapped onto the returned model — they
  // are obsolete under the Opencode engine. The DB schema retains them for
  // rollback compatibility (issue #575); the read shape simply omits them
  // (issue #581).
  return {
    id: row.id,
    label: row.label,
    icon: row.icon,
    enabled: row.enabled !== 0,
    isAgent: row.is_agent !== 0,
    presetId: row.preset_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentConfigsRepository {
  list(): AgentConfig[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_configs ORDER BY sort_order, label`,
      )
      .all() as AgentConfigRow[];
    return rows.map(rowToModel);
  }

  listEnabled(): AgentConfig[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_configs WHERE enabled = 1 ORDER BY sort_order, label`,
      )
      .all() as AgentConfigRow[];
    return rows.map(rowToModel);
  }

  getById(id: string): AgentConfig | null {
    const row = getDb()
      .prepare(`SELECT * FROM agent_configs WHERE id = ?`)
      .get(id) as AgentConfigRow | undefined;
    return row ? rowToModel(row) : null;
  }

  insert(config: AgentConfigInput): AgentConfig {
    const id = config.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    // Legacy CLI fields on `config` (command, canResume, resumeCommand,
    // sessionIdPattern, outputMarker) are intentionally ignored. They are
    // written as the schema's NULL/default values so every new row is
    // uniform (issue #581). The `command` column is NOT NULL, so we write
    // an empty string for new rows.
    getDb()
      .prepare(
        `INSERT INTO agent_configs
          (id, label, icon, command, enabled, is_agent, can_resume,
           resume_command, session_id_pattern, output_marker, preset_id, sort_order,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        config.label,
        config.icon,
        '', // command — legacy, no longer populated
        config.enabled !== false ? 1 : 0,
        config.isAgent !== false ? 1 : 0,
        0, // can_resume — legacy
        null, // resume_command — legacy
        null, // session_id_pattern — legacy
        null, // output_marker — legacy
        config.presetId ?? null,
        config.sortOrder ?? 0,
        now,
        now,
      );
    return this.getById(id)!;
  }

  update(id: string, patch: Partial<AgentConfigInput>): AgentConfig | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.label !== undefined) {
      fields.push('label = ?');
      values.push(patch.label);
    }
    if (patch.icon !== undefined) {
      fields.push('icon = ?');
      values.push(patch.icon);
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.isAgent !== undefined) {
      fields.push('is_agent = ?');
      values.push(patch.isAgent ? 1 : 0);
    }
    if (patch.sortOrder !== undefined) {
      fields.push('sort_order = ?');
      values.push(patch.sortOrder);
    }
    // Legacy CLI fields (command, canResume, resumeCommand, sessionIdPattern,
    // outputMarker) are silently ignored on update so stale clients can't
    // re-populate them (issue #581). The DB columns are retained for
    // rollback compatibility but new writes never touch them here.

    fields.push('updated_at = CURRENT_TIMESTAMP');

    if (fields.length === 1) {
      // Only updated_at was going to change — still apply it
    }

    values.push(id);
    getDb()
      .prepare(`UPDATE agent_configs SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  }

  remove(id: string): boolean {
    const existing = this.getById(id);
    if (!existing) return false;
    if (existing.presetId !== null) return false;

    const result = getDb()
      .prepare(`DELETE FROM agent_configs WHERE id = ? AND preset_id IS NULL`)
      .run(id);
    return result.changes > 0;
  }
}
