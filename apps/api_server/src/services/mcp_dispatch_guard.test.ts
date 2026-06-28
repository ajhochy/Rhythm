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
    expect(isToolAllowed('read', '[]')).toBe(false); // array, not a record
    expect(isToolAllowed('read', '{}')).toBe(false); // no servers granted
    expect(isToolAllowed('read', 'null')).toBe(false);
  });
});
