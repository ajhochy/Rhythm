/**
 * Live E2E test for #1138 — corePermissionsJson projection converges (stale
 * permission keys are pruned on re-write) against the real running api_server.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Targets the dev sandbox on :4098 (AGENT_LOCAL=true → no bearer token);
 * reads the projected agent file from the sandbox HOME.
 *
 * Run it (against a sandbox built from THIS branch's source):
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *     RHYTHM_SANDBOX_HOME="$SB/home" \
 *     npx vitest run src/__tests__/live_e2e_1138_core_permissions.test.ts
 *
 * What it proves, end to end against the real running backend:
 *   1. A profile with corePermissionsJson {read:allow, edit:ask} projects a
 *      permission block containing BOTH keys (GET-projected via resync).
 *   2. After PATCHing the config down to {read:allow} and re-syncing, the
 *      projected .md no longer contains the stale `edit:` key — the merge path
 *      PRUNES it (the #1138 compounding bug: it used to only upsert).
 *   3. The result is valid, parseable frontmatter (no numbered-garbage keys).
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const SANDBOX_HOME = process.env.RHYTHM_SANDBOX_HOME ?? '';

const describeLive = LIVE ? describe : describe.skip;

let createdConfigIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}
async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

interface AgentConfigRow {
  id: string;
}

function projectedFile(id: string): string {
  return join(SANDBOX_HOME, '.config', 'opencode', 'agents', `${id}.md`);
}

afterEach(async () => {
  for (const id of createdConfigIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  createdConfigIds = [];
});

describeLive('live E2E — #1138 corePermissions projection prunes stale keys', () => {
  beforeAll(async () => {
    if (!SANDBOX_HOME) throw new Error('set RHYTHM_SANDBOX_HOME to the running server HOME');
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
  });

  it(
    'reducing corePermissionsJson prunes the stale key from the projected agent file',
    async () => {
      const label = `e2e-1138 perms ${Date.now()}`;
      // sessionSelectable so the profile is projected (shouldWriteAgentFile).
      const created = await apiJson<AgentConfigRow>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label,
          icon: 'shield',
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          corePermissionsJson: JSON.stringify({ read: 'allow', edit: 'ask' }),
        }),
      });
      createdConfigIds.push(created.id);

      // Force a projection and read the file back.
      await apiJson(`/agent-configs/${created.id}/resync-agent-file`, { method: 'POST' });
      const path = projectedFile(created.id);
      expect(existsSync(path), `expected projected file at ${path}`).toBe(true);
      let projected = readFileSync(path, 'utf8');
      expect(projected).toContain('read: allow');
      expect(projected).toContain('edit: ask');

      // Reduce the config to read-only and re-sync.
      await apiJson(`/agent-configs/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ corePermissionsJson: JSON.stringify({ read: 'allow' }) }),
      });
      await apiJson(`/agent-configs/${created.id}/resync-agent-file`, { method: 'POST' });

      projected = readFileSync(path, 'utf8');
      // The behavioral outcome: the stale `edit` key is GONE (pruned), the
      // valid `read` key remains, and no numbered-garbage keys appear.
      expect(projected).toContain('read: allow');
      expect(projected).not.toContain('edit: ask');
      expect(projected).not.toMatch(/^\s*edit:/m);
      expect(projected).not.toMatch(/^\s*"?0"?:/m);
    },
    30_000,
  );
});
