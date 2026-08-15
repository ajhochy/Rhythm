/**
 * W5 — the READ-ONLY lifecycle reconciler
 * (contract docs/ai/contracts/issue-W5-shadow-reconciler.json).
 *
 *  - W5-c5:  active scope rows classify as exactly one of effective,
 *            reintroduced-drifted, unsafe-legacy-rollback, conflicted, or
 *            unverifiable. A row that cannot be proven is unverifiable — never
 *            assumed effective.
 *  - W5-c6:  the reconciler writes nothing. Proved by a full before/after
 *            comparison of agent_configs AND agent_org_proposals.
 *  - W5-c9:  a retryable measuring row past its budget classifies as
 *            inconclusive and inspectable, instead of retrying forever in
 *            silence. Derived from columns that already exist — no new schema.
 *  - W5-c10: the live-audit shape (legacy whole-field snapshots on ACTIVE
 *            rows) classifies as unsafe legacy rollback and changes no config.
 *
 * This is deliberately NOT the W1 recovery sweep: that one ACTS on approved/
 * applied rows, this one only reports on ACTIVE ones.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { getDb, setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { createScopeDeltaV2Snapshot } from '../scope_mutation_contract';
import {
  MEASURING_BUDGET_MS,
  classifyStuckMeasurement,
  reconcileActiveScopeProposals,
  reconcileStuckMeasurements,
} from '../org_proposal_reconciler';

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

/** Everything the reconciler could conceivably touch, as comparable bytes. */
function durableState(): string {
  const db = getDb();
  return JSON.stringify({
    configs: db.prepare('SELECT * FROM agent_configs ORDER BY id').all(),
    proposals: db.prepare('SELECT * FROM agent_org_proposals ORDER BY id').all(),
  });
}

function seedProfile(id: string, mcps: string[]): void {
  new AgentConfigsRepository().insert({
    id,
    label: id,
    icon: 'x',
    allowedMcpsJson: JSON.stringify(mcps),
  });
}

/** Plants an ACTIVE scope row directly — the terminal shape the audit found. */
async function seedActiveScopeRow(input: {
  id: string;
  targetId: string;
  changeJson: string | null;
  beforeSnapshotJson: string | null;
  kind?: string;
}): Promise<void> {
  const repo = new AgentOrgProposalsRepository();
  const created = await repo.createAsync({
    id: input.id,
    kind: input.kind ?? 'prune-scope',
    risk: 'high',
    status: 'proposed',
    title: input.id,
    dedupKey: `dedup-${input.id}`,
    targetRef: input.targetId,
    changeJson: input.changeJson,
    beforeSnapshotJson: input.beforeSnapshotJson,
  });
  // Scope kinds cannot walk to `active` through the generic status updater
  // (that path requires the atomic target-pair primitive), so the terminal
  // state is planted directly — exactly how these rows exist in production.
  getDb().prepare('UPDATE agent_org_proposals SET status = ? WHERE id = ?').run('active', created.id);
}

/** A verified scope-delta-v2 pair: prior ['rhythm','dead'] -> applied ['rhythm']. */
function deltaV2Pair(targetId: string): { changeJson: string; snapshotJson: string; appliedValue: string } {
  const priorValue = JSON.stringify(['rhythm', 'dead']);
  const changeJson = JSON.stringify({ agentConfigId: targetId, field: 'allowedMcpsJson', remove: ['dead'] });
  const snapshot = createScopeDeltaV2Snapshot(
    targetId, 'allowedMcpsJson', priorValue, ['dead'], 'prune-scope', changeJson,
  );
  return {
    changeJson,
    snapshotJson: JSON.stringify(snapshot),
    appliedValue: snapshot.expectedAppliedValue,
  };
}

describe('W5-c5: active scope rows classify into exactly the five documented outcomes', () => {
  it('a row whose target still holds the exact applied bytes is effective', async () => {
    const pair = deltaV2Pair('secretary');
    seedProfile('secretary', ['rhythm']); // == expectedAppliedValue
    await seedActiveScopeRow({
      id: 'p-effective', targetId: 'secretary',
      changeJson: pair.changeJson, beforeSnapshotJson: pair.snapshotJson,
    });

    const report = await reconcileActiveScopeProposals();
    expect(report.rows.find((r) => r.proposalId === 'p-effective')?.classification).toBe('effective');
  });

  it('a row whose removed entry is back in the live allowlist is reintroduced-drifted', async () => {
    const pair = deltaV2Pair('secretary');
    seedProfile('secretary', ['rhythm', 'dead']); // the removal was undone
    await seedActiveScopeRow({
      id: 'p-reintroduced', targetId: 'secretary',
      changeJson: pair.changeJson, beforeSnapshotJson: pair.snapshotJson,
    });

    const report = await reconcileActiveScopeProposals();
    expect(report.rows.find((r) => r.proposalId === 'p-reintroduced')?.classification)
      .toBe('reintroduced-drifted');
  });

  it('a row whose target moved for an unrelated reason is conflicted', async () => {
    const pair = deltaV2Pair('secretary');
    seedProfile('secretary', ['rhythm', 'something-else']); // later, unrelated edit
    await seedActiveScopeRow({
      id: 'p-conflicted', targetId: 'secretary',
      changeJson: pair.changeJson, beforeSnapshotJson: pair.snapshotJson,
    });

    const report = await reconcileActiveScopeProposals();
    expect(report.rows.find((r) => r.proposalId === 'p-conflicted')?.classification).toBe('conflicted');
  });

  it('a row whose target no longer exists is unverifiable, NEVER effective', async () => {
    const pair = deltaV2Pair('vanished');
    await seedActiveScopeRow({
      id: 'p-missing-target', targetId: 'vanished',
      changeJson: pair.changeJson, beforeSnapshotJson: pair.snapshotJson,
    });

    const report = await reconcileActiveScopeProposals();
    expect(report.rows.find((r) => r.proposalId === 'p-missing-target')?.classification)
      .toBe('unverifiable');
  });

  it('a versioned snapshot whose integrity hash no longer verifies is unverifiable', async () => {
    const pair = deltaV2Pair('secretary');
    seedProfile('secretary', ['rhythm']);
    const tampered = JSON.parse(pair.snapshotJson) as Record<string, unknown>;
    tampered.integrityHash = 'f'.repeat(64);
    await seedActiveScopeRow({
      id: 'p-tampered', targetId: 'secretary',
      changeJson: pair.changeJson, beforeSnapshotJson: JSON.stringify(tampered),
    });

    const report = await reconcileActiveScopeProposals();
    expect(report.rows.find((r) => r.proposalId === 'p-tampered')?.classification).toBe('unverifiable');
  });

  it('a row with no snapshot at all is unverifiable', async () => {
    seedProfile('secretary', ['rhythm']);
    await seedActiveScopeRow({
      id: 'p-no-snapshot', targetId: 'secretary',
      changeJson: JSON.stringify({ agentConfigId: 'secretary', field: 'allowedMcpsJson', remove: ['dead'] }),
      beforeSnapshotJson: null,
    });

    const report = await reconcileActiveScopeProposals();
    expect(report.rows.find((r) => r.proposalId === 'p-no-snapshot')?.classification).toBe('unverifiable');
  });

  it('the report totals and per-classification counts agree with the rows', async () => {
    const pair = deltaV2Pair('secretary');
    seedProfile('secretary', ['rhythm']);
    await seedActiveScopeRow({
      id: 'p-a', targetId: 'secretary',
      changeJson: pair.changeJson, beforeSnapshotJson: pair.snapshotJson,
    });
    await seedActiveScopeRow({
      id: 'p-b', targetId: 'secretary', changeJson: null, beforeSnapshotJson: null,
    });

    const report = await reconcileActiveScopeProposals();
    expect(report.total).toBe(report.rows.length);
    const summed = Object.values(report.byClassification).reduce((a, b) => a + b, 0);
    expect(summed).toBe(report.total);
    // Deterministic ordering, so the operator script's JSON is stable.
    expect(report.rows.map((r) => r.proposalId)).toEqual([...report.rows.map((r) => r.proposalId)].sort());
  });
});

describe('W5-c10: the live-audit legacy shape reports safely and changes no config', () => {
  it('an active row carrying the old whole-field snapshot is unsafe-legacy-rollback', async () => {
    // The exact shape the plan's live audit found on 69 active rows: a
    // whole-field `{allowedMcpsJson: prior}` blob. Replaying it would clobber
    // every unrelated change made since, so it can never be rolled back
    // automatically — it has to be named as such and handed to a human.
    seedProfile('secretary', ['rhythm', 'later-addition']);
    await seedActiveScopeRow({
      id: 'p-legacy', targetId: 'secretary',
      changeJson: JSON.stringify({ agentConfigId: 'secretary', field: 'allowedMcpsJson', remove: ['dead'] }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['rhythm', 'dead']) }),
    });

    const before = durableState();
    const report = await reconcileActiveScopeProposals();

    expect(report.rows.find((r) => r.proposalId === 'p-legacy')?.classification)
      .toBe('unsafe-legacy-rollback');
    expect(durableState()).toBe(before);
  });

  it('many legacy rows are all reported, none of them mistaken for effective', async () => {
    seedProfile('secretary', ['rhythm', 'later-addition']);
    for (let i = 0; i < 25; i++) {
      await seedActiveScopeRow({
        id: `legacy-${i}`, targetId: 'secretary',
        changeJson: JSON.stringify({ agentConfigId: 'secretary', field: 'allowedMcpsJson', remove: [`dead-${i}`] }),
        beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['rhythm', `dead-${i}`]) }),
      });
    }

    const before = durableState();
    const report = await reconcileActiveScopeProposals();

    expect(report.byClassification['unsafe-legacy-rollback']).toBe(25);
    expect(report.byClassification.effective).toBe(0);
    expect(durableState()).toBe(before);
  });
});

describe('W5-c6: the reconciler performs no writes of any kind', () => {
  it('agent_configs and agent_org_proposals are byte-identical across a run over every classification', async () => {
    const pair = deltaV2Pair('secretary');
    seedProfile('secretary', ['rhythm']);
    seedProfile('other', ['rhythm', 'dead']);
    await seedActiveScopeRow({
      id: 'r-effective', targetId: 'secretary',
      changeJson: pair.changeJson, beforeSnapshotJson: pair.snapshotJson,
    });
    const otherPair = deltaV2Pair('other');
    await seedActiveScopeRow({
      id: 'r-reintroduced', targetId: 'other',
      changeJson: otherPair.changeJson, beforeSnapshotJson: otherPair.snapshotJson,
    });
    await seedActiveScopeRow({
      id: 'r-legacy', targetId: 'secretary',
      changeJson: JSON.stringify({ agentConfigId: 'secretary', field: 'allowedMcpsJson', remove: ['dead'] }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['rhythm', 'dead']) }),
    });
    await seedActiveScopeRow({
      id: 'r-unverifiable', targetId: 'secretary', changeJson: null, beforeSnapshotJson: null,
    });

    const before = durableState();
    const report = await reconcileActiveScopeProposals();
    expect(report.total).toBe(4);
    expect(durableState()).toBe(before);

    // Running it twice must also be inert AND deterministic.
    const second = await reconcileActiveScopeProposals();
    expect(durableState()).toBe(before);
    expect(JSON.stringify(second)).toBe(JSON.stringify(report));
  });
});

describe('W5-c9: a retryable measuring row past its budget becomes deterministically inconclusive', () => {
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');

  it('a fresh measuring row is within budget', () => {
    const verdict = classifyStuckMeasurement(
      { status: 'measuring', updatedAt: new Date(NOW - 60_000).toISOString() },
      { now: NOW },
    );
    expect(verdict.verdict).toBe('within-budget');
  });

  it('a measuring row that has sat past the budget is inconclusive', () => {
    const verdict = classifyStuckMeasurement(
      { status: 'measuring', updatedAt: new Date(NOW - MEASURING_BUDGET_MS - 1).toISOString() },
      { now: NOW },
    );
    expect(verdict.verdict).toBe('inconclusive');
    expect(verdict.ageMs).toBeGreaterThan(MEASURING_BUDGET_MS);
    expect(verdict.reason).toMatch(/inconclusive/i);
  });

  it('is deterministic — the same row and clock always give the same verdict', () => {
    const row = { status: 'measuring', updatedAt: new Date(NOW - MEASURING_BUDGET_MS - 5).toISOString() };
    expect(classifyStuckMeasurement(row, { now: NOW })).toEqual(classifyStuckMeasurement(row, { now: NOW }));
  });

  it('an unreadable updated_at is inconclusive, never silently within budget', () => {
    expect(classifyStuckMeasurement({ status: 'measuring', updatedAt: 'not-a-date' }, { now: NOW }).verdict)
      .toBe('inconclusive');
  });

  it('the sweep-facing report lists stuck rows and writes nothing', async () => {
    const repo = new AgentOrgProposalsRepository();
    const stuck = await repo.createAsync({
      id: 'm-stuck', kind: 'refine-skill', risk: 'high', status: 'proposed',
      title: 'stuck', dedupKey: 'dedup-m-stuck', changeJson: '{}',
    });
    await repo.updateStatusAsync(stuck.id, 'applied');
    await repo.updateStatusAsync(stuck.id, 'measuring');
    getDb()
      .prepare('UPDATE agent_org_proposals SET updated_at = ? WHERE id = ?')
      .run(new Date(NOW - MEASURING_BUDGET_MS - 60_000).toISOString(), 'm-stuck');

    const before = durableState();
    const report = await reconcileStuckMeasurements({ now: NOW });

    expect(report.inconclusive.map((r) => r.proposalId)).toContain('m-stuck');
    expect(report.withinBudget.some((r) => r.proposalId === 'm-stuck')).toBe(false);
    expect(durableState()).toBe(before);
  });
});
