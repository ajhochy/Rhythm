/**
 * Live E2E test for #933-#936 — the workflow-failure-signals chain.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`
 * suite. Mirrors live_e2e_948_949.test.ts's conventions, but targets
 * localhost:4000 (this machine's running instance), not :4001.
 *
 * Run it:
 *   RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_933_936.test.ts
 *
 * Prerequisites:
 *   - The Rhythm api_server is running on localhost:4000 (AGENT_LOCAL=true,
 *     so /agent-sessions and /agent-org-optimizer need no bearer token).
 *   - No opencode engine dependency — the workflow-failure signal path
 *     (session/message scan + denied_tool_events) never calls the engine;
 *     buildOrgAuditSnapshot's engine-gated drift section degrades to
 *     engineAvailable=false harmlessly when the engine isn't ready.
 *
 * Deterministic seam (per the chain's own design goal — no LLM turns
 * needed): two AGENT-LESS sessions (POST /agent-sessions with agentId=null,
 * OPC-#710 — a pure DB insert, no engine session spawned) sharing the same
 * fabricated issue number in taskTitle, left in their default 'starting'
 * status. This is exactly workflow_failure_signal_extractor.ts's
 * 'stale-redo' pattern: the same issue worked more than once with the LATEST
 * attempt not yet reaching a clean terminal status.
 *
 * What it proves, end to end against the real running backend:
 *   1. extractWorkflowFailureSignals surfaces the seeded stale-redo pattern
 *      (proven indirectly via step 3's proposal — the extractor has no
 *      standalone HTTP surface).
 *   2. buildOrgAuditSnapshot includes it AND stays read-only — the two
 *      seeded sessions are byte-identical before/after the run.
 *   3. runOrgOptimizer (POST /agent-org-optimizer/run) maps it to a
 *      create-recipe proposal (#935's mapping) that stays 'proposed' (HIGH
 *      risk, never auto-applied).
 *   4. Running the loop a second time does not duplicate the proposal
 *      (#936 dedup).
 *
 * Cleanup: the two seeded sessions are hard-deleted in afterEach. The
 * created proposal has no DELETE route (by design — proposals are an audit
 * trail); best-effort cleanup rejects it so it leaves the review queue.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { homedir } from 'node:os';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4000';

const describeLive = LIVE ? describe : describe.skip;

// A distinctive 6-digit issue number, re-derived per run, so this test can
// never collide with a real issue number from actual usage on the live server.
const ISSUE_NUM = 900000 + (Date.now() % 90000);

let createdSessionIds: string[] = [];
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

interface SessionRow {
  id: string;
  status: string;
  taskTitle: string | null;
  updatedAt: string;
}

async function createStaleRedoSession(label: string): Promise<string> {
  const sess = await apiJson<{ id: string }>('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({
      agentId: null, // OPC-#710 agent-less create — pure DB insert, no engine call
      cwd: homedir(),
      name: `live-e2e-933-936 ${label}`,
      taskTitle: `Fix bug #${ISSUE_NUM} (${label})`,
    }),
  });
  createdSessionIds.push(sess.id);
  return sess.id;
}

async function getSession(id: string): Promise<SessionRow> {
  const r = await apiJson<{ session: SessionRow }>(`/agent-sessions/${id}`);
  return r.session;
}

interface ProposalRow {
  id: string;
  kind: string;
  risk: string;
  status: string;
  rationale: string | null;
  dedupKey: string | null;
}

async function listProposed(): Promise<ProposalRow[]> {
  return apiJson<ProposalRow[]>('/agent-org-proposals?status=proposed');
}

/** Poll a predicate with a timeout (ms). Throws the last error on timeout. */
async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 500,
  label = 'poll',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms — last: ${String(lastErr)}`);
}

afterEach(async () => {
  // Best-effort cleanup — never let one test's leftovers break the next.
  for (const id of createdSessionIds) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => {});
  }
  for (const id of createdProposalIds) {
    // No DELETE route for proposals (audit trail by design) — reject is the
    // closest available "remove from the active queue" action.
    await api(`/agent-org-proposals/${id}/reject`, { method: 'POST' }).catch(() => {});
  }
  createdSessionIds = [];
  createdProposalIds = [];
});

describeLive('live E2E — #933-#936 workflow-failure-signals chain', () => {
  beforeAll(async () => {
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE} — start it first`);
  });

  it(
    'a stale-redo pattern flows extractor -> audit snapshot (read-only) -> proposal -> dedup on rerun',
    async () => {
      // ── Seed: two agent-less sessions reworking the same fabricated issue #,
      // the latest left in 'starting' (not a clean terminal status) ─────────
      await createStaleRedoSession('attempt 1');
      const secondId = await createStaleRedoSession('attempt 2 (retry)');

      const before = await getSession(secondId);
      expect(before.taskTitle).toContain(`#${ISSUE_NUM}`);

      // ── Run 1: extractor -> snapshot -> generator -> proposal ─────────────
      // maxProposalsPerRun is generously raised so real pending gaps already
      // on this server (scope-hygiene/recipe/webhook generators run BEFORE
      // the workflow-signal generator in the sweep) cannot starve the cap
      // before our signal's turn.
      const firstRun = await apiJson<{ auditRunId: string; proposalsCreated: number }>(
        '/agent-org-optimizer/run',
        { method: 'POST', body: JSON.stringify({ maxProposalsPerRun: 500 }) },
      );
      expect(firstRun.auditRunId).toBeTruthy();

      // Read-only proof: the seeded sessions this run READ are byte-identical
      // after the run — the audit snapshot never mutates what it scans.
      const afterFirstRun = await getSession(secondId);
      expect(afterFirstRun).toEqual(before);

      const proposal = await poll(
        async () => {
          const proposed = await listProposed();
          const found = proposed.find(
            (p) => p.kind === 'create-recipe' && p.rationale?.includes(`#${ISSUE_NUM}`),
          );
          if (!found) throw new Error('stale-redo proposal not yet visible');
          return found;
        },
        15_000,
        500,
        'find stale-redo create-recipe proposal',
      );
      createdProposalIds.push(proposal.id);

      expect(proposal.status).toBe('proposed'); // HIGH risk — never auto-applied
      expect(proposal.risk).toBe('high');
      expect(proposal.rationale).toContain('stale-redo');

      // ── Run 2: #936 dedup — must not duplicate ────────────────────────────
      await apiJson('/agent-org-optimizer/run', {
        method: 'POST',
        body: JSON.stringify({ maxProposalsPerRun: 500 }),
      });

      const proposedAfterSecondRun = await listProposed();
      const matches = proposedAfterSecondRun.filter((p) => p.dedupKey === proposal.dedupKey);
      expect(matches).toHaveLength(1);
    },
    30_000,
  );
});
