/**
 * Contract tests for gemini_tool_cap.ts (issue #884)
 *
 * Cases:
 *  C1 — under-cap allowlist on google: unchanged
 *  C2 — over-cap allowlist on google: trimmed under budget + warning
 *  C3 — over-cap allowlist on anthropic (or any non-google provider): untouched
 *  C4 — explicit tools[] preferred over inherit-all servers[] when trimming
 *  C5 — exactly-at-budget allowlist: unchanged, no warning
 *  C6 — null/undefined providerId: untouched (treated as non-google)
 *  C7 — trimmed result never exceeds the budget
 */

import { describe, it, expect } from 'vitest';
import {
  capMcpAllowlistForProvider,
  geminiUnscopedDeferredAllowlist,
  GEMINI_MAX_FUNCTION_DECLARATIONS,
  GEMINI_MCP_TOOL_BUDGET,
} from '../gemini_tool_cap';
import type { McpAllowlist } from '../mcp_allowlist_expander';

describe('C1: under-cap allowlist on google is unchanged', () => {
  it('returns the same allowlist with trimmed=false', () => {
    const allowlist: McpAllowlist = {
      servers: ['rhythm'],
      tools: ['github_list_repos', 'gmail_search'],
    };
    const result = capMcpAllowlistForProvider(allowlist, 'google');
    expect(result.trimmed).toBe(false);
    expect(result.allowlist).toEqual(allowlist);
    expect(result.warning).toBeNull();
  });
});

describe('C2: over-cap allowlist on google is trimmed under budget', () => {
  it('trims explicit tools[] down to the budget and sets a warning', () => {
    const manyTools = Array.from({ length: 600 }, (_, i) => `server_tool_${i}`);
    const allowlist: McpAllowlist = { servers: [], tools: manyTools };
    const result = capMcpAllowlistForProvider(allowlist, 'google');

    expect(result.trimmed).toBe(true);
    expect(result.allowlist.tools.length).toBeLessThanOrEqual(GEMINI_MCP_TOOL_BUDGET);
    expect(result.cappedEstimatedCount).toBeLessThanOrEqual(GEMINI_MCP_TOOL_BUDGET);
    expect(result.originalEstimatedCount).toBe(600);
    expect(result.warning).toBeTruthy();
    expect(result.warning).toContain('512');
  });

  it('never drops tools when the count is already within budget, even with some inherit-all servers', () => {
    const allowlist: McpAllowlist = {
      servers: ['propresenter'],
      tools: Array.from({ length: 10 }, (_, i) => `rhythm_tool_${i}`),
    };
    const result = capMcpAllowlistForProvider(allowlist, 'google');
    expect(result.trimmed).toBe(false);
    expect(result.allowlist).toEqual(allowlist);
  });
});

describe('C3: over-cap allowlist on a non-google provider is untouched', () => {
  it('anthropic: returns the exact same allowlist object contents, trimmed=false', () => {
    const manyTools = Array.from({ length: 600 }, (_, i) => `server_tool_${i}`);
    const allowlist: McpAllowlist = { servers: ['a', 'b', 'c'], tools: manyTools };
    const result = capMcpAllowlistForProvider(allowlist, 'anthropic');

    expect(result.trimmed).toBe(false);
    expect(result.allowlist).toEqual(allowlist);
    expect(result.allowlist.tools.length).toBe(600);
    expect(result.warning).toBeNull();
  });

  it('openai/openrouter/ollama: also untouched', () => {
    const manyTools = Array.from({ length: 700 }, (_, i) => `t${i}`);
    const allowlist: McpAllowlist = { servers: [], tools: manyTools };
    for (const providerId of ['openai', 'openrouter', 'ollama', 'github-copilot']) {
      const result = capMcpAllowlistForProvider(allowlist, providerId);
      expect(result.trimmed).toBe(false);
      expect(result.allowlist.tools.length).toBe(700);
    }
  });
});

describe('C4: explicit tools[] preferred over inherit-all servers[] when trimming', () => {
  it('keeps as many explicit tools as possible before spending budget on inherit-all servers', () => {
    // 500 explicit tools (fits within the ~500 budget) + several inherit-all
    // servers that would blow the budget if counted at all.
    const explicitTools = Array.from({ length: 500 }, (_, i) => `rhythm_tool_${i}`);
    const allowlist: McpAllowlist = {
      servers: ['propresenter', 'ableton-mcp', 'nfl_mcp'],
      tools: explicitTools,
    };
    const result = capMcpAllowlistForProvider(allowlist, 'google');

    expect(result.trimmed).toBe(true);
    // All budget consumed by explicit tools (or as many as fit) — inherit-all
    // servers are dropped first since they're the least-scoped/most-expensive.
    expect(result.allowlist.tools.length).toBeLessThanOrEqual(GEMINI_MCP_TOOL_BUDGET);
    expect(result.allowlist.servers.length).toBe(0);
  });
});

describe('C5: exactly-at-budget allowlist is unchanged', () => {
  it('allowlist estimated exactly at GEMINI_MCP_TOOL_BUDGET is not trimmed', () => {
    const tools = Array.from({ length: GEMINI_MCP_TOOL_BUDGET }, (_, i) => `t${i}`);
    const allowlist: McpAllowlist = { servers: [], tools };
    const result = capMcpAllowlistForProvider(allowlist, 'google');
    expect(result.trimmed).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.allowlist.tools.length).toBe(GEMINI_MCP_TOOL_BUDGET);
  });
});

describe('C6: null/undefined providerId is treated as non-google', () => {
  it('null providerId leaves an over-cap allowlist untouched', () => {
    const manyTools = Array.from({ length: 600 }, (_, i) => `t${i}`);
    const allowlist: McpAllowlist = { servers: [], tools: manyTools };
    expect(capMcpAllowlistForProvider(allowlist, null).trimmed).toBe(false);
    expect(capMcpAllowlistForProvider(allowlist, undefined).trimmed).toBe(false);
  });
});

describe('C7: trimmed result never exceeds the hard Gemini cap', () => {
  it('holds across a range of oversized inputs', () => {
    for (const toolCount of [513, 550, 1000, 5000]) {
      const tools = Array.from({ length: toolCount }, (_, i) => `t${i}`);
      const result = capMcpAllowlistForProvider({ servers: [], tools }, 'google');
      const total = result.allowlist.tools.length + result.allowlist.servers.length;
      expect(total).toBeLessThan(GEMINI_MAX_FUNCTION_DECLARATIONS);
    }
  });
});

describe('1468:1468-S3-api-real-count-scoped-cap:1 uses real inherit-all server counts', () => {
  it('trims twenty 29-tool servers to at most the 500-declaration MCP budget', () => {
    // Regression: the former flat estimate charged each server 25 declarations,
    // kept all 20, and offered 580 real declarations to Gemini.
    const servers = Array.from({ length: 20 }, (_, index) => `server_${index}`);
    const realToolCounts = Object.fromEntries(servers.map((server) => [server, 29]));

    const result = capMcpAllowlistForProvider(
      { servers, tools: [] },
      'google',
      realToolCounts,
    );

    const realCappedCount = result.allowlist.servers.reduce(
      (total, server) => total + realToolCounts[server],
      result.allowlist.tools.length,
    );
    expect(result.trimmed).toBe(true);
    expect(result.originalEstimatedCount).toBe(580);
    expect(realCappedCount).toBeLessThanOrEqual(GEMINI_MCP_TOOL_BUDGET);
    expect(result.cappedEstimatedCount).toBe(realCappedCount);
  });
});

describe('1468:1468-S3-api-real-count-scoped-cap:2 names bounded dropped entries', () => {
  it('lists the first twenty dropped tools and servers, then reports the remainder', () => {
    const tools = Array.from({ length: 525 }, (_, index) => `tool_${index}`);
    const servers = Array.from({ length: 25 }, (_, index) => `server_${index}`);
    const realToolCounts = Object.fromEntries(servers.map((server) => [server, 29]));

    const result = capMcpAllowlistForProvider(
      { servers, tools },
      'google',
      realToolCounts,
    );

    expect(result.warning).toContain(
      `dropped tools: ${Array.from({ length: 20 }, (_, index) => `tool_${index + 500}`).join(', ')}, +5 more`,
    );
    expect(result.warning).toContain(
      `dropped servers: ${Array.from({ length: 20 }, (_, index) => `server_${index}`).join(', ')}, +5 more`,
    );
  });

  it('returns a non-google allowlist unchanged even when real counts exceed Gemini limits', () => {
    const allowlist: McpAllowlist = { servers: ['large'], tools: [] };
    const result = capMcpAllowlistForProvider(allowlist, 'anthropic', { large: 900 });

    expect(result.trimmed).toBe(false);
    expect(result.allowlist).toBe(allowlist);
    expect(result.warning).toBeNull();
  });
});

// ── #952: unscoped-path deferred allowlist ──────────────────────────────────────
// The count-based cap above only trims an allowlist it is given. An UNSCOPED
// Gemini session hands the fork none, so the full surface goes through and blows
// the 512 cap. geminiUnscopedDeferredAllowlist is the binding fix for that path.

describe('#952 geminiUnscopedDeferredAllowlist', () => {
  const connected = ['rhythm', 'propresenter', 'pco-services'];

  it('google: returns an all-servers deferred allowlist (bounded declarations, all tools reachable)', () => {
    const result = geminiUnscopedDeferredAllowlist('google', connected);
    expect(result).not.toBeNull();
    expect(result!.deferred).toBe(true);
    // Every connected server is listed so the fork's deferred catalog covers
    // the whole surface — "unscoped = all tools" is preserved.
    expect(result!.servers).toEqual(connected);
    expect(result!.tools).toEqual([]);
  });

  it('non-google providers: returns null (surface left unrestricted, unchanged)', () => {
    for (const providerId of ['anthropic', 'openai', 'openrouter', 'ollama', null, undefined]) {
      expect(geminiUnscopedDeferredAllowlist(providerId, connected)).toBeNull();
    }
  });

  it('the returned surface is structurally bounded regardless of connected-server count', () => {
    // 200 inherit-all servers would be tens of thousands of real tools in eager
    // mode; deferred mode still advertises ONE dispatcher declaration, so the
    // 512 cap can never be exceeded no matter how many servers exist.
    const many = Array.from({ length: 200 }, (_, i) => `server_${i}`);
    const result = geminiUnscopedDeferredAllowlist('google', many);
    expect(result!.deferred).toBe(true);
    // No per-tool declarations are emitted from this allowlist itself.
    expect(result!.tools.length).toBe(0);
  });
});
