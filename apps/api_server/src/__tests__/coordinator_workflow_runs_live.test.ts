/**
 * Live check of the coordinator run list against a RUNNING isolated sandbox
 * (tools/dev/sandbox.sh) after coding goals were given in its Coordinator chat.
 * It starts no model work; it proves the real route and the exactly-once report.
 *
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API=http://127.0.0.1:4098 RHYTHM_LIVE_BEARER=<sandbox token> \
 *   RHYTHM_LIVE_DB=/private/tmp/<sandbox>/rhythm.db npx vitest run src/__tests__/coordinator_workflow_runs_live.test.ts
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const api = process.env.RHYTHM_LIVE_API ?? 'http://127.0.0.1:4098';
const bearer = process.env.RHYTHM_LIVE_BEARER ?? '';

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

describe.skipIf(!live)('coordinator workflow runs (live sandbox)', () => {
  it('lists each started run with its branch and reports each finished run exactly once', async () => {
    // Regressions caught: a started run missing from the list, a finished run
    // without a branch, or a completion delivered twice (e.g. after a restart).
    const root = await post('/coordinator-conversations/resolve', {}) as { sessionId: string; projectId: string };
    const { runs } = await post('/coordinator-conversations/runs', { sessionId: root.sessionId, projectId: root.projectId }) as {
      runs: Array<{ delegationId: string; status: string; branch: string | null; reported: boolean; usage: { totalTokens: number } }>;
    };
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const finished = runs.filter((run) => run.status === 'finished');
    expect(finished.length).toBeGreaterThanOrEqual(2);
    for (const run of finished) {
      expect(run.branch).toMatch(/\S/);
      expect(run.reported).toBe(true);
      expect(run.usage.totalTokens).toBeGreaterThan(0);
    }
    const db = new Database(process.env.RHYTHM_LIVE_DB!, { readonly: true });
    try {
      const notified = db.prepare(`SELECT COUNT(*) AS n FROM agent_async_delegations
        WHERE parent_session_id=? AND status='notified'`).get(root.sessionId) as { n: number };
      const reports = db.prepare(`SELECT COUNT(*) AS n FROM agent_session_messages
        WHERE session_id=? AND role='input' AND stripped_text LIKE '[Async delegation update]%'`).get(root.sessionId) as { n: number };
      // One wake per notified delegation in this demo (no two finished in the same idle window).
      expect(reports.n).toBe(notified.n);
    } finally {
      db.close();
    }
  });
});
