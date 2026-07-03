/**
 * session_toolset_resolver.test.ts — #875 (setup-05): resolves which toolset
 * identifiers (see skill_visibility.ts's documented namespace) are connected
 * for the current session, from the live opencode engine MCP status.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveSessionToolsets } from '../session_toolset_resolver';

function mcpStatus(names: string[], status = 'connected'): Record<string, { status: string }> {
  const out: Record<string, { status: string }> = {};
  for (const n of names) out[n] = { status };
  return out;
}

describe('resolveSessionToolsets (#875)', () => {
  it('includes each connected MCP server id verbatim', async () => {
    const listMcp = vi.fn().mockResolvedValue(mcpStatus(['ableton-mcp', 'nfl_mcp']));
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('ableton-mcp')).toBe(true);
    expect(config.toolsets.has('nfl_mcp')).toBe(true);
  });

  it('adds the "mcp" bucket iff at least one MCP server is connected', async () => {
    const listMcp = vi.fn().mockResolvedValue(mcpStatus(['ableton-mcp']));
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('mcp')).toBe(true);
  });

  it('omits the "mcp" bucket when no MCP server is connected', async () => {
    const listMcp = vi.fn().mockResolvedValue({});
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('mcp')).toBe(false);
  });

  it('excludes a server reported but not connected (status !== "connected")', async () => {
    const listMcp = vi.fn().mockResolvedValue(mcpStatus(['flaky'], 'failed'));
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('flaky')).toBe(false);
    expect(config.toolsets.has('mcp')).toBe(false);
  });

  it('terminal is enabled by default (opts.terminalEnabled defaults true)', async () => {
    const listMcp = vi.fn().mockResolvedValue({});
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('terminal')).toBe(true);
  });

  it('terminal is excluded when explicitly disabled', async () => {
    const listMcp = vi.fn().mockResolvedValue({});
    const config = await resolveSessionToolsets({ listMcp, terminalEnabled: false });
    expect(config.toolsets.has('terminal')).toBe(false);
  });

  it('maps a curated "web"-flavored MCP server to the web toolset', async () => {
    const listMcp = vi.fn().mockResolvedValue(mcpStatus(['web', 'firecrawl']));
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('web')).toBe(true);
  });

  it('maps a curated "browser"-flavored MCP server to the browser toolset', async () => {
    const listMcp = vi.fn().mockResolvedValue(mcpStatus(['claude-in-chrome']));
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('browser')).toBe(true);
  });

  it('never throws when listMcp rejects — fail-open to an empty toolset set (+ terminal default)', async () => {
    const listMcp = vi.fn().mockRejectedValue(new Error('engine down'));
    const config = await resolveSessionToolsets({ listMcp });
    expect(config.toolsets.has('mcp')).toBe(false);
    expect(config.toolsets.has('terminal')).toBe(true);
  });
});
