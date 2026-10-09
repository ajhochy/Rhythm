import type { CoordinatorConversationSetupProfileChoice } from '../contracts/coordinator_conversation_contract';
import {
  agentConfigExecutionBlockReason,
  type AgentConfig,
} from '../repositories/agent_configs_repository';

/**
 * A fresh coordinator workspace may use only a profile that is runnable at
 * the moment the authenticated setup command is handled.  A selection is not
 * a capability: it names one already-server-owned profile so the server can
 * derive its model and scope later from the current stores.
 */
export type CoordinatorSetupProfileSelection<T extends AgentConfig = AgentConfig> =
  | { kind: 'selected'; profile: T }
  | { kind: 'choice_required'; profileChoices: CoordinatorConversationSetupProfileChoice[] }
  | { kind: 'unavailable' };

function isEligibleSetupProfile(profile: AgentConfig): boolean {
  return profile.enabled === true &&
    profile.isAgent === true &&
    profile.locked !== true &&
    agentConfigExecutionBlockReason(profile) === null &&
    typeof profile.modelProvider === 'string' && profile.modelProvider.trim().length > 0 &&
    typeof profile.modelId === 'string' && profile.modelId.trim().length > 0;
}

/**
 * Select exactly one current eligible configured profile without ever falling
 * back to catalog order.  The public branch intentionally carries only the
 * ordinary configured id and display label, never a path, model, grants, or
 * other profile material.
 */
export function selectCoordinatorSetupProfile<T extends AgentConfig>(
  profiles: readonly T[],
  selectedProfileId: string | undefined,
): CoordinatorSetupProfileSelection<T> {
  const eligible = profiles.filter(isEligibleSetupProfile);
  const byId = new Map<string, T>();
  for (const profile of eligible) {
    // A malformed/injected duplicate cannot safely become an ambiguous
    // bootstrap authority, even if both copies happen to describe one id.
    if (byId.has(profile.id)) return { kind: 'unavailable' };
    byId.set(profile.id, profile);
  }
  const ordered = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (ordered.length === 0) return { kind: 'unavailable' };

  if (selectedProfileId !== undefined) {
    const selected = byId.get(selectedProfileId);
    if (selected) return { kind: 'selected', profile: selected };
    // An explicit stale/disabled/locked choice is never silently replaced.
    return { kind: 'choice_required', profileChoices: publicChoices(ordered) };
  }
  if (ordered.length === 1) return { kind: 'selected', profile: ordered[0] };
  return { kind: 'choice_required', profileChoices: publicChoices(ordered) };
}

/**
 * Replay is deliberately narrower than a new selection: the same command
 * cannot select a different profile, and its persisted profile must still be
 * current and eligible.  The caller separately verifies owner/setup/project
 * provenance before using this result.
 */
export function validateCoordinatorSetupReplay(
  profiles: readonly AgentConfig[],
  persistedProfileId: string | null | undefined,
  requestedProfileId: string | undefined,
): AgentConfig | null {
  if (!persistedProfileId || (requestedProfileId !== undefined && requestedProfileId !== persistedProfileId)) {
    return null;
  }
  const current = selectCoordinatorSetupProfile(profiles, persistedProfileId);
  return current.kind === 'selected' && current.profile.id === persistedProfileId
    ? current.profile
    : null;
}

function publicChoices(profiles: readonly AgentConfig[]): CoordinatorConversationSetupProfileChoice[] {
  return profiles.map((profile) => ({
    id: profile.id,
    // Labels are configured presentation data. Never spread a profile here:
    // scopes, prompts, model/provider details, paths, and grants stay server-only.
    label: profile.label,
  }));
}
