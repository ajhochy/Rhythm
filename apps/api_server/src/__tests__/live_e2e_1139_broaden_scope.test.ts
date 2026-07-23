/**
 * Live E2E test for #1139 — broaden-scope proposals can be APPROVED (no longer
 * 400 "No re-validation is registered for proposal kind 'broaden-scope'").
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Mirrors live_e2e_933_936.test.ts's conventions, but targets the
 * dev sandbox on :4098 by default (AGENT_LOCAL=true → no bearer token).
 *
 * Run it (against a sandbox built from THIS branch's source):
 *   tools/dev/sandbox.sh up
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *     RHYTHM_SANDBOX_DB="$SB/rhythm.db" \
 *     npx vitest run src/__tests__/live_e2e_1139_broaden_scope.test.ts
 *
 * Prerequisites:
 *   - api_server running on RHYTHM_LIVE_URL, built from this branch (so the
 *     broaden-scope validator/applier is registered at boot).
 *   - RHYTHM_SANDBOX_DB points at that server's sqlite DB (the deterministic
 *     seam: `broaden-scope` proposals originate server-side from the optimizer,
 *     with no HTTP create route, so we insert one row directly — exactly the
 *     shape workflow_signal_generator.proposeMissingScope emits — then drive it
 *     through the REAL approve HTTP path).
 *
 * What it proves, end to end against the real running backend:
 *   1. POST /agent-org-proposals/:id/approve for a broaden-scope proposal
 *      returns 2xx (NOT the 400 re-validation error) — the bug is fixed.
 *   2. The target agent's allowedMcpsJson actually contains the granted tool
 *      afterward (behavioral outcome, read back via GET /agent-configs/:id),
 *      with the prior entries preserved.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const DB = process.env.RHYTHM_SANDBOX_DB ?? '';

const describeLive = LIVE ? describe : describe.skip;

let createdConfigIds: string[] = [];
let createdProposalIds: string[] = [];

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

function sqlite(sql: string): string {
  return execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim();
}

interface AgentConfigRow {
  id: string;
  allowedMcpsJson: string | null;
}

function mcps(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

afterEach(() => {
  for (const id of createdProposalIds) {
    try {
      sqlite(`DELETE FROM agent_org_proposals WHERE id = '${id}';`);
    } catch {
      /* best-effort */
    }
  }
  for (const id of createdConfigIds) {
    // DELETE route exists for agent-configs; fall back to raw delete.
    try {
      sqlite(`DELETE FROM agent_configs WHERE id = '${id}';`);
    } catch {
      /* best-effort */
    }
  }
  createdProposalIds = [];
  createdConfigIds = [];
});

describeLive('live E2E — #1139 broaden-scope approve grants the scope', () => {
  beforeAll(async () => {
    if (!DB) throw new Error('set RHYTHM_SANDBOX_DB to the running server sqlite path');
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
  });

  it(
    'approving a broaden-scope proposal returns 2xx and appends the tool to allowedMcpsJson',
    async () => {
      // ── Create a real agent config via the API (prior scope = ['rhythm']) ──
      const created = await apiJson<AgentConfigRow>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label: `e2e-1139 orchestrator ${Date.now()}`,
          icon: 'flow',
          allowedMcpsJson: JSON.stringify(['rhythm']),
        }),
      });
      createdConfigIds.push(created.id);

      // ── Seed a broaden-scope proposal directly (no HTTP create route) with
      //    the EXACT flat shape workflow_signal_generator.proposeMissingScope
      //    emits: {agentConfigId, field:'allowedMcpsJson', add:[tool]} ────────
      const proposalId = randomUUID();
      const changeJson = JSON.stringify({
        agentConfigId: created.id,
        field: 'allowedMcpsJson',
        add: ['gitnexus'],
      }).replace(/'/g, "''");
      sqlite(
        `INSERT INTO agent_org_proposals (id, kind, risk, status, title, change_json, dedup_key, created_at, updated_at) ` +
          `VALUES ('${proposalId}', 'broaden-scope', 'high', 'proposed', 'Grant missing scope gitnexus (e2e-1139)', ` +
          `'${changeJson}', 'broaden-scope:e2e-1139:${proposalId}', datetime('now'), datetime('now'));`,
      );
      createdProposalIds.push(proposalId);

      // ── The bug: this used to 400 with the re-validation error ────────────
      const res = await api(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST' });
      const body = await res.text();
      expect(res.ok, `approve should not 400 — got ${res.status}: ${body}`).toBe(true);
      expect(body).not.toMatch(/No re-validation is registered/);

      // ── Behavioral outcome: the grant actually landed on the agent ────────
      const after = await apiJson<AgentConfigRow>(`/agent-configs/${created.id}`);
      const list = mcps(after.allowedMcpsJson);
      expect(list).toContain('gitnexus'); // the denied tool was granted
      expect(list).toContain('rhythm'); // prior scope preserved (add, not replace)
    },
    30_000,
  );
});
