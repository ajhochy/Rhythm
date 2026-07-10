/**
 * org_diagnosis_types.ts — #971 shared contract for the org-optimizer LLM
 * diagnosis lane.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the machine-applyable patch
 * shapes and the diagnosis result the LLM produces. The diagnosis PRODUCER
 * (workflow_signal_generator.ts) and every Wave-2 CONSUMER (the
 * refine-config/refine-scope appliers, the behavioral-measure step, the
 * re-diagnosis feedback loop) import these types so the producer and the
 * appliers can never drift out of shape.
 *
 * These are types + frozen field-name constants only — no runtime logic —
 * so importing this module is free of side effects and safe from any layer.
 */

/**
 * Machine-applyable patch shape for a `refine-config` proposal — a scalar
 * field swap on one `agent_configs` row.
 *
 * `agentConfigId` here is the AUTHORITATIVE, server-resolved id (the producer
 * re-resolves it from the failing signal's own profile via
 * AgentConfigsRepository — the LLM's emitted id is never trusted). A consumer
 * MAY treat it as already-validated.
 */
export interface ConfigPatch {
  agentConfigId: string;
  field: 'model' | 'allowedSkillsJson' | 'allowedDelegatesJson' | 'system_prompt';
  value: string;
}

/**
 * Machine-applyable patch shape for a `refine-scope` proposal — reuses the
 * `AgentConfigScopeChange` field set org_proposal_apply.ts already knows how
 * to apply (`allowedMcpsJson` | `allowedSkillsJson`, add/remove set
 * arithmetic). `agentConfigId` is server-resolved (see {@link ConfigPatch}).
 */
export interface ScopePatch {
  agentConfigId: string;
  field: 'allowedMcpsJson' | 'allowedSkillsJson';
  add?: string[];
  remove?: string[];
}

/**
 * Machine-applyable patch shape for a `refine-task` proposal (#981) — a scalar
 * field swap on one `agent_scheduled_tasks` row (the scheduled-task definition
 * the optimizer wants to correct: wrong instructions/prompt, wrong schedule,
 * or wrong agent binding).
 *
 * `scheduledTaskId` is the AUTHORITATIVE, server-resolved id — the producer
 * resolves it from the failing signal's OWN task (the scheduled_task_id on the
 * failing session), never from the LLM's emitted id (mirrors {@link ConfigPatch}).
 * The `prompt` field is the scheduled task's run instructions (issue #981's
 * "instructions"); `description` is its human-facing note.
 */
export interface TaskPatch {
  scheduledTaskId: string;
  field: 'prompt' | 'description' | 'cronExpression' | 'scheduledTime' | 'agentConfigId';
  value: string;
}

/**
 * The structured diagnosis returned by the LLM for a group of failure signals
 * targeting the same profile + error signature. The LLM reads the full
 * context (profile config, skill body, error evidence, denied tools,
 * delegation edges) and determines the root cause + a concrete fix.
 */
export interface DiagnosisResult {
  /** What's actually wrong, in plain language. */
  diagnosis: string;
  /** Root cause category. */
  rootCause: 'skill' | 'config' | 'scope' | 'delegation' | 'task' | 'external';
  /** What kind of fix to propose. 'external-noop' means no proposal — log only. */
  fixType:
    | 'skill-edit'
    | 'config-change'
    | 'scope-change'
    | 'delegation-change'
    | 'task-change'
    | 'external-noop';
  /** The actual fix text — concrete, actionable, not vague advice. */
  concreteFix: string;
  /** LLM confidence in the diagnosis. */
  confidence: 'high' | 'medium' | 'low';
  /**
   * Optional structured, machine-applyable patch for a `config-change`
   * diagnosis. UNTRUSTED as emitted by the LLM — the producer re-resolves
   * `agentConfigId` server-side before it is ever persisted or applied.
   */
  configPatch?: ConfigPatch;
  /** Same contract as {@link DiagnosisResult.configPatch}, for `scope-change`. */
  scopePatch?: ScopePatch;
  /**
   * Same contract as {@link DiagnosisResult.configPatch}, for `task-change`
   * (#981). `scheduledTaskId` is re-resolved server-side from the failing
   * signal's own task — the LLM-emitted id is never trusted.
   */
  taskPatch?: TaskPatch;
}

/** The single source of truth for legal `refine-config` (ConfigPatch) fields. */
export const CONFIG_PATCH_FIELDS = ['model', 'allowedSkillsJson', 'allowedDelegatesJson', 'system_prompt'] as const;
/** The single source of truth for legal `refine-scope` (ScopePatch) fields. */
export const SCOPE_PATCH_FIELDS = ['allowedMcpsJson', 'allowedSkillsJson'] as const;
/** The single source of truth for legal `refine-task` (TaskPatch) fields. */
export const TASK_PATCH_FIELDS = ['prompt', 'description', 'cronExpression', 'scheduledTime', 'agentConfigId'] as const;
/** TaskPatch fields measured by LLM-judge (text edits) vs behavioral re-run (schedule/binding). */
export const TASK_PATCH_TEXT_FIELDS = ['prompt', 'description'] as const;
