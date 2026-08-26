import { opencodeClient } from './opencode_engine';
import { alignMcpName } from './mcp_name_alignment';
import { resolveProfileMcpScope } from './agent_profile_scope';

export interface LiveMcpToolCatalog {
  serverNames: Set<string>;
  toolIds: Set<string>;
}

export interface McpToolGrantDrift {
  profileId: string;
  serverName: string;
  toolName: string;
}

export async function loadLiveMcpToolCatalog(): Promise<LiveMcpToolCatalog> {
  if (!opencodeClient.isReady) throw new Error('live MCP tool catalog is unavailable');
  const [statuses, toolIds] = await Promise.all([
    opencodeClient.listMcp(),
    opencodeClient.listMcpToolIds(),
  ]);
  return {
    serverNames: new Set(Object.keys(statuses)),
    toolIds: new Set(toolIds),
  };
}

export function findUnknownMcpToolGrants(
  allowedMcpsJson: string | null,
  profileId: string,
  catalog: LiveMcpToolCatalog,
): McpToolGrantDrift[] {
  const scope = resolveProfileMcpScope(allowedMcpsJson, profileId, profileId);
  if (scope.shape !== 'tools-map') return [];

  const drift: McpToolGrantDrift[] = [];
  for (const [storedServerName, tools] of Object.entries(scope.toolsByServer)) {
    if (tools.length === 0) continue;
    const aligned = alignMcpName(storedServerName, catalog.serverNames);
    if (!aligned.matched) continue; // Server drift is reported by the existing server-level lane.
    const prefix = `${aligned.resolved.replace(/[^a-zA-Z0-9_-]/g, '_')}_`;
    for (const toolName of tools) {
      if (!catalog.toolIds.has(`${prefix}${toolName}`)) {
        drift.push({ profileId, serverName: storedServerName, toolName });
      }
    }
  }
  return drift;
}

export async function assertMcpToolGrantsKnown(
  allowedMcpsJson: string | null,
  profileId: string,
): Promise<void> {
  const scope = resolveProfileMcpScope(allowedMcpsJson, profileId, profileId);
  if (scope.shape !== 'tools-map' || Object.values(scope.toolsByServer).every((tools) => tools.length === 0)) {
    return;
  }
  const unknown = findUnknownMcpToolGrants(
    allowedMcpsJson,
    profileId,
    await loadLiveMcpToolCatalog(),
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown MCP tool grant(s): ${unknown.map((entry) => `${entry.serverName}.${entry.toolName}`).join(', ')}`,
    );
  }
}
