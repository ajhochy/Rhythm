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
   * #1088 — resolved schedulability: whether AgentRunner may launch this
   * profile directly as a top-level agent (scheduled/background work),
   * independent of picker visibility. Falls back to `sessionSelectable` when
   * no explicit override is stored (see `schedulableOverride`), so existing
   * rows behave exactly as before this field existed until edited.
   * Optional on the TYPE (not just the DB column) so hand-built AgentConfig
   * fixtures that predate #1088 still type-check; callers that need the
   * resolved value should read `config.schedulable ?? config.sessionSelectable`
   * — real repository reads always populate it, this fallback only matters
   * for literal test fixtures.
   */
  schedulable?: boolean;
  /**
   * #1088 — the raw override value as stored, before the `sessionSelectable`
   * fallback is applied. `null` means "inherit sessionSelectable"; a boolean
   * is an explicit user choice (e.g. a hidden specialist made schedulable).
   * Exposed so callers can round-trip "inherit" vs "explicitly true/false"
   * through the API without collapsing the distinction.
   */
  schedulableOverride?: boolean | null;
  /**
   * #844 — optional tier preference ('cheap' | 'standard' | 'frontier') fed to
   * agent_model_resolver.resolveModelTier() as the `explicitTierHint`. Wins
   * over the task-kind default; itself loses to an explicit per-call model
   * override. Null means "no profile-level tier preference".
   */
  modelTierHint: string | null;
  defaultAnthropicAccountId: string | null;
  /**
   * #1094 — OpenAI native `image_generation` tool grant, separate from
   * `allowedMcpsJson` (this is a provider-native/hosted tool, not an MCP
   * server) and from the general `corePermissionsJson` map (a dedicated,
   * designer-discoverable boolean rather than requiring the caller to know
   * the `image_generation` permission-key name). When true, the writer
   * projects `permission.image_generation: allow` into frontmatter; the
   * existing ask/allow/deny approval flow still governs the actual call.
   * Optional on the TYPE (like `schedulable`) so pre-#1094 hand-built
   * AgentConfig fixtures still type-check; real repository reads always
   * populate it. Writer/controller code treats `undefined` as `false`.
   */
  imageGenerationEnabled?: boolean;
  /**
   * #1118 — per-profile reasoning-effort / thinking-budget value (e.g.
   * 'low'/'medium'/'high'/'xhigh'/'max'), projected by the writer into the
   * agent frontmatter's `options.effort`. Null = provider default (no
   * restriction). Optional on the TYPE (like `schedulable`) so pre-#1118
   * hand-built AgentConfig fixtures still type-check; real repository reads
   * always populate it.
   */
  reasoningEffort?: string | null;
  /**
   * #1135 — security/audit lock. Unlike the ordinary `enabled` preference,
   * this state is authoritative for every execution path and can only be
   * cleared by the reviewed-reenable transition.
   */
  locked?: boolean;
  disabledReason?: string | null;
  lockedAt?: string | null;
  lockedBy?: string | null;
  /**
   * Config Doctor Track B (interim unblock) — when true, approvals created
   * for this profile's actions are auto-approved (status='approved',
   * actor='auto-approved') instead of sitting pending for a human. See
   * `isAutoApproveProfile()` / `AgentApprovalsRepository.create()`. Default
   * false — this is a deliberate per-profile security-gate bypass, not a
   * global default change.
   */
  autoApproveActions?: boolean;
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
  /**
   * #1088 — explicit schedulability override, independent of picker
   * visibility. `null`/omitted = inherit `sessionSelectable` (default,
   * unchanged behavior); `true`/`false` = explicit override.
   */
  schedulable?: boolean | null;
  /** #844 — optional tier preference ('cheap' | 'standard' | 'frontier'). Null = no preference. */
  modelTierHint?: string | null;
  /** Task D — profile-level default Anthropic account id. Null = store default. */
  defaultAnthropicAccountId?: string | null;
  /** #1094 — grant the OpenAI native image_generation tool. Default false. */
  imageGenerationEnabled?: boolean;
  /** #1118 — per-profile reasoning-effort value. Null/omitted = provider default. */
  reasoningEffort?: string | null;
  /** Config Doctor Track B — auto-approve this profile's protected actions. Default false. */
  autoApproveActions?: boolean;
  // Legacy fields — accepted on the input shape for back-compat with stale
  // clients, but silently ignored by insert()/update() (issue #581).
  command?: string;
  canResume?: boolean;
  resumeCommand?: string | null;
  sessionIdPattern?: string | null;
  outputMarker?: string | null;
}

export interface AgentConfigRow {
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
  schedulable: number | null;
  image_generation_enabled: number;
  reasoning_effort: string | null;
  locked?: number;
  disabled_reason?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  auto_approve_actions?: number;
}

export type AgentConfigSecurityEventType = 'locked' | 'reviewed_reenabled';

export interface AgentConfigSecurityEvent {
  id: string;
  agentConfigId: string;
  eventType: AgentConfigSecurityEventType;
  actor: string;
  reason: string;
  reviewNote: string | null;
  lockVersion: string;
  createdAt: string;
}

interface AgentConfigSecurityEventRow {
  id: string;
  agent_config_id: string;
  event_type: AgentConfigSecurityEventType;
  actor: string;
  reason: string;
  review_note: string | null;
  lock_version: string;
  created_at: string;
}

export interface ReviewedReenableInput {
  expectedLockedAt: string;
  expectedDisabledReason: string;
  reviewedBy: string;
  reviewNote: string;
}

/**
 * Returns the user-facing reason a profile cannot execute, or null when it
 * is runnable. The lock is checked independently of `enabled`: even if a
 * stale writer flips enabled back to 1, an audit-locked profile stays inert.
 */
export function agentConfigExecutionBlockReason(config: AgentConfig): string | null {
  if (config.locked === true) {
    return config.disabledReason
      ? `agent security-locked: '${config.id}' (${config.disabledReason})`
      : `agent security-locked: '${config.id}'`;
  }
  if (!config.enabled) return `agent disabled: '${config.id}'`;
  return null;
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
    schedulable: row.schedulable !== null && row.schedulable !== undefined
      ? row.schedulable !== 0
      : (row.session_selectable ?? 1) !== 0,
    schedulableOverride: row.schedulable !== null && row.schedulable !== undefined
      ? row.schedulable !== 0
      : null,
    modelTierHint: row.model_tier_hint ?? null,
    defaultAnthropicAccountId: row.default_anthropic_account_id ?? null,
    imageGenerationEnabled: (row.image_generation_enabled ?? 0) !== 0,
    reasoningEffort: row.reasoning_effort ?? null,
    locked: (row.locked ?? 0) !== 0,
    disabledReason: row.disabled_reason ?? null,
    lockedAt: row.locked_at ?? null,
    lockedBy: row.locked_by ?? null,
    autoApproveActions: (row.auto_approve_actions ?? 0) !== 0,
  };
}

/** Internal row mapper shared by fixed, cross-table SQLite transactions. */
export function mapAgentConfigRow(row: AgentConfigRow): AgentConfig {
  return rowToModel(row);
}

function securityEventRowToModel(row: AgentConfigSecurityEventRow): AgentConfigSecurityEvent {
  return {
    id: row.id,
    agentConfigId: row.agent_config_id,
    eventType: row.event_type,
    actor: row.actor,
    reason: row.reason,
    reviewNote: row.review_note ?? null,
    lockVersion: row.lock_version,
    createdAt: row.created_at,
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
        `SELECT * FROM agent_configs
          WHERE enabled = 1 AND COALESCE(locked, 0) = 0
          ORDER BY sort_order, label`,
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

  /**
   * Compare-and-set one scope column using a fixed field-to-column map. The
   * caller-provided field is never interpolated into SQL.
   */
  compareAndSetScopeField(
    id: string,
    field: 'allowedMcpsJson' | 'allowedSkillsJson' | 'corePermissionsJson',
    expectedPriorValue: string | null,
    nextValue: string | null,
  ): AgentConfig | null {
    const columnByField = {
      allowedMcpsJson: 'allowed_mcps_json',
      allowedSkillsJson: 'allowed_skills_json',
      corePermissionsJson: 'core_permissions_json',
    } as const;
    const column = columnByField[field];
    if (!column) throw new Error(`Unsupported agent config scope field: ${String(field)}`);
    const row = getDb()
      .prepare(
        `UPDATE agent_configs
            SET ${column} = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND ${column} IS ?
          RETURNING *`,
      )
      .get(nextValue, id, expectedPriorValue) as AgentConfigRow | undefined;
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
           default_anthropic_account_id, schedulable, image_generation_enabled,
           reasoning_effort, auto_approve_actions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        config.schedulable === undefined || config.schedulable === null
          ? null
          : config.schedulable ? 1 : 0,
        config.imageGenerationEnabled ? 1 : 0,
        config.reasoningEffort ?? null,
        config.autoApproveActions ? 1 : 0,
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
    if (patch.schedulable !== undefined) {
      fields.push('schedulable = ?');
      values.push(patch.schedulable === null ? null : patch.schedulable ? 1 : 0);
    }
    if (patch.imageGenerationEnabled !== undefined) {
      fields.push('image_generation_enabled = ?');
      values.push(patch.imageGenerationEnabled ? 1 : 0);
    }
    if (patch.modelTierHint !== undefined) {
      fields.push('model_tier_hint = ?');
      values.push(patch.modelTierHint ?? null);
    }
    if (patch.defaultAnthropicAccountId !== undefined) {
      fields.push('default_anthropic_account_id = ?');
      values.push(patch.defaultAnthropicAccountId ?? null);
    }
    if (patch.reasoningEffort !== undefined) {
      fields.push('reasoning_effort = ?');
      values.push(patch.reasoningEffort ?? null);
    }
    if (patch.autoApproveActions !== undefined) {
      fields.push('auto_approve_actions = ?');
      values.push(patch.autoApproveActions ? 1 : 0);
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

  /**
   * Atomically disables + security-locks a profile and appends immutable
   * audit evidence. Returns null if the row vanished or was already locked.
   */
  lockForSecurity(id: string, reason: string, actor: string): AgentConfig | null {
    const db = getDb();
    return db.transaction(() => {
      const lockedAt = new Date().toISOString();
      const result = db
        .prepare(
          `UPDATE agent_configs
              SET enabled = 0,
                  locked = 1,
                  disabled_reason = ?,
                  locked_at = ?,
                  locked_by = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND COALESCE(locked, 0) = 0`,
        )
        .run(reason, lockedAt, actor, id);
      if (result.changes === 0) return null;

      db.prepare(
        `INSERT INTO agent_config_security_events
          (id, agent_config_id, event_type, actor, reason, review_note,
           lock_version, created_at)
         VALUES (?, ?, 'locked', ?, ?, NULL, ?, ?)`,
      ).run(crypto.randomUUID(), id, actor, reason, lockedAt, lockedAt);
      return this.getById(id);
    })();
  }

  /**
   * Clears a security lock only when the reviewer supplies the exact lock
   * version and reason they reviewed. The conditional update prevents a
   * stale approval from clearing a newer lock.
   */
  reviewedReenable(id: string, input: ReviewedReenableInput): AgentConfig | null {
    const db = getDb();
    return db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE agent_configs
              SET enabled = 1,
                  locked = 0,
                  disabled_reason = NULL,
                  locked_at = NULL,
                  locked_by = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND locked = 1
              AND locked_at = ?
              AND disabled_reason = ?`,
        )
        .run(id, input.expectedLockedAt, input.expectedDisabledReason);
      if (result.changes === 0) return null;

      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_config_security_events
          (id, agent_config_id, event_type, actor, reason, review_note,
           lock_version, created_at)
         VALUES (?, ?, 'reviewed_reenabled', ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        id,
        input.reviewedBy,
        input.expectedDisabledReason,
        input.reviewNote,
        input.expectedLockedAt,
        createdAt,
      );
      return this.getById(id);
    })();
  }

  listSecurityEvents(id: string): AgentConfigSecurityEvent[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_config_security_events
          WHERE agent_config_id = ?
          ORDER BY created_at, id`,
      )
      .all(id) as AgentConfigSecurityEventRow[];
    return rows.map(securityEventRowToModel);
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
