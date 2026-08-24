/**
 * D4.6 (#1444) — real Postgres counterpart to the SQLite feedback contract.
 *
 * This is deliberately opt-in and refuses a non-loopback database. The test
 * inserts only UUID-scoped fixture rows into a disposable database, then drives
 * the production repository/service branch (not a SQL mock).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../config/env';
import { getPostgresPool, initDb } from '../database/db';
import { PromotionTrustStateRepository } from '../repositories/promotion_trust_state_repository';
import { recordTrustCountersAsync } from '../services/trust_counter_service';

const enabled = process.env.RHYTHM_LIVE_PG === '1';
const describeLive = enabled ? describe : describe.skip;

function assertDisposableLoopback(): void {
  if (env.dbClient !== 'postgres') {
    throw new Error('D4.6 Postgres feedback contract requires DB_CLIENT=postgres');
  }
  if (!['127.0.0.1', '::1', 'localhost'].includes(env.dbHost)) {
    throw new Error('D4.6 Postgres feedback contract only permits a loopback disposable database');
  }
}

describeLive('D4.6 post-apply regression feedback — live Postgres', () => {
  const suffix = randomUUID();
  const experimentProposalId = `d4-1444-experiment-${suffix}`;
  const autoRevertProposalId = `d4-1444-auto-revert-${suffix}`;

  beforeAll(async () => {
    assertDisposableLoopback();
    await initDb();
    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO agent_org_proposals (id, kind, risk, status, title)
       VALUES ($1, 'refine-config', 'low', 'measuring', 'D4.6 experiment fixture'),
              ($2, 'refine-config', 'low', 'reverted', 'D4.6 D2 fixture')`,
      [experimentProposalId, autoRevertProposalId],
    );
    await pool.query(
      `INSERT INTO agent_org_experiments
         (id, proposal_id, adapter, evidence_bundle_json, baseline_spec_json,
          candidate_spec_json, assignment_key, stopping_rule_json, max_exposure, declared_at, decision, decided_at)
       VALUES ($1, $2, 'system-prompt-v1', '{"experimentAdapter":"system-prompt-v1"}',
               '{}', '{}', $3, '{"minSamplesPerCohort":5,"minEffect":0.05}', 20,
               NOW(), 'regress', NOW())`,
      [`d4-1444-experiment-row-${suffix}`, experimentProposalId, `d4-1444-key-${suffix}`],
    );
    await pool.query(
      `INSERT INTO agent_org_post_apply_events
          (id, proposal_id, profile_id, change_type, pre_change_snapshot_json,
          monitoring_window_start, monitoring_window_end, guardrail_status,
          repair_proposal_ids_json, revert_status, created_at, updated_at)
       VALUES ($1, $2, 'd4-1444-profile', 'prompt', '{}', NOW(), NOW(), 'tripped', '[]', 'reverted', NOW(), NOW())`,
      [`d4-1444-event-${suffix}`, autoRevertProposalId],
    );
  });

  afterAll(async () => {
    await getPostgresPool().end();
  });

  it('counts experiment and durable D2 regression once each, then atomically keeps the gate disabled across refreshes', async () => {
    const trust = new PromotionTrustStateRepository();
    await trust.updateAsync({ autoPromotionEnabled: true, enabledAt: '2026-08-21T00:00:00.000Z' });

    const first = await recordTrustCountersAsync();
    const second = await recordTrustCountersAsync();

    expect(first.totalRegressions).toBe(2);
    expect(first.autoPromotionEligible).toBe(false);
    expect(first.autoPromotionEnabled).toBe(false);
    expect(first.enabledAt).toBeNull();
    expect(second.totalRegressions).toBe(first.totalRegressions);
    expect(second.autoPromotionEnabled).toBe(false);
    expect(second.enabledAt).toBeNull();
  });
});
