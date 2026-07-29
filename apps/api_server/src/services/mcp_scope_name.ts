import { opencodeClient } from './opencode_engine';

export interface McpScopeNameResolution {
  serverName: string | null;
  knownServerNames: string[];
}

function isPlausibleMcpServerName(name: string): boolean {
  return (
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    /^[a-z0-9]+(?:_[a-z0-9]+)*_mcp$/.test(name)
  );
}

/**
 * Resolve either a server id or a model-facing `<server>_<tool>` id to the
 * live MCP server id. Longest-prefix matching preserves server ids that
 * themselves contain underscores. Catalog access is best-effort: a plausible
 * server id is preserved when the engine is unavailable or does not know it,
 * while model-facing tool ids still require a catalog match.
 */
export async function resolveKnownMcpServerName(name: string): Promise<McpScopeNameResolution> {
  let knownServerNames: string[] = [];
  try {
    knownServerNames = Object.keys(await opencodeClient.listMcp()).sort(
      (a, b) => b.length - a.length,
    );
  } catch {
    return {
      serverName: isPlausibleMcpServerName(name) ? name : null,
      knownServerNames,
    };
  }

  const serverName =
    knownServerNames.find((candidate) => name === candidate) ??
    knownServerNames.find((candidate) => name.startsWith(`${candidate}_`)) ??
    (isPlausibleMcpServerName(name) ? name : null);
  return { serverName, knownServerNames };
}
