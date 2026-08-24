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

/** Array-backed profile scope fields. `broaden-scope` intentionally uses only these. */
export const SCOPE_ALLOWLIST_FIELDS = ['allowedMcpsJson', 'allowedSkillsJson'] as const;
/** The single source of truth for legal `refine-scope` (ScopePatch) fields. */
export const SCOPE_PATCH_FIELDS = [...SCOPE_ALLOWLIST_FIELDS, 'corePermissionsJson'] as const;

/** Opencode core permission names accepted by the embedded engine. */
export const CORE_PERMISSION_NAMES = [
  'read', 'write', 'edit', 'glob', 'grep', 'list', 'bash', 'task',
  'external_directory', 'todowrite', 'question', 'webfetch', 'websearch',
  'repo_clone', 'repo_overview', 'lsp', 'doom_loop', 'skill', 'image_generation',
] as const;
export const CORE_PERMISSION_ACTIONS = ['allow', 'ask', 'deny'] as const;

/**
 * Machine-applyable patch shape for a `refine-scope` proposal. Array allowlists
 * use add/remove set arithmetic; core permissions use set/unset so nested
 * pattern maps can be merged without replacing unrelated rules.
 */
export interface ScopePatch {
  agentConfigId: string;
  field: (typeof SCOPE_PATCH_FIELDS)[number];
  add?: string[];
  remove?: string[];
  set?: Record<string, unknown>;
  unset?: string[];
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

/**
 * C6 (repair item 3) — a named, versioned, FIXED mapping from the LLM
 * diagnosis's high/medium/low confidence verdict to a numeric [0,1] the
 * evidence builder may later cite as a proposal's durable
 * `diagnosisConfidence`. Bump the version string (never mutate the numbers
 * behind an already-shipped version) if the mapping ever changes — mirrors
 * ANALYSIS_VERSION in org_proposal_experiment_service.ts. These are FIXED
 * calibration constants, not a per-proposal guess: the mapping itself is
 * never parsed from prose and never invented per call.
 */
export const DIAGNOSIS_CONFIDENCE_MAPPING_VERSION = 'diagnosis-confidence-map-v1';

const DIAGNOSIS_CONFIDENCE_MAP: Record<DiagnosisResult['confidence'], number> = {
  high: 0.8,
  medium: 0.5,
  low: 0.2,
};

/** Converts a diagnosis's high/medium/low verdict through the fixed, versioned mapping above. */
export function mapDiagnosisConfidence(confidence: DiagnosisResult['confidence']): number {
  return DIAGNOSIS_CONFIDENCE_MAP[confidence];
}

/** The single source of truth for legal `refine-config` (ConfigPatch) fields. */
export const CONFIG_PATCH_FIELDS = ['model', 'allowedSkillsJson', 'allowedDelegatesJson', 'system_prompt'] as const;
/** The single source of truth for legal `refine-task` (TaskPatch) fields. */
export const TASK_PATCH_FIELDS = ['prompt', 'description', 'cronExpression', 'scheduledTime', 'agentConfigId'] as const;
/** TaskPatch fields measured by LLM-judge (text edits) vs behavioral re-run (schedule/binding). */
export const TASK_PATCH_TEXT_FIELDS = ['prompt', 'description'] as const;
