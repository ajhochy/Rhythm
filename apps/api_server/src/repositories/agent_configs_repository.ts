import { getDb } from '../database/db';

export interface AgentConfig {
  id: string;
  label: string;
  icon: string;
  command: string;
  enabled: boolean;
  isAgent: boolean;
  canResume: boolean;
  resumeCommand: string | null;
  sessionIdPattern: string | null;
  outputMarker: string | null;
  presetId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfigInput {
  id?: string;
  label: string;
  icon: string;
  command: string;
  enabled?: boolean;
  isAgent?: boolean;
  canResume?: boolean;
  resumeCommand?: string | null;
  sessionIdPattern?: string | null;
  outputMarker?: string | null;
  presetId?: string | null;
  sortOrder?: number;
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
  return {
    id: row.id,
    label: row.label,
    icon: row.icon,
    command: row.command,
    enabled: row.enabled !== 0,
    isAgent: row.is_agent !== 0,
    canResume: row.can_resume !== 0,
    resumeCommand: row.resume_command,
    sessionIdPattern: row.session_id_pattern,
    outputMarker: row.output_marker,
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
        config.command,
        config.enabled !== false ? 1 : 0,
        config.isAgent !== false ? 1 : 0,
        config.canResume ? 1 : 0,
        config.resumeCommand ?? null,
        config.sessionIdPattern ?? null,
        config.outputMarker ?? null,
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
    if (patch.command !== undefined) {
      fields.push('command = ?');
      values.push(patch.command);
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.isAgent !== undefined) {
      fields.push('is_agent = ?');
      values.push(patch.isAgent ? 1 : 0);
    }
    if (patch.canResume !== undefined) {
      fields.push('can_resume = ?');
      values.push(patch.canResume ? 1 : 0);
    }
    if ('resumeCommand' in patch) {
      fields.push('resume_command = ?');
      values.push(patch.resumeCommand ?? null);
    }
    if ('sessionIdPattern' in patch) {
      fields.push('session_id_pattern = ?');
      values.push(patch.sessionIdPattern ?? null);
    }
    if ('outputMarker' in patch) {
      fields.push('output_marker = ?');
      values.push(patch.outputMarker ?? null);
    }
    if (patch.sortOrder !== undefined) {
      fields.push('sort_order = ?');
      values.push(patch.sortOrder);
    }

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
