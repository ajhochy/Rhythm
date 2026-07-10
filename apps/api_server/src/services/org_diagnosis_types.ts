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
  field: 'model' | 'allowedSkillsJson' | 'allowedDelegatesJson';
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
 * The structured diagnosis returned by the LLM for a group of failure signals
 * targeting the same profile + error signature. The LLM reads the full
 * context (profile config, skill body, error evidence, denied tools,
 * delegation edges) and determines the root cause + a concrete fix.
 */
export interface DiagnosisResult {
  /** What's actually wrong, in plain language. */
  diagnosis: string;
  /** Root cause category. */
  rootCause: 'skill' | 'config' | 'scope' | 'delegation' | 'external';
  /** What kind of fix to propose. 'external-noop' means no proposal — log only. */
  fixType: 'skill-edit' | 'config-change' | 'scope-change' | 'delegation-change' | 'external-noop';
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
}

/** The single source of truth for legal `refine-config` (ConfigPatch) fields. */
export const CONFIG_PATCH_FIELDS = ['model', 'allowedSkillsJson', 'allowedDelegatesJson'] as const;
/** The single source of truth for legal `refine-scope` (ScopePatch) fields. */
export const SCOPE_PATCH_FIELDS = ['allowedMcpsJson', 'allowedSkillsJson'] as const;
