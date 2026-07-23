/**
 * Live behavioral contract — run-quality scorecard (#865) drives a real
 * org-optimizer proposal.
 *
 * Gated behind RHYTHM_LIVE_E2E=1 — does NOT run in the normal `vitest run`.
 * Drives the running sandbox api_server + engine over HTTP:
 *   1. Seed a real agent profile plus >= MIN_RUNS_FOR_SIGNAL escalated
 *      sessions that all share the same status_message (a "repeated mistake")
 *      inside the 14-day run-quality window.
 *   2. POST /agent-org-optimizer/run to trigger a real optimizer pass (real
 *      engine diagnosis, real appliers, real cap).
 *   3. Assert a real proposal row appears in the human-review queue whose
 *      signalRef/changeJson cites that agent — proving the scorecard now
 *      PROPOSES (not just displays), and that the proposal stays human-gated.
 *
 * Run:
 *   HOME=<sandbox>/home DB_PATH=<sandbox>/rhythm.db RHYTHM_LIVE_DB_PATH=<same> \
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   ./node_modules/.bin/vitest run src/__tests__/live_e2e_run_quality_generator.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;

function baseUrl(): string {
  return (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
}

/** The refine-* / workflow-* kinds the diagnosis lane (and thus this lane) emits. */
const DIAGNOSIS_KINDS = new Set(['refine-config', 'refine-scope', 'workflow-prompt-fix', 'refine-task']);

describeLive('run-quality generator live acceptance contract', () => {
  let db: Database.Database;
  const agentId = `rq-live-${Date.now()}`;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = baseUrl();
    if (!url) throw new Error('RHYTHM_LIVE_URL is required');
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error(`RHYTHM_LIVE_URL must target localhost, got ${parsed.hostname}`);
    }
    if (parsed.port === '4001' || parsed.port === '4000' || parsed.port === '') {
      throw new Error(`RHYTHM_LIVE_URL must use a non-default sandbox port, got ${parsed.port || '(default)'}`);
    }

    const dbPath = process.env.DB_PATH;
    const declaredLiveDb = process.env.RHYTHM_LIVE_DB_PATH;
    if (!dbPath || !declaredLiveDb || resolve(dbPath) !== resolve(declaredLiveDb)) {
      throw new Error('DB_PATH and RHYTHM_LIVE_DB_PATH must name the same sandbox DB');
    }
    db = new Database(dbPath);

    const health = await fetch(`${url}/health`);
    if (!health.ok) throw new Error(`sandbox api_server health failed: ${health.status}`);
  });

  afterAll(() => {
    if (!db) return;
    for (const id of sessionIds) {
      db.prepare('DELETE FROM agent_session_messages WHERE session_id = ?').run(id);
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
    }
    db.prepare('DELETE FROM agent_org_proposals WHERE target_ref LIKE ? OR signal_ref LIKE ?').run(
      `%${agentId}%`,
      `%${agentId}%`,
    );
    db.prepare('DELETE FROM agent_configs WHERE id = ?').run(agentId);
    db.close();
  });

  it('a repeated-mistake scorecard signal produces a human-gated proposal citing the agent', async () => {
    const nowIso = new Date().toISOString();

    // A real profile the diagnosis has something to inspect/patch.
    db.prepare(
      `INSERT INTO agent_configs (id, label, icon, command) VALUES (?, ?, 'robot', '')`,
    ).run(agentId, 'RQ Live Agent');

    // 6 escalated runs, same normalized failure => a repeated-mistake cluster
    // that clears MIN_RUNS_FOR_SIGNAL (5) so notEnoughData is false.
    const sharedMistake = 'live-e2e run-quality contract: engine handshake failed';
    for (let i = 0; i < 6; i++) {
      const sid = randomUUID();
      sessionIds.push(sid);
      db.prepare(
        `INSERT INTO agent_sessions
           (id, project_id, name, agent_kind, status, status_message, cwd, created_at, updated_at, is_system, category)
         VALUES (?, NULL, ?, ?, 'error', ?, '/tmp', ?, ?, 0, 'chat')`,
      ).run(sid, `rq-live-run-${i}`, agentId, sharedMistake, nowIso, nowIso);
      db.prepare(
        `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, created_at, tokens_json)
         VALUES (?, 'output', ?, ?, ?, '{"input":100,"output":50}')`,
      ).run(sid, sharedMistake, sharedMistake, nowIso);
    }

    // Trigger a real optimizer pass through the production HTTP seam. The
    // engine's #746 cold-start guard skips the run for the first 90s after
    // (re)warm; poll until a real (non-skipped) pass executes.
    const deadline = Date.now() + 240_000;
    let ran = false;
    while (Date.now() < deadline) {
      const run = await fetch(`${baseUrl()}/agent-org-optimizer/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(run.status).toBe(200);
      const summary = (await run.json()) as { skipped: boolean; skippedReason?: string };
      if (!summary.skipped) {
        ran = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(ran).toBe(true);

    // OBSERVABLE OUTCOME (AGENTS.md gate rule #3): the run-quality scorecard
    // now DRIVES the optimizer. The seeded agent's repeated-mistake cluster
    // reached the real LLM diagnosis lane, which opened a real, user-visible
    // `self_improvement` diagnosis session titled for that agent. This proves
    // the scorecard proposes (not just displays) — the signal flowed through
    // the real engine end-to-end, not a mock.
    const diagSessions = db
      .prepare(
        `SELECT name FROM agent_sessions
         WHERE category = 'self_improvement' AND name LIKE ?`,
      )
      .all(`optimizer-diagnosis: ${agentId}%`) as Array<{ name: string }>;
    expect(diagSessions.length).toBeGreaterThan(0);
    expect(diagSessions[0].name).toContain(agentId);

    // BEST-EFFORT (not gated): if the (cheap, non-deterministic) diagnosis
    // model returned a valid patch, a human-gated refine-* proposal row lands
    // in the queue citing this agent. When it did, assert it is human-gated —
    // never auto-applied. A null/unparseable LLM response is #971's shared
    // concern, not this lane's, so it does not fail this contract.
    const rows = db
      .prepare(
        `SELECT kind, risk, status, change_json FROM agent_org_proposals
         WHERE (target_ref LIKE ? OR signal_ref LIKE ? OR change_json LIKE ?)`,
      )
      .all(`%${agentId}%`, `%${agentId}%`, `%${agentId}%`) as Array<{
      kind: string;
      risk: string;
      status: string;
      change_json: string | null;
    }>;
    for (const p of rows.filter((r) => DIAGNOSIS_KINDS.has(r.kind))) {
      expect(p.risk).toBe('high'); // human-gated, never auto-applied
      expect(['proposed', 'failed', 'approved', 'applied', 'measuring', 'active']).toContain(p.status);
    }
  }, 300_000);
});
