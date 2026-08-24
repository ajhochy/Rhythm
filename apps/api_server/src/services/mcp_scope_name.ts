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
 * Resolve a server id or model-facing `<server>_<tool>` callable against a
 * known server catalog. Exact ids take precedence; callable names use the
 * unique longest `<server>_` prefix. Unknown and ambiguous names are never
 * guessed.
 */
export function resolveMcpServerIdentity(
  name: string,
  knownServerNames: Iterable<string>,
): string | null {
  const catalog = [...knownServerNames].filter((candidate) => candidate.length > 0);
  if (catalog.includes(name)) return name;

  const matches = catalog
    .filter((candidate) => name.startsWith(`${candidate}_`))
    .sort((a, b) => b.length - a.length);
  if (matches.length === 0) return null;

  const longestLength = matches[0].length;
  const longest = matches.filter((candidate) => candidate.length === longestLength);
  return longest.length === 1 ? longest[0] : null;
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

  if (knownServerNames.length === 0) {
    return {
      serverName: isPlausibleMcpServerName(name) ? name : null,
      knownServerNames,
    };
  }

  const serverName =
    resolveMcpServerIdentity(name, knownServerNames) ??
    (isPlausibleMcpServerName(name) ? name : null);
  return { serverName, knownServerNames };
}
