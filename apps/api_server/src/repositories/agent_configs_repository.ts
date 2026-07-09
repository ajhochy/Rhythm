import { getDb } from '../database/db';
import { isReservedAgentConfigId } from '../services/opencode_agent_writer';

export interface AgentConfig {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  isAgent: boolean;
  isManager: boolean;
  systemPrompt: string | null;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
  corePermissionsJson: string | null;
  allowedDelegatesJson: string | null;
  presetId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Preferred provider for AgentRunner model resolution (e.g. "anthropic").
   * Null means "fall back to most-recently-used session model or hardcoded default".
   */
  modelProvider: string | null;
  /**
   * Preferred model id for AgentRunner model resolution
   * (e.g. "claude-sonnet-4-5"). Null when no preference is set.
   */
  modelId: string | null;
  /**
   * OpenCode built-in agent mode for this profile (e.g. 'build', 'plan').
   * Null means use the opencode default ('build').
   */
  ocAgent: string | null;
  /**
   * True when this profile should appear in session-level agent pickers (the
   * composer AgentSelectorPill). Subagents and opencode internal primaries are
   * seeded false so they exist as profiles without cluttering the picker.
   */
  sessionSelectable: boolean;
  /**
   * #844 — optional tier preference ('cheap' | 'standard' | 'frontier') fed to
   * agent_model_resolver.resolveModelTier() as the `explicitTierHint`. Wins
   * over the task-kind default; itself loses to an explicit per-call model
   * override. Null means "no profile-level tier preference".
   */
  modelTierHint: string | null;
  /**
   * Task D (dual Anthropic accounts) — profile-level default account id for
   * sessions created with this profile. Null = fall back to the store default.
   */
  defaultAnthropicAccountId: string | null;
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
  isManager?: boolean;
  systemPrompt?: string | null;
  allowedMcpsJson?: string | null;
  allowedSkillsJson?: string | null;
  corePermissionsJson?: string | null;
  allowedDelegatesJson?: string | null;
  presetId?: string | null;
  sortOrder?: number;
  /** Preferred provider for AgentRunner model resolution (e.g. "anthropic"). */
  modelProvider?: string | null;
  /** Preferred model id for AgentRunner model resolution (e.g. "claude-sonnet-4-5"). */
  modelId?: string | null;
  /** OpenCode built-in agent mode (e.g. 'build', 'plan'). Null = default. */
  ocAgent?: string | null;
  /** Whether this profile appears in session-level agent pickers. Default true. */
  sessionSelectable?: boolean;
  /** #844 — optional tier preference ('cheap' | 'standard' | 'frontier'). Null = no preference. */
  modelTierHint?: string | null;
  /** Task D — profile-level default Anthropic account id. Null = store default. */
  defaultAnthropicAccountId?: string | null;
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
  is_manager: number;
  system_prompt: string | null;
  allowed_mcps_json: string | null;
  allowed_skills_json: string | null;
  core_permissions_json: string | null;
  allowed_delegates_json: string | null;
  can_resume: number;
  resume_command: string | null;
  session_id_pattern: string | null;
  output_marker: string | null;
  preset_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  model_provider: string | null;
  model_id: string | null;
  oc_agent: string | null;
  session_selectable: number;
  model_tier_hint: string | null;
  default_anthropic_account_id: string | null;
}

export function slugIdFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveAgentConfigIdFromLabel(
  label: string,
  exists: (id: string) => boolean,
): string {
  const derivedId = slugIdFromLabel(label);
  return derivedId && !isReservedAgentConfigId(derivedId) && !exists(derivedId)
    ? derivedId
    : crypto.randomUUID();
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
    isManager: (row.is_manager ?? 0) !== 0,
    systemPrompt: row.system_prompt ?? null,
    allowedMcpsJson: row.allowed_mcps_json ?? null,
    allowedSkillsJson: row.allowed_skills_json ?? null,
    corePermissionsJson: row.core_permissions_json ?? null,
    allowedDelegatesJson: row.allowed_delegates_json ?? null,
    presetId: row.preset_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    modelProvider: row.model_provider ?? null,
    modelId: row.model_id ?? null,
    ocAgent: row.oc_agent ?? null,
    sessionSelectable: (row.session_selectable ?? 1) !== 0,
    modelTierHint: row.model_tier_hint ?? null,
    defaultAnthropicAccountId: row.default_anthropic_account_id ?? null,
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
    const id = config.id ?? deriveAgentConfigIdFromLabel(
      config.label,
      (candidate) => this.getById(candidate) !== null,
    );
    const now = new Date().toISOString();
    // Legacy CLI fields on `config` (command, canResume, resumeCommand,
    // sessionIdPattern, outputMarker) are intentionally ignored. They are
    // written as the schema's NULL/default values so every new row is
    // uniform (issue #581). The `command` column is NOT NULL, so we write
    // an empty string for new rows.
    getDb()
      .prepare(
        `INSERT INTO agent_configs
          (id, label, icon, command, enabled, is_agent, is_manager, system_prompt,
           allowed_mcps_json, allowed_skills_json, core_permissions_json, allowed_delegates_json, can_resume,
           resume_command, session_id_pattern, output_marker, preset_id, sort_order,
           model_provider, model_id, oc_agent, session_selectable, model_tier_hint,
           default_anthropic_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        config.label,
        config.icon,
        '', // command — legacy, no longer populated
        config.enabled !== false ? 1 : 0,
        config.isAgent !== false ? 1 : 0,
        config.isManager ? 1 : 0,
        config.systemPrompt ?? null,
        config.allowedMcpsJson ?? null,
        config.allowedSkillsJson ?? null,
        config.corePermissionsJson ?? null,
        config.allowedDelegatesJson ?? null,
        0, // can_resume — legacy
        null, // resume_command — legacy
        null, // session_id_pattern — legacy
        null, // output_marker — legacy
        config.presetId ?? null,
        config.sortOrder ?? 0,
        config.modelProvider ?? null,
        config.modelId ?? null,
        config.ocAgent ?? null,
        config.sessionSelectable === false ? 0 : 1,
        config.modelTierHint ?? null,
        config.defaultAnthropicAccountId ?? null,
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
    if (patch.isManager !== undefined) {
      fields.push('is_manager = ?');
      values.push(patch.isManager ? 1 : 0);
    }
    if (patch.systemPrompt !== undefined) {
      fields.push('system_prompt = ?');
      values.push(patch.systemPrompt ?? null);
    }
    if (patch.allowedMcpsJson !== undefined) {
      fields.push('allowed_mcps_json = ?');
      values.push(patch.allowedMcpsJson ?? null);
    }
    if (patch.allowedSkillsJson !== undefined) {
      fields.push('allowed_skills_json = ?');
      values.push(patch.allowedSkillsJson ?? null);
    }
    if (patch.corePermissionsJson !== undefined) {
      fields.push('core_permissions_json = ?');
      values.push(patch.corePermissionsJson ?? null);
    }
    if (patch.allowedDelegatesJson !== undefined) {
      fields.push('allowed_delegates_json = ?');
      values.push(patch.allowedDelegatesJson ?? null);
    }
    if (patch.sortOrder !== undefined) {
      fields.push('sort_order = ?');
      values.push(patch.sortOrder);
    }
    if (patch.modelProvider !== undefined) {
      fields.push('model_provider = ?');
      values.push(patch.modelProvider ?? null);
    }
    if (patch.modelId !== undefined) {
      fields.push('model_id = ?');
      values.push(patch.modelId ?? null);
    }
    if (patch.ocAgent !== undefined) {
      fields.push('oc_agent = ?');
      values.push(patch.ocAgent ?? null);
    }
    if (patch.sessionSelectable !== undefined) {
      fields.push('session_selectable = ?');
      values.push(patch.sessionSelectable ? 1 : 0);
    }
    if (patch.modelTierHint !== undefined) {
      fields.push('model_tier_hint = ?');
      values.push(patch.modelTierHint ?? null);
    }
    if (patch.defaultAnthropicAccountId !== undefined) {
      fields.push('default_anthropic_account_id = ?');
      values.push(patch.defaultAnthropicAccountId ?? null);
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
