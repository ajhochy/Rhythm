/**
 * Unit tests for the #736 pure dispatch-guard predicate `isToolAllowed`.
 *
 * Locks the matching contract the OpencodeStreamBridge relies on:
 *  - null allowlist → unrestricted (non-role session pass-through)
 *  - inherit-all server ([]) → server-prefixed tools allowed
 *  - explicit per-tool list → only listed tools allowed (bare / composed / mcp__)
 *  - malformed / empty allowlist → fail closed (deny)
 */

import { describe, it, expect } from 'vitest';
import { isToolAllowed } from './mcp_dispatch_guard';

describe('isToolAllowed (#736 dispatch guard)', () => {
  it('returns true for any tool when allowlist is null (non-role session)', () => {
    expect(isToolAllowed('bash', null)).toBe(true);
    expect(isToolAllowed('rhythm_delete_task', null)).toBe(true);
    expect(isToolAllowed('anything', undefined)).toBe(true);
  });

  it('allows an explicitly-listed MCP tool and denies an unlisted one', () => {
    const json = JSON.stringify({ rhythm: ['rhythm_list_tasks', 'rhythm_create_task'] });
    expect(isToolAllowed('rhythm_list_tasks', json)).toBe(true);
    expect(isToolAllowed('rhythm_delete_task', json)).toBe(false);
  });

  it('allows a builtin granted via an empty inherit-all array', () => {
    const json = JSON.stringify({ read: [] });
    expect(isToolAllowed('read', json)).toBe(true);
    // A different builtin not granted by any server is denied.
    expect(isToolAllowed('bash', json)).toBe(false);
  });

  it('matches gmail-style composed names where the grant is the bare tool', () => {
    // POST /agent-sessions persists gmail-work: ["search_emails","read_email"];
    // the engine emits the composed id `gmail-work_search_emails`.
    const json = JSON.stringify({ 'gmail-work': ['search_emails', 'read_email'] });
    expect(isToolAllowed('gmail-work_search_emails', json)).toBe(true);
    expect(isToolAllowed('search_emails', json)).toBe(true);
    expect(isToolAllowed('gmail-work_send_email', json)).toBe(false);
  });

  it('accepts the mcp__server__tool form defensively', () => {
    const json = JSON.stringify({ rhythm: ['rhythm_list_tasks'] });
    expect(isToolAllowed('mcp__rhythm__rhythm_list_tasks', json)).toBe(true);
    expect(isToolAllowed('mcp__rhythm__rhythm_delete_task', json)).toBe(false);
  });

  it('fails closed on malformed or empty allowlists', () => {
    expect(isToolAllowed('read', 'not-json{')).toBe(false);
    expect(isToolAllowed('read', '[]')).toBe(false); // empty server-name array → deny all
    expect(isToolAllowed('read', '{}')).toBe(false); // no servers granted
    expect(isToolAllowed('read', 'null')).toBe(false);
  });

  // #812 — writers (agent_profile_scope, agent_runner) persist the allowlist as
  // a JSON ARRAY of server names (e.g. ["rhythm"]) meaning "inherit all tools of
  // each named server". The guard must accept this shape, not just the object
  // map, or every tool on a role-scoped session is blocked.
  describe('array-of-server-names form (#812)', () => {
    it('grants inherit-all for each listed server', () => {
      expect(isToolAllowed('rhythm_rhythm_get_dashboard', '["rhythm"]')).toBe(true);
      expect(isToolAllowed('rhythm_rhythm_remember_memory', '["rhythm"]')).toBe(true);
      // The bare server name itself is permitted.
      expect(isToolAllowed('rhythm', '["rhythm"]')).toBe(true);
    });

    it('denies tools of servers not in the array', () => {
      expect(isToolAllowed('nfl_mcp_get_roster', '["rhythm"]')).toBe(false);
      expect(isToolAllowed('gmail-work_send_email', '["rhythm"]')).toBe(false);
    });

    it('handles multiple listed servers', () => {
      const json = JSON.stringify(['rhythm', 'pco-services']);
      expect(isToolAllowed('rhythm_rhythm_ping', json)).toBe(true);
      expect(isToolAllowed('pco-services_get_plans', json)).toBe(true);
      expect(isToolAllowed('nfl_mcp_get_roster', json)).toBe(false);
    });

    it('accepts the mcp__server__tool form against an array allowlist', () => {
      expect(
        isToolAllowed('mcp__rhythm__rhythm_get_dashboard', '["rhythm"]'),
      ).toBe(true);
      expect(isToolAllowed('mcp__nfl_mcp__get_roster', '["rhythm"]')).toBe(false);
    });

    it('empty array denies everything', () => {
      expect(isToolAllowed('rhythm_rhythm_ping', '[]')).toBe(false);
    });

    it('ignores non-string members but honors valid ones', () => {
      const json = JSON.stringify(['rhythm', 123, null]);
      expect(isToolAllowed('rhythm_rhythm_ping', json)).toBe(true);
      expect(isToolAllowed('nfl_mcp_get_roster', json)).toBe(false);
    });
  });
});
