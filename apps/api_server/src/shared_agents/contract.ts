export const SHARED_AGENT_SCHEMA = 'rhythm.shared-agent.v1' as const;
export const SHARED_AGENT_CATALOG_SCHEMA = 'rhythm.shared-agent-catalog.v1' as const;

export type SharedAgentRuntime = 'opencode' | 'hermes';
export type SharedAgentReadiness = 'supported' | 'unsupported' | 'unavailable' | 'pending-new-session';
export type FieldApplicability = 'enforced' | 'restrictive' | 'blocked' | 'presentation' | 'not-set';

export const CANONICAL_FIELDS = [
  'id', 'label', 'icon', 'enabled', 'isAgent', 'isManager', 'systemPrompt',
  'allowedMcpsJson', 'allowedSkillsJson', 'corePermissionsJson', 'allowedDelegatesJson',
  'presetId', 'sortOrder', 'createdAt', 'updatedAt', 'revision', 'modelProvider',
  'modelId', 'ocAgent', 'sessionSelectable', 'schedulable', 'schedulableOverride',
  'modelTierHint', 'defaultAnthropicAccountId', 'imageGenerationEnabled',
  'reasoningEffort', 'locked', 'disabledReason', 'lockedAt', 'lockedBy',
  'autoApproveActions',
] as const;

export type CanonicalFieldName = typeof CANONICAL_FIELDS[number];
export type CanonicalAgentConfigV1 = { [K in CanonicalFieldName]: unknown };

export const PRESENTATION_EDIT_FIELDS = ['label', 'icon'] as const;
export const CONFIRMED_EDIT_FIELDS = [
  'enabled', 'isAgent', 'isManager', 'systemPrompt', 'allowedMcpsJson',
  'allowedSkillsJson', 'corePermissionsJson', 'allowedDelegatesJson', 'modelProvider',
  'modelId', 'ocAgent', 'sessionSelectable', 'schedulable', 'imageGenerationEnabled',
  'modelTierHint', 'defaultAnthropicAccountId', 'reasoningEffort', 'autoApproveActions',
] as const;

export type SharedAgentEditableField =
  | typeof PRESENTATION_EDIT_FIELDS[number]
  | typeof CONFIRMED_EDIT_FIELDS[number];
export type SharedAgentChanges = Partial<Record<SharedAgentEditableField, string | boolean | null>>;

export const RHYTHM_TOOL_MAP = {
  rhythm_get_dashboard: 'rhythm_get_dashboard',
  rhythm_list_tasks: 'rhythm_list_tasks',
  rhythm_complete_task: 'rhythm_complete_task',
  rhythm_search_memory: 'rhythm_memory_search',
} as const;

export type SharedAgentReasonCode =
  | 'permission_shape_unsupported' | 'external_directory_pattern_unsupported'
  | 'oc_agent_unsupported' | 'account_binding_unmapped'
  | 'instructions_blocked_by_scanner' | 'model_unpinned'
  | 'model_provider_unmapped' | 'reasoning_invalid'
  | 'terminal_backend_unsupported' | 'agent_id_unsupported'
  | 'agent_locked' | 'agent_disabled' | 'agent_not_runnable'
  | 'viewer_unauthenticated' | 'runtime_unowned' | 'bridge_unavailable'
  | 'runtime_not_connected' | 'runtime_not_reported' | 'model_provider_unavailable'
  | 'launch_kind_not_allowed' | 'executor_not_ready'
  | 'mcp_inherit_restricted' | 'mcp_unmapped' | 'skills_not_applied'
  | 'path_pattern_inert' | 'permission_key_not_applied' | 'write_permission_inert'
  | 'process_tool_not_applied' | 'image_generation_not_applied'
  | 'auto_approve_not_applied' | 'model_tier_hint_ignored'
  | 'schedulable_not_applied' | 'ask_headless_denied'
  | 'revision_newer_than_session';

export interface SharedAgentReason {
  code: SharedAgentReasonCode;
  field?: CanonicalFieldName;
  message: string;
}

export interface RuntimeProjectionSummaryV1 {
  runtime: SharedAgentRuntime;
  readiness: SharedAgentReadiness;
  reasons: SharedAgentReason[];
  launchKinds: { interactive: boolean; delegated: boolean };
  fields: Record<CanonicalFieldName, FieldApplicability>;
}

export interface SharedAgentV1 {
  schema: typeof SHARED_AGENT_SCHEMA;
  id: string;
  revision: number;
  canonical: CanonicalAgentConfigV1;
  runtimes: { opencode: RuntimeProjectionSummaryV1; hermes: RuntimeProjectionSummaryV1 };
}

export interface SharedAgentCatalogV1 {
  schema: typeof SHARED_AGENT_CATALOG_SCHEMA;
  generatedAt: string;
  scope: string;
  agents: SharedAgentV1[];
}

export type ProjectionEffect = 'allow' | 'ask' | 'deny';
export interface ProjectionRule {
  tool: string;
  argument: string;
  pattern: string;
  effect: ProjectionEffect;
}
export interface SharedAgentSnapshotV2 {
  version: 2;
  source: { agent_id: string; revision: number; reference: string };
  instructions: string | null;
  model: { provider: string; model: string; reasoning: string | null };
  allowed_tools: string[];
  tool_effects: Record<string, 'ask'>;
  paths: { root: string; boundary: string[]; external: ProjectionEffect; protected: string[] };
  rules: ProjectionRule[];
  taint_gate: { sources: string[]; gated: string[] };
  launch: { kind: 'interactive' | 'delegated'; cwd: string | null };
}

