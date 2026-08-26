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

function validatedEngineUrl(engineUrl: string): string {
  const url = new URL(engineUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('MCP tool catalog engine URL must be loopback HTTP');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('MCP tool catalog engine URL must be a bare origin');
  }
  return url.origin;
}

async function fetchEngineJson(origin: string, path: string): Promise<unknown> {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) throw new Error(`live MCP tool catalog request failed (${response.status})`);
  return response.json();
}

export async function loadLiveMcpToolCatalog(engineUrl?: string): Promise<LiveMcpToolCatalog> {
  if (engineUrl) {
    const origin = validatedEngineUrl(engineUrl);
    const [statuses, toolIds] = await Promise.all([
      fetchEngineJson(origin, '/mcp'),
      fetchEngineJson(origin, '/mcp/tools'),
    ]);
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
    return {
      serverNames: new Set(Object.keys(statuses)),
      toolIds: new Set(toolIds as string[]),
    };
  }
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
