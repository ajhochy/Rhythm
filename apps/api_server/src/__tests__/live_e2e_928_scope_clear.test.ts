/**
 * Live E2E contract test for #928 — PATCH /session/:id null-clear for
 * skillAllowlist / mcpAllowlist.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — skips in the normal `vitest run` suite.
 *
 *   RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_928_scope_clear.test.ts
 *
 * WHY THIS TARGETS THE FORK SERVER, NOT api_server (:4001):
 *   #928's bug is a FORK schema defect. The vendored opencode fork's
 *   `UpdatePayload` (apps/opencode_fork/.../httpapi/groups/session.ts) declares
 *   `skillAllowlist: Schema.optional(Session.SkillAllowlist)` — `optional`
 *   WITHOUT `NullOr` strips an explicit `null` during payload decode, so the
 *   handler's correct `!== undefined` guard never fires and PATCH
 *   `{skillAllowlist:null}` returns 200 while persisting nothing. (Same
 *   wrong-schema-shape class as #765.) The api_server client already sends the
 *   correct `{skillAllowlist:null}` body — there is nothing to fix on the
 *   api_server side. So the faithful behavioral surface is the fork's own
 *   `PATCH /session/:id`, exactly the curl repro in the issue.
 *
 *   THIS TEST WILL FAIL against an UNPATCHED fork (null does not clear) and
 *   PASS once the fork schema is widened to `Schema.optional(Schema.NullOr(...))`.
 *   That fork change invalidates the shared engine build and MUST land through
 *   its own engine gate (see run log) — it is deliberately NOT in this branch.
 *
 * Target: RHYTHM_OPENCODE_URL (default http://127.0.0.1:4096 — the fork dev
 *   port). Build + launch the fork per docs/ai/testing-guide.md "Running the
 *   fork engine in dev", then run with RHYTHM_LIVE_E2E=1.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
// #928 lives in the fork's session route — target the fork server directly.
const BASE = process.env.RHYTHM_OPENCODE_URL ?? 'http://127.0.0.1:4096';
const DIR = process.env.RHYTHM_LIVE_CWD ?? process.env.HOME ?? '.';

const describeLive = LIVE ? describe : describe.skip;

interface SessionInfo {
  id: string;
  skillAllowlist?: { skills: string[] };
  mcpAllowlist?: { servers: string[]; tools: string[] };
}

async function forkJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(DIR)}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

describeLive('live E2E — #928 PATCH null-clears session allowlists (fork contract)', () => {
  beforeAll(async () => {
    try {
      await forkJson('/session'); // list — cheapest reachability probe
    } catch (err) {
      throw new Error(
        `fork server not reachable at ${BASE} — build + launch the fork ` +
          `(docs/ai/testing-guide.md "Running the fork engine in dev") first. ${String(err)}`,
      );
    }
  });

  it('skillAllowlist: set → null clears → [] stays deny-all', async () => {
    const created = await forkJson<SessionInfo>('/session', {
      method: 'POST',
      body: JSON.stringify({ title: '#928 skill null-clear' }),
    });
    const id = created.id;
    try {
      // Restrict.
      const restricted = await forkJson<SessionInfo>(`/session/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ skillAllowlist: { skills: ['task-management'] } }),
      });
      expect(restricted.skillAllowlist).toEqual({ skills: ['task-management'] });

      // #928 core: null must CLEAR (not no-op). Fails on unpatched fork.
      const cleared = await forkJson<SessionInfo>(`/session/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ skillAllowlist: null }),
      });
      expect(cleared.skillAllowlist).toBeUndefined();

      // And the clear must persist on a subsequent GET (not just the response).
      const afterGet = await forkJson<SessionInfo>(`/session/${id}`);
      expect(afterGet.skillAllowlist).toBeUndefined();

      // [] is deny-all — distinct from null (unrestricted). No regression.
      const denyAll = await forkJson<SessionInfo>(`/session/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ skillAllowlist: { skills: [] } }),
      });
      expect(denyAll.skillAllowlist).toEqual({ skills: [] });

      // null clears again, this time from deny-all.
      const clearedAgain = await forkJson<SessionInfo>(`/session/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ skillAllowlist: null }),
      });
      expect(clearedAgain.skillAllowlist).toBeUndefined();
    } finally {
      await forkJson(`/session/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  });

  it('mcpAllowlist: set → null clears (issue notes MCP may share the defect)', async () => {
    const created = await forkJson<SessionInfo>('/session', {
      method: 'POST',
      body: JSON.stringify({ title: '#928 mcp null-clear' }),
    });
    const id = created.id;
    try {
      const restricted = await forkJson<SessionInfo>(`/session/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ mcpAllowlist: { servers: ['rhythm'], tools: [] } }),
      });
      expect(restricted.mcpAllowlist).toEqual({ servers: ['rhythm'], tools: [] });

      const cleared = await forkJson<SessionInfo>(`/session/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ mcpAllowlist: null }),
      });
      expect(cleared.mcpAllowlist).toBeUndefined();

      const afterGet = await forkJson<SessionInfo>(`/session/${id}`);
      expect(afterGet.mcpAllowlist).toBeUndefined();
    } finally {
      await forkJson(`/session/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  });
});
