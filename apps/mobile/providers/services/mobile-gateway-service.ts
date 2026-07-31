import type { PairedMacClient } from '@/lib/transport/paired-mac-client';
import type {
  AgentOption,
  OpenCodeAgentId,
  PermissionMode,
  RhythmProfileId,
  SessionExecutionState,
} from '@/providers/opencode-provider-utils';

export interface MobileGatewayProject {
  id: string;
  name: string;
  icon: string | null;
}

function safeProject(value: unknown): MobileGatewayProject | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    !record.id.trim() ||
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    (record.icon !== null && typeof record.icon !== 'string')
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    icon: typeof record.icon === 'string' ? record.icon : null,
  };
}

export async function listMobileGatewayProjects(
  client: PairedMacClient,
): Promise<MobileGatewayProject[]> {
  const response = await client.request<{ projects?: unknown }>(
    '/mobile-gateway/projects',
    { method: 'GET' },
  );
  const projects = Array.isArray(response?.projects)
    ? response.projects
        .map(safeProject)
        .filter((project): project is MobileGatewayProject => project !== null)
    : [];
  return [...new Map(projects.map((project) => [project.id, project])).values()];
}

const PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
]);

function safeCatalogProfile(value: unknown): AgentOption | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const defaults = record.defaults;
  const display = record.display;
  if (
    typeof record.profileId !== 'string' ||
    !record.profileId.trim() ||
    typeof record.opencodeAgentId !== 'string' ||
    !record.opencodeAgentId.trim() ||
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    !defaults ||
    typeof defaults !== 'object' ||
    !display ||
    typeof display !== 'object'
  ) {
    return null;
  }
  const safeDefaults = defaults as Record<string, unknown>;
  const safeDisplay = display as Record<string, unknown>;
  if (
    (safeDefaults.providerId !== null &&
      typeof safeDefaults.providerId !== 'string') ||
    (safeDefaults.modelId !== null &&
      typeof safeDefaults.modelId !== 'string') ||
    (safeDefaults.reasoningEffort !== null &&
      typeof safeDefaults.reasoningEffort !== 'string') ||
    typeof safeDefaults.approvalMode !== 'string' ||
    !PERMISSION_MODES.has(safeDefaults.approvalMode as PermissionMode) ||
    typeof safeDisplay.icon !== 'string' ||
    (safeDisplay.color !== null && typeof safeDisplay.color !== 'string')
  ) {
    return null;
  }
  const profileId = record.profileId as RhythmProfileId;
  return {
    id: profileId,
    profileId,
    opencodeAgentId: record.opencodeAgentId as OpenCodeAgentId,
    label: record.name,
    defaults: {
      providerId: safeDefaults.providerId as string | null,
      modelId: safeDefaults.modelId as string | null,
      reasoningEffort: safeDefaults.reasoningEffort as string | null,
      approvalMode: safeDefaults.approvalMode as PermissionMode,
    },
    display: {
      icon: safeDisplay.icon,
      color: safeDisplay.color as string | null,
    },
  };
}

export async function listMobileGatewayProfiles(
  client: PairedMacClient,
  projectId: string,
): Promise<AgentOption[]> {
  const response = await client.request<{ profiles?: unknown }>(
    '/mobile-gateway/profile-catalog',
    {
      method: 'GET',
      headers: { 'X-Rhythm-Project-ID': projectId },
    },
  );
  return Array.isArray(response?.profiles)
    ? response.profiles
        .map(safeCatalogProfile)
        .filter((profile): profile is AgentOption => profile !== null)
    : [];
}

export async function updateMobileSessionProfileState(
  client: PairedMacClient,
  projectId: string,
  sdkSessionId: string,
  state: {
    profileId: RhythmProfileId | null;
    opencodeAgentId: OpenCodeAgentId | null;
    providerId: string | null;
    modelId: string | null;
    thinkingBudget: number | null;
    permissionMode: PermissionMode;
  },
): Promise<SessionExecutionState> {
  return client.request<SessionExecutionState>(
    `/mobile-gateway/sessions/${encodeURIComponent(sdkSessionId)}/state`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Rhythm-Project-ID': projectId,
      },
      body: JSON.stringify(state),
    },
  );
}
