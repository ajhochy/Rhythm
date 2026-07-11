import { describe, it, expect } from 'vitest';
import { expandProfileMcpAllowlist } from '../agent_profile_scope';

// #1012 — the pure expansion baked into agent .md frontmatter (options.mcpAllowlist)
// so the task tool can scope subagent sessions spawned via delegation.
describe('expandProfileMcpAllowlist (#1012)', () => {
  it('returns null for an unscoped profile (allowedMcpsJson === null)', () => {
    expect(expandProfileMcpAllowlist(null, 'agent-x', 'Agent X')).toBeNull();
  });

  it('server-array format → servers[] (inherit-all), empty tools[]', () => {
    const out = expandProfileMcpAllowlist('["rhythm","gmail-personal"]', 'secretary', 'Secretary');
    expect(out).not.toBeNull();
    expect(out!.servers).toEqual(expect.arrayContaining(['rhythm', 'gmail-personal']));
    expect(out!.tools).toEqual([]);
  });

  it('tools-map format → sanitized "<server>_<tool>" entries in tools[]', () => {
    const out = expandProfileMcpAllowlist('{"rhythm":["rhythm_list_tasks"]}', 'scoped', 'Scoped');
    expect(out).not.toBeNull();
    expect(out!.tools).toContain('rhythm_rhythm_list_tasks');
  });

  it('malformed JSON → fail-closed empty allowlist (never throws, never broadens)', () => {
    // A malformed scope must NOT fall back to "all tools" — it yields an empty
    // allowlist so a task-spawned child sees zero MCP tools, not everything.
    const out = expandProfileMcpAllowlist('{not json', 'agent-x', 'Agent X');
    expect(out).not.toBeNull();
    expect(out!.servers).toEqual([]);
    expect(out!.tools).toEqual([]);
  });
});
