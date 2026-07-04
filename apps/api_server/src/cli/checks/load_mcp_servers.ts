import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { McpServerSpec } from './mcp_reachability';

export interface LoadMcpServersDeps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  configPath?: string;
}

const DEFAULT_DEPS: LoadMcpServersDeps = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, 'utf8'),
};

/** Default location of the engine-managed opencode.json (see opencode_client_service.ts). */
export function defaultOpencodeConfigPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

/**
 * #871 — reads MCP server entries directly from opencode.json's `mcp` block
 * (the SAME file `opencode_client_service.ts` materializes into — see its
 * `ensureCuratedMcps` contract notes). This module is standalone: it never
 * imports `opencode_client_service.ts` or any server bootstrap, only `fs`.
 * Entries with `enabled: false` (#879 Blank Slate explicit-disable) are
 * excluded — doctor's reachability check only probes servers that are
 * actually active. Any read/parse failure resolves to an empty list rather
 * than throwing, so `rhythm doctor` never crashes on a missing/corrupt config
 * (the config-validity check separately flags that failure).
 */
export function loadConfiguredMcpServers(
  deps: LoadMcpServersDeps = DEFAULT_DEPS,
): McpServerSpec[] {
  const configPath = deps.configPath ?? defaultOpencodeConfigPath();

  if (!deps.existsSync(configPath)) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(deps.readFileSync(configPath));
  } catch {
    return [];
  }

  const mcpSection = parsed.mcp;
  if (typeof mcpSection !== 'object' || mcpSection === null) return [];

  const servers: McpServerSpec[] = [];
  for (const [id, raw] of Object.entries(mcpSection as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (entry.enabled === false) continue;

    const type = entry.type === 'remote' ? 'remote' : 'local';
    servers.push({
      id,
      name: id,
      type,
      url: typeof entry.url === 'string' ? entry.url : undefined,
      command: Array.isArray(entry.command)
        ? entry.command.filter((c): c is string => typeof c === 'string')
        : undefined,
    });
  }

  return servers;
}
