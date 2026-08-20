/**
 * Live #1433/#1434 proof (second pass, independent review): the critical
 * finding on the FIRST implementation was that a repair attempt could be
 * declared "clear" the instant it landed, because the re-check floor was
 * `now + 1ms` and no real evidence existed yet — the check always passed
 * trivially. This live test proves the FIX against the REAL running
 * scheduler (1-minute cron tick, real diagnosis call through the real
 * fork engine): a repair attempt that has landed but has NO real post-repair
 * evidence yet must stay `tripped` across multiple real sweep ticks, never
 * flip to `clear` on its own.
 *
 * Deliberately does NOT assert which specific fix the LLM diagnosis
 * produces (that content is non-deterministic) — only the evidence-gating
 * property, which is fully observable regardless of diagnosis content:
 *   1. Seeded error outcomes trip the guardrail.
 *   2. The FIRST repair attempt lands (a new proposal + `repairRecheckAfter`
 *      set) — but with zero real evidence at/after that floor, the event
 *      MUST remain `tripped`, across at least two real sweep ticks.
 *   3. Once real, sufficient CLEAN evidence is seeded after the floor, the
 *      event eventually moves off that exact floor (either `clear` or a
 *      second attempt) — proving the gate is responsive to real data, not
 *      just permanently stuck.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const DB = process.env.RHYTHM_SANDBOX_DB ?? '';
const configIds: string[] = [];
const proposalIds: string[] = [];

function sqlite(sql: string): string {
  return execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim();
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function poll<T>(fn: () => T, ok: (v: T) => boolean, timeoutMs: number, intervalMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = fn();
  while (Date.now() < deadline) {
    last = fn();
    if (ok(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  return last;
}

afterEach(() => {
  for (const id of proposalIds) {
    // agent_run_outcomes is an immutable audit ledger (no DELETE once
    // finalized) — the synthetic seeded rows are left behind in the
    // throwaway sandbox DB, same as every other live-E2E suite's seeded
    // outcomes; only the proposals/events/config rows below are cleaned up.
    const repairIds = sqlite(`SELECT repair_proposal_ids_json FROM agent_org_post_apply_events WHERE proposal_id = '${id}';`);
    try {
      for (const repairId of JSON.parse(repairIds || '[]') as string[]) {
        sqlite(`DELETE FROM agent_org_proposals WHERE id = '${repairId}';`);
      }
    } catch {
      // best-effort cleanup only
    }
    sqlite(`DELETE FROM agent_org_post_apply_events WHERE proposal_id = '${id}';`);
    sqlite(`DELETE FROM agent_org_proposals WHERE id = '${id}';`);
  }
  for (const id of configIds) sqlite(`DELETE FROM agent_configs WHERE id = '${id}';`);
  proposalIds.length = 0;
  configIds.length = 0;
});

describeLive('live E2E — D2.3 repair evidence gating (second pass)', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(BASE);
    if (url.hostname !== '127.0.0.1') {
      throw new Error('RHYTHM_LIVE_URL must target 127.0.0.1 (an isolated sandbox, never a public host)');
    }
    if (!DB || !isAbsolute(DB)) throw new Error('RHYTHM_SANDBOX_DB must be absolute');
    if (resolve(DB) !== resolve(process.env.DB_PATH ?? '') || resolve(DB) !== resolve(process.env.RHYTHM_LIVE_DB_PATH ?? '')) {
      throw new Error('all live DB variables must identify the sandbox database');
    }
    expect((await api('/health')).ok).toBe(true);
  });

  it(
    'a landed repair attempt with no real evidence stays tripped across real sweep ticks, and evidence-gating actually moves once fed real data',
    async () => {
      const configResponse = await api('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({ label: `D2.3 repair-evidence live ${Date.now()}`, icon: 'verified', modelProvider: 'anthropic', modelId: 'before' }),
      });
      expect(configResponse.ok).toBe(true);
      const config = await configResponse.json() as { id: string };
      configIds.push(config.id);

      const proposalId = randomUUID();
      proposalIds.push(proposalId);
      const changeJson = JSON.stringify({
        configPatch: { agentConfigId: config.id, field: 'model', value: 'anthropic/after' },
      }).replaceAll("'", "''");
      sqlite(
        `INSERT INTO agent_org_proposals (id, kind, risk, status, title, target_ref, change_json, dedup_key, created_at, updated_at) ` +
        `VALUES ('${proposalId}', 'refine-config', 'high', 'proposed', 'D2.3 repair-evidence live apply', 'profile:${config.id}', ` +
        `'${changeJson}', 'd2.3-repair-live:${proposalId}', datetime('now'), datetime('now'));`,
      );

      const approval = await api(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST' });
      expect(approval.ok, `approve returned ${approval.status}: ${await approval.text()}`).toBe(true);
      expect(Number(sqlite(`SELECT COUNT(*) FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`))).toBe(1);

      // Trip the guardrail with 5 REAL error outcome rows inside the window.
      for (let i = 0; i < 5; i += 1) {
        sqlite(
          `INSERT INTO agent_run_outcomes (id, session_id, root_session_id, profile_id, terminal_status, objective_verdict, finalized_at) ` +
          `VALUES ('trip-${proposalId}-${i}', 'trip-${proposalId}-${i}', 'trip-${proposalId}-${i}', '${config.id}', 'error', 'success', strftime('%Y-%m-%dT%H:%M:%fZ','now'));`,
        );
      }

      // Real sweep tick(s): trips, and — once diagnosis resolves — lands
      // repair attempt 1. Up to ~3 real cron ticks + diagnosis latency.
      const afterAttempt1 = await poll(
        () => ({
          guardrailStatus: sqlite(`SELECT guardrail_status FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
          repairIdsJson: sqlite(`SELECT repair_proposal_ids_json FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
          recheckAfter: sqlite(`SELECT COALESCE(repair_recheck_after, '') FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
        }),
        (v) => v.guardrailStatus === 'tripped' && JSON.parse(v.repairIdsJson || '[]').length >= 1,
        210_000,
      );
      expect(
        afterAttempt1.guardrailStatus,
        'guardrail must trip from the seeded error evidence',
      ).toBe('tripped');
      const repairIds = JSON.parse(afterAttempt1.repairIdsJson) as string[];
      expect(repairIds.length, 'a repair attempt must have landed (a real diagnosis + apply cycle)').toBeGreaterThanOrEqual(1);
      expect(afterAttempt1.recheckAfter, 'a landed attempt must set a recheck floor to await real evidence').not.toBe('');

      // THE CRITICAL REGRESSION PROOF: with zero real post-repair evidence,
      // the event must NOT be 'clear' — the old design declared success the
      // instant an attempt landed, because "no evidence yet" was silently
      // read as "no breach". Wait one more full real sweep tick and confirm
      // it is STILL exactly where it was: same recheck floor, same repair
      // count, still tripped.
      await new Promise((resolveWait) => setTimeout(resolveWait, 65_000));
      const stillPending = {
        guardrailStatus: sqlite(`SELECT guardrail_status FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
        repairIdsJson: sqlite(`SELECT repair_proposal_ids_json FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
        recheckAfter: sqlite(`SELECT COALESCE(repair_recheck_after, '') FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
      };
      expect(stillPending.guardrailStatus, 'no real evidence exists yet — must remain tripped, never a silent pass').toBe('tripped');
      expect(stillPending.recheckAfter).toBe(afterAttempt1.recheckAfter);
      expect(stillPending.repairIdsJson).toBe(afterAttempt1.repairIdsJson);

      // Now feed REAL clean evidence after the recorded recheck floor and
      // confirm the gate actually responds to it. All 5 outcomes are clean
      // ('completed'), so the ONLY correct evidence-gated resolution is
      // `guardrailStatus === 'clear'` — a same-tick-fabrication-free proof
      // that clean evidence heals the guardrail for real, not that a second
      // attempt merely started (which "the floor moved" alone cannot rule
      // out: an ADVANCING outcome — still-breaching evidence starting a NEW
      // attempt — would also change repairRecheckAfter/repairIdsJson).
      for (let i = 0; i < 5; i += 1) {
        sqlite(
          `INSERT INTO agent_run_outcomes (id, session_id, root_session_id, profile_id, terminal_status, objective_verdict, finalized_at) ` +
          `VALUES ('clean-${proposalId}-${i}', 'clean-${proposalId}-${i}', 'clean-${proposalId}-${i}', '${config.id}', 'completed', 'success', strftime('%Y-%m-%dT%H:%M:%fZ','now'));`,
        );
      }
      const resolved = await poll(
        () => ({
          guardrailStatus: sqlite(`SELECT guardrail_status FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
          revertStatus: sqlite(`SELECT revert_status FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
          repairAttemptCount: Number(sqlite(`SELECT repair_attempt_count FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`)),
          repairIdsJson: sqlite(`SELECT repair_proposal_ids_json FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
          alertPayloadJson: sqlite(`SELECT COALESCE(alert_payload_json, '') FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`),
        }),
        (v) => v.guardrailStatus === 'clear',
        150_000,
      );
      expect(
        resolved.guardrailStatus,
        `clean evidence never resolved the guardrail to 'clear' within the timeout ` +
          `(still: ${JSON.stringify(resolved)}) — advancing to another attempt on CLEAN ` +
          `evidence would be a regression of the evidence-gating fix itself`,
      ).toBe('clear');
      // Exact terminal persisted state — not merely "the floor changed",
      // which an ADVANCING (still-breaching, next-attempt) outcome could
      // also produce.
      expect(resolved.revertStatus, 'a clean resolution must never carry a revert alert').toBe('not_needed');
      const finalRepairIds = JSON.parse(resolved.repairIdsJson) as string[];
      expect(
        resolved.repairAttemptCount,
        'repair_attempt_count must exactly equal the number of repair proposals landed',
      ).toBe(finalRepairIds.length);
      expect(finalRepairIds, 'the repair proposal trail must be unchanged by clearing (no new attempt minted)').toEqual(repairIds);
      expect(resolved.alertPayloadJson, 'no revert alert may be persisted on a clean resolution').toBe('');

      const originalProposalStatus = sqlite(`SELECT status FROM agent_org_proposals WHERE id = '${proposalId}';`);
      expect(originalProposalStatus, 'the original proposal must settle active, never reverted').toBe('active');
    },
    600_000,
  );
});
