/**
 * Contract tests for expandMcpAllowlist (issue mcp-scope-05)
 *
 * Pure-function acceptance tests. Every case asserts exact arrays/lengths.
 *
 * Cases:
 *  C1 — Librarian fixture (.mcp-roles/librarian.mcp.json): all tools explicit
 *  C2 — Secretary fixture (.mcp-roles/secretary.mcp.json): all tools explicit
 *  C3 — Inherit-all server (empty allowedTools: [])
 *  C4 — Hyphenated server name preserved (gmail-work_search_emails)
 *  C5 — Dot/colon sanitize (my.server + get:data → my_server_get_data)
 *  C6 — disabledMcpServers exclusion
 *  C7 — Empty mcpServers
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { expandMcpAllowlist } from '../mcp_allowlist_expander';
import type { McpRoleConfig } from '../agent_profile_scope';

// ── Fixture loader ────────────────────────────────────────────────────────────

/**
 * Load a .mcp-roles/*.mcp.json fixture relative to the repo root.
 * Returns the parsed JSON cast as McpRoleConfig (the fixture has extra fields
 * like disabledMcpServers which the function handles internally via type casting).
 */
function loadFixture(filename: string): McpRoleConfig {
  // __tests__ is at apps/api_server/src/services/__tests__/
  // Repo root is 5 levels up
  const repoRoot = path.resolve(__dirname, '../../../../..');
  const fixturePath = path.join(repoRoot, '.mcp-roles', filename);
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  return JSON.parse(raw) as McpRoleConfig;
}

// ── C1: Librarian fixture ─────────────────────────────────────────────────────

describe('C1: Librarian fixture — all tools explicit', () => {
  it('servers is empty, tools contain all obsidian + rhythm entries', () => {
    const config = loadFixture('librarian.mcp.json');

    // Compute expected counts dynamically from the fixture so we never hardcode
    const raw = config as unknown as {
      mcpServers: Record<string, { allowedTools?: string[] }>;
    };
    const obsidianTools = raw.mcpServers['obsidian']?.allowedTools ?? [];
    const rhythmTools = raw.mcpServers['rhythm']?.allowedTools ?? [];
    const expectedToolCount = obsidianTools.length + rhythmTools.length;

    const result = expandMcpAllowlist(config);

    expect(result.servers).toEqual([]);
    expect(result.tools).toHaveLength(expectedToolCount);

    // Every obsidian tool entry must be present
    for (const tool of obsidianTools) {
      expect(result.tools).toContain(`obsidian_${tool}`);
    }
    // Every rhythm tool entry must be present
    for (const tool of rhythmTools) {
      expect(result.tools).toContain(`rhythm_${tool}`);
    }
  });
});

// ── C2: Secretary fixture ─────────────────────────────────────────────────────

describe('C2: Secretary fixture — all tools explicit', () => {
  it('servers is empty, tools contain all server-prefixed entries', () => {
    const config = loadFixture('secretary.mcp.json');

    const raw = config as unknown as {
      mcpServers: Record<string, { allowedTools?: string[] }>;
    };

    // Compute expected count dynamically from fixture
    let expectedToolCount = 0;
    for (const serverEntry of Object.values(raw.mcpServers)) {
      expectedToolCount += (serverEntry.allowedTools ?? []).length;
    }

    const result = expandMcpAllowlist(config);

    expect(result.servers).toEqual([]);
    expect(result.tools).toHaveLength(expectedToolCount);

    // Every server's tools must appear as <sanitize(server)>_<tool>
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
    for (const [serverName, serverEntry] of Object.entries(raw.mcpServers)) {
      const tools = serverEntry.allowedTools ?? [];
      for (const tool of tools) {
        expect(result.tools).toContain(`${sanitize(serverName)}_${tool}`);
      }
    }
  });
});

// ── C3: Inherit-all server (empty allowedTools) ────────────────────────────────

describe('C3: Inherit-all server', () => {
  it('empty allowedTools emits server name into servers[], not tools[]', () => {
    const config: McpRoleConfig = {
      role: 'test',
      mcpServers: {
        'my-server': { allowedTools: [] } as unknown,
      },
      allowedToolsJson: '{}',
    };

    const result = expandMcpAllowlist(config);

    expect(result.servers).toContain('my-server');
    expect(result.tools).toHaveLength(0);
    // Confirm server name is NOT in tools
    expect(result.tools.some((t) => t.startsWith('my-server'))).toBe(false);
  });

  it('missing allowedTools also emits server name into servers[]', () => {
    const config: McpRoleConfig = {
      role: 'test',
      mcpServers: {
        'bare-server': {} as unknown,
      },
      allowedToolsJson: '{}',
    };

    const result = expandMcpAllowlist(config);

    expect(result.servers).toContain('bare-server');
    expect(result.tools).toHaveLength(0);
  });
});

// ── C4: Hyphenated server name preserved ──────────────────────────────────────

describe('C4: Hyphenated server name', () => {
  it("gmail-work + ['search_emails'] → tools contains 'gmail-work_search_emails'", () => {
    const config: McpRoleConfig = {
      role: 'test',
      mcpServers: {
        'gmail-work': { allowedTools: ['search_emails'] } as unknown,
      },
      allowedToolsJson: '{}',
    };

    const result = expandMcpAllowlist(config);

    expect(result.tools).toContain('gmail-work_search_emails');
    expect(result.servers).toEqual([]);
  });
});

// ── C5: Dot/colon sanitize ────────────────────────────────────────────────────

describe('C5: Dot/colon sanitize', () => {
  it("server 'my.server', tool 'get:data' → 'my_server_get_data'", () => {
    const config: McpRoleConfig = {
      role: 'test',
      mcpServers: {
        'my.server': { allowedTools: ['get:data'] } as unknown,
      },
      allowedToolsJson: '{}',
    };

    const result = expandMcpAllowlist(config);

    expect(result.tools).toContain('my_server_get_data');
    expect(result.servers).toEqual([]);
  });
});

// ── C5b: Inherit-all server name stays RAW in servers[] ───────────────────────

describe('C5b: Inherit-all server name is raw (matches engine raw clientName)', () => {
  it("server 'my.server' with empty allowedTools → servers[] contains raw 'my.server', NOT sanitized", () => {
    // The engine (mcp-scope-02) compares mcpAllowlist.servers against the raw
    // clientName. A sanitized servers[] entry would fail to match a special-char
    // server name and wrongly filter out its inherited tools. servers[] must be raw.
    const config: McpRoleConfig = {
      role: 'test',
      mcpServers: {
        'my.server': { allowedTools: [] } as unknown,
      },
      allowedToolsJson: '{}',
    };

    const result = expandMcpAllowlist(config);

    expect(result.servers).toContain('my.server');
    expect(result.servers).not.toContain('my_server');
    expect(result.tools).toHaveLength(0);
  });
});

// ── C6: disabledMcpServers exclusion ─────────────────────────────────────────

describe('C6: disabledMcpServers exclusion', () => {
  it('server in disabledMcpServers is absent from both lists', () => {
    // Cast to McpRoleConfig — disabledMcpServers is an extra field the function
    // handles internally via type casting
    const config = {
      role: 'test',
      mcpServers: {
        'allowed-server': { allowedTools: ['do_thing'] } as unknown,
        'blocked-server': { allowedTools: ['secret_tool'] } as unknown,
        'inherit-server': { allowedTools: [] } as unknown,
      },
      allowedToolsJson: '{}',
      disabledMcpServers: ['blocked-server', 'inherit-server'],
    } as unknown as McpRoleConfig;

    const result = expandMcpAllowlist(config);

    // Only allowed-server should contribute
    expect(result.tools).toContain('allowed-server_do_thing');
    expect(result.tools).not.toContain('blocked-server_secret_tool');
    expect(result.servers).not.toContain('blocked-server');
    expect(result.servers).not.toContain('inherit-server');
    // blocked-server and inherit-server must not appear anywhere
    expect(result.tools.some((t) => t.startsWith('blocked-server'))).toBe(false);
    expect(result.servers).toHaveLength(0);
  });
});

// ── C7: Empty mcpServers ──────────────────────────────────────────────────────

describe('C7: Empty mcpServers', () => {
  it('empty mcpServers → { servers: [], tools: [] }', () => {
    const config: McpRoleConfig = {
      role: 'test',
      mcpServers: {},
      allowedToolsJson: '{}',
    };

    const result = expandMcpAllowlist(config);

    expect(result).toEqual({ servers: [], tools: [] });
  });

  it('absent mcpServers → { servers: [], tools: [] }', () => {
    // McpRoleConfig has mcpServers as required, but handle null/undefined gracefully
    const config = {
      role: 'test',
      mcpServers: null,
      allowedToolsJson: '{}',
    } as unknown as McpRoleConfig;

    const result = expandMcpAllowlist(config);

    expect(result).toEqual({ servers: [], tools: [] });
  });
});
