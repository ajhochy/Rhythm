import { opencodeClient } from './opencode_engine';
import { alignMcpName } from './mcp_name_alignment';
import { resolveProfileMcpScope } from './agent_profile_scope';
import { sanitizeMcpNameSegment } from './mcp_allowlist_expander';

export interface LiveMcpToolCatalog {
  serverNames: Set<string>;
  toolIds: Set<string>;
}

export interface McpToolGrantDrift {
  profileId: string;
  serverName: string;
  toolName: string;
}

async function fetchEngineJson(origin: string, path: string): Promise<unknown> {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) throw new Error(`live MCP tool catalog request failed (${response.status})`);
  return response.json();
}

export async function loadLiveMcpToolCatalog(engineUrl?: string): Promise<LiveMcpToolCatalog> {
  if (!engineUrl && !opencodeClient.isReady) throw new Error('live MCP tool catalog is unavailable');
  const [statuses, toolIds] = await (engineUrl
    ? Promise.all([
      fetchEngineJson(new URL(engineUrl).origin, '/mcp'),
      fetchEngineJson(new URL(engineUrl).origin, '/mcp/tools'),
    ])
    : Promise.all([
      opencodeClient.listMcp(),
      opencodeClient.listMcpToolIds(),
    ]));
  if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
    throw new Error('live MCP status response is invalid');
  }
  if (
    !Array.isArray(toolIds) ||
    toolIds.some((toolId) => typeof toolId !== 'string' || toolId.length === 0) ||
    new Set(toolIds).size !== toolIds.length
  ) {
    throw new Error('live MCP tool response is invalid');
  }
  const connectedServerNames = Object.entries(statuses)
    .filter(([, entry]) => (
      entry !== null &&
      typeof entry === 'object' &&
      'status' in entry &&
      (entry as { status?: unknown }).status === 'connected'
    ))
    .map(([name]) => name);
  return {
    serverNames: new Set(connectedServerNames),
    toolIds: new Set(toolIds as string[]),
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
    const prefix = `${sanitizeMcpNameSegment(storedServerName)}_`;
    for (const toolName of tools) {
      if (!catalog.toolIds.has(`${prefix}${sanitizeMcpNameSegment(toolName)}`)) {
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
  let catalog: LiveMcpToolCatalog;
  try {
    catalog = await loadLiveMcpToolCatalog();
  } catch {
    return; // Engine warmup/outage makes live validation unjudgeable, never a profile-edit blocker.
  }
  const unknown = findUnknownMcpToolGrants(allowedMcpsJson, profileId, catalog);
  if (unknown.length > 0) {
    throw new Error(
      `unknown MCP tool grant(s): ${unknown.map((entry) => `${entry.serverName}.${entry.toolName}`).join(', ')}`,
    );
  }
}
