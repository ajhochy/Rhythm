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
