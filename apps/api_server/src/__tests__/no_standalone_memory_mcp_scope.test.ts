/**
 * REGRESSION GUARD — Issue #860: no agent scope may grant the standalone
 * `memory` knowledge-graph MCP server.
 *
 * Per docs/ai/decisions/2026-07-02-agent-memory-in-obsidian-vault.md, the
 * Obsidian AGENT-MEMORY vault is the single source of truth for agent memory.
 * A standalone `memory` MCP (@modelcontextprotocol/server-memory, writing to
 * a separate memory.jsonl) is a split-brain risk and must never appear as a
 * server name in:
 *   (a) any `.mcp-roles/*.mcp.json` role file's `mcpServers` map, or
 *   (b) the importer's default `allowed_mcps_json` seed
 *       (`agent_profile_sync.ts`'s IMPORTER_DEFAULT_ALLOWED_MCPS_JSON), or
 *   (c) the curated MCP server catalog (`CURATED_MCP_SERVERS`) — Rhythm
 *       never offers to install the standalone memory server as a curated
 *       option.
 *
 * This test reads the REAL repo files (no fixtures) so it catches a future
 * PR that reintroduces `"memory"` as a granted MCP server name anywhere in
 * agent scope configuration — it does not, and cannot, catch a user's own
 * global ~/.config/opencode/opencode.json (that risk is covered separately
 * by `disableStandaloneMemoryMcp`, see opc_disable_standalone_memory_mcp.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const MCP_ROLES_DIR = path.join(REPO_ROOT, '.mcp-roles');

describe('no standalone memory MCP in agent scope (#860)', () => {
  it('no .mcp-roles/*.mcp.json file grants the "memory" MCP server', () => {
    const files = readdirSync(MCP_ROLES_DIR).filter((f) => f.endsWith('.mcp.json'));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const raw = readFileSync(path.join(MCP_ROLES_DIR, file), 'utf8');
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      if (parsed.mcpServers && Object.prototype.hasOwnProperty.call(parsed.mcpServers, 'memory')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the importer default allowed_mcps_json does not include "memory"', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'apps', 'api_server', 'src', 'services', 'agent_profile_sync.ts'),
      'utf8',
    );
    const match = /IMPORTER_DEFAULT_ALLOWED_MCPS_JSON\s*=\s*'(\[[^\]]*\])'/.exec(source);
    expect(match).not.toBeNull();
    const defaultMcps = JSON.parse(match![1]) as string[];
    expect(defaultMcps).not.toContain('memory');
  });

  it('CURATED_MCP_SERVERS does not offer the standalone memory server as a curated option', async () => {
    const { CURATED_MCP_SERVERS } = await import('../config/curated_mcp_servers');
    const ids = CURATED_MCP_SERVERS.map((s) => s.id);
    const names = CURATED_MCP_SERVERS.map((s) => s.name);
    expect(ids).not.toContain('memory');
    expect(names.map((n) => n.toLowerCase())).not.toContain('memory');
  });
});
