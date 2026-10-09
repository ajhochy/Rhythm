import type {
  AgentConfig,
} from '../repositories/agent_configs_repository';
import type {
  AgentSession,
  PermissionMode,
} from '../models/agent_session';

export interface SafeMobileProfileCatalogItem {
  profileId: string;
  opencodeAgentId: string;
  name: string;
  defaults: {
    providerId: string | null;
    modelId: string | null;
    reasoningEffort: string | null;
    approvalMode: PermissionMode;
  };
  display: {
    icon: string;
    color: string | null;
  };
}

export interface SafeMobileProfileCatalog {
  profiles: SafeMobileProfileCatalogItem[];
}

export type MobileProfileAvailability =
  | 'available'
  | 'unassigned'
  | 'unavailable';

export interface SafeMobileSessionProfileState {
  localSessionId: string;
  profileId: string | null;
  opencodeAgentId: string | null;
  profileAvailability: MobileProfileAvailability;
  providerId: string | null;
  modelId: string | null;
  /** 'auto' = the router picks the model; providerId/modelId are then only the last pick. */
  modelMode: 'auto' | 'fixed';
  routerDecidedAt: string | null;
  thinkingBudget: number | null;
  fastMode: boolean;
  permissionMode: PermissionMode;
}

export function buildSafeMobileProfileCatalog(
  configs: AgentConfig[],
): SafeMobileProfileCatalog {
  return {
    profiles: configs
      .filter((config) =>
        config.enabled &&
        config.locked !== true &&
        config.sessionSelectable &&
        typeof config.ocAgent === 'string' &&
        config.ocAgent.trim() !== '')
      .map((config) => ({
        profileId: config.id,
        opencodeAgentId: config.ocAgent!.trim(),
        name: config.label,
        defaults: {
          providerId: config.modelProvider,
          modelId: config.modelId,
          reasoningEffort: config.reasoningEffort ?? null,
          approvalMode: 'default' as const,
        },
        display: {
          icon: config.icon,
          color: null,
        },
      })),
  };
}

/** Versioned settings readback for the explicit-identity state port (wire contract v1). */
export interface SafeMobileSettingsState extends SafeMobileSessionProfileState {
  settingsContractVersion: 1;
  settingsIdentity: 'sdk' | 'local-primary';
  sdkSessionId: string | null;
}

export function safeMobileSettingsState(
  session: AgentSession,
  configs: AgentConfig[],
  identity: 'sdk' | 'local-primary',
): SafeMobileSettingsState {
  return {
    ...safeMobileSessionProfileState(session, configs),
    settingsContractVersion: 1,
    settingsIdentity: identity,
    sdkSessionId: session.sdkSessionId ?? null,
  };
}

export function resolveProfileIdForOpenCodeAgent(
  opencodeAgentId: string | null,
  configs: AgentConfig[],
): string | null {
  if (!opencodeAgentId) return null;
  const matches = configs.filter((config) =>
    config.enabled &&
    config.locked !== true &&
    config.sessionSelectable &&
    config.ocAgent === opencodeAgentId);
  return matches.length === 1 ? matches[0].id : null;
}

export function safeMobileSessionProfileState(
  session: AgentSession,
  configs: AgentConfig[],
): SafeMobileSessionProfileState {
  const profile = session.profileId
    ? configs.find((config) => config.id === session.profileId)
    : undefined;
  const available = profile !== undefined &&
    profile.enabled &&
    profile.locked !== true &&
    profile.sessionSelectable &&
    typeof profile.ocAgent === 'string' &&
    profile.ocAgent.trim() !== '' &&
    profile.ocAgent === session.opencodeAgentId;
  return {
    localSessionId: session.id,
    profileId: session.profileId,
    opencodeAgentId: session.opencodeAgentId,
    profileAvailability: available
      ? 'available'
      : session.profileId || session.opencodeAgentId
        ? 'unavailable'
        : 'unassigned',
    providerId: session.providerId,
    modelId: session.modelId,
    modelMode: session.modelMode,
    routerDecidedAt: session.routerDecidedAt,
    thinkingBudget: session.thinkingBudget,
    fastMode: session.fastMode === true,
    permissionMode: session.permissionMode,
  };
}
