export const SHARED_AGENT_SCHEMA = 'rhythm.shared-agent.v1' as const;
export const SHARED_AGENT_CATALOG_SCHEMA = 'rhythm.shared-agent-catalog.v1' as const;

export type SharedAgentRuntime = 'opencode' | 'hermes';
export type SharedAgentReadiness = 'supported' | 'unsupported' | 'unavailable' | 'pending-new-session';
export type SharedAgentFieldApplicability = 'enforced' | 'restrictive' | 'blocked' | 'presentation' | 'not-set';

export const CANONICAL_FIELDS = [
  'id', 'label', 'icon', 'enabled', 'isAgent', 'isManager', 'systemPrompt',
  'allowedMcpsJson', 'allowedSkillsJson', 'corePermissionsJson', 'allowedDelegatesJson',
  'presetId', 'sortOrder', 'createdAt', 'updatedAt', 'revision', 'modelProvider', 'modelId',
  'ocAgent', 'sessionSelectable', 'schedulable', 'schedulableOverride', 'modelTierHint',
  'defaultAnthropicAccountId', 'imageGenerationEnabled', 'reasoningEffort', 'locked',
  'disabledReason', 'lockedAt', 'lockedBy', 'autoApproveActions',
] as const;

export type SharedAgentCanonicalField = typeof CANONICAL_FIELDS[number];
export type SharedAgentCanonical = { [K in SharedAgentCanonicalField]: unknown };

export type SharedAgentReasonCode =
  | 'permission_shape_unsupported' | 'external_directory_pattern_unsupported' | 'oc_agent_unsupported'
  | 'account_binding_unmapped' | 'instructions_blocked_by_scanner' | 'model_unpinned'
  | 'model_provider_unmapped' | 'reasoning_invalid' | 'terminal_backend_unsupported' | 'agent_id_unsupported'
  | 'agent_locked' | 'agent_disabled' | 'agent_not_runnable' | 'viewer_unauthenticated'
  | 'runtime_unowned' | 'bridge_unavailable' | 'runtime_not_connected' | 'runtime_not_reported'
  | 'model_provider_unavailable' | 'launch_kind_not_allowed' | 'executor_not_ready'
  | 'mcp_inherit_restricted' | 'mcp_unmapped' | 'skills_not_applied' | 'path_pattern_inert'
  | 'permission_key_not_applied' | 'write_permission_inert' | 'process_tool_not_applied'
  | 'image_generation_not_applied' | 'auto_approve_not_applied' | 'model_tier_hint_ignored'
  | 'schedulable_not_applied' | 'ask_headless_denied' | 'revision_newer_than_session'
  | 'policy_shape_invalid' | 'projection_version_unsupported' | 'selection_invalid' | 'profile_unsupported'
  | 'transport_not_allowed' | 'revision_conflict' | 'projection_unsupported' | 'job_not_claimed'
  | 'lease_invalid' | 'target_revision_changed' | 'cwd_mismatch' | 'cwd_invalid' | 'session_key_reused'
  | 'binding_mismatch' | 'provider_runtime_mismatch' | 'projection_revoked' | 'rate_limited' | 'provider_failed';

export interface SharedAgentReason {
  code: SharedAgentReasonCode;
  field?: SharedAgentCanonicalField;
  message: string;
}

export interface SharedAgentRuntimeProjection {
  runtime: SharedAgentRuntime;
  readiness: SharedAgentReadiness;
  reasons: SharedAgentReason[];
  launchKinds: { interactive: boolean; delegated: boolean };
  fields: Record<SharedAgentCanonicalField, SharedAgentFieldApplicability>;
}

export interface SharedAgent {
  schema: typeof SHARED_AGENT_SCHEMA;
  id: string;
  revision: number;
  canonical: SharedAgentCanonical;
  runtimes: { opencode: SharedAgentRuntimeProjection; hermes: SharedAgentRuntimeProjection };
}

export interface SharedAgentCatalog {
  schema: typeof SHARED_AGENT_CATALOG_SCHEMA;
  generatedAt: string;
  scope: string;
  agents: SharedAgent[];
}

export const PRESENTATION_EDIT_FIELDS = ['label', 'icon'] as const;
export const CONFIRMED_EDIT_FIELDS = [
  'enabled', 'isAgent', 'isManager', 'systemPrompt', 'allowedMcpsJson', 'allowedSkillsJson',
  'corePermissionsJson', 'allowedDelegatesJson', 'modelProvider', 'modelId', 'ocAgent',
  'sessionSelectable', 'schedulable', 'imageGenerationEnabled', 'modelTierHint',
  'defaultAnthropicAccountId', 'reasoningEffort', 'autoApproveActions',
] as const;

export type SharedAgentEditableField = typeof PRESENTATION_EDIT_FIELDS[number] | typeof CONFIRMED_EDIT_FIELDS[number];
export type SharedAgentEditableValue = string | boolean | null;
export type SharedAgentChanges = Partial<Record<SharedAgentEditableField, SharedAgentEditableValue>>;

export interface SharedAgentsPort {
  readonly hostRuntime: SharedAgentRuntime;
  list(): Promise<SharedAgentCatalog>;
  get(id: string): Promise<SharedAgent>;
  save(
    id: string,
    expectedRevision: number,
    changes: SharedAgentChanges,
    opts?: { onConfirmationRequired?: () => void },
  ): Promise<SharedAgent>;
  launch?(id: string, expectedRevision: number): Promise<{ ok: true } | { ok: false; reason: string }>;
}
