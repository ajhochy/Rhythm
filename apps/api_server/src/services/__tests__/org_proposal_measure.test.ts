/**
 * W6-c7 / W6-c8 / W6-c9 / W6-c11 — the body/rerun measures are demoted to
 * diagnostic evidence.
 *
 * The three sites where the measure path today establishes "this worked" —
 * scope hygiene, the LLM body score, and the behavioral re-run — KEEP their
 * deployment transition, their measureReason prose and every safety exit. What
 * they lose is authority over the OUTCOME field: they may write `inconclusive`,
 * never `verified`.
 */

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDb, setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { createScopeDeltaV2Snapshot } from '../scope_mutation_contract';
import { measureProposal } from '../org_proposal_measure';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

const repo = () => new AgentOrgProposalsRepository();

/** Walks a non-scope proposal to `measuring` through the real state machine. */
async function seedMeasuring(input: {
  id: string;
  kind: string;
  changeJson: string;
  beforeSnapshotJson?: string;
}): Promise<void> {
  const r = repo();
  await r.createAsync({
    id: input.id,
    kind: input.kind,
    risk: 'low',
    status: 'proposed',
    title: input.id,
    dedupKey: `dedup-${input.id}`,
    changeJson: input.changeJson,
    beforeSnapshotJson: input.beforeSnapshotJson ?? null,
  });
  await r.updateStatusAsync(input.id, 'applied');
  await r.updateStatusAsync(input.id, 'measuring');
}

/** A verified scope-delta-v2 pair: prior ['rhythm','dead'] -> applied ['rhythm']. */
function deltaV2Pair(targetId: string) {
  const priorValue = JSON.stringify(['rhythm', 'dead']);
  const changeJson = JSON.stringify({
    agentConfigId: targetId,
    field: 'allowedMcpsJson',
    remove: ['dead'],
  });
  const snapshot = createScopeDeltaV2Snapshot(
    targetId,
    'allowedMcpsJson',
    priorValue,
    ['dead'],
    'prune-scope',
    changeJson,
  );
  return { changeJson, snapshotJson: JSON.stringify(snapshot), applied: snapshot.expectedAppliedValue };
}

async function seedMeasuringScopeRow(id: string, targetId: string) {
  const pair = deltaV2Pair(targetId);
  new AgentConfigsRepository().insert({
    id: targetId,
    label: targetId,
    icon: 'x',
    allowedMcpsJson: pair.applied,
  });
  await repo().createAsync({
    id,
    kind: 'prune-scope',
    risk: 'low',
    status: 'proposed',
    title: id,
    dedupKey: `dedup-${id}`,
    targetRef: targetId,
    changeJson: pair.changeJson,
    beforeSnapshotJson: pair.snapshotJson,
  });
  // Scope kinds cannot reach `measuring` through the generic status updater,
  // so the state is planted the same way production rows arrive there.
  getDb().prepare('UPDATE agent_org_proposals SET status = ? WHERE id = ?').run('measuring', id);
}

const BODY_CHANGE = JSON.stringify({
  skillName: 'research',
  priorBody: 'old body',
  revisedBody: 'new and better body',
});

const RERUN_CHANGE = JSON.stringify({
  configPatch: { agentConfigId: 'cfg-1' },
  sessionIds: ['ses-1'],
  evidence: [{ category: 'retry-loop' }],
});

describe('W6-c7 the LLM body score is diagnostic only', () => {
  it('a clean keep DEPLOYS the proposal but does NOT establish verified improvement', async () => {
    await seedMeasuring({ id: 'p-body', kind: 'refine-skill', changeJson: BODY_CHANGE });
    const proposal = (await repo().findByIdAsync('p-body'))!;

    const outcome = await measureProposal(proposal, {
      scoreSkillBody: async (_purpose, body: string) =>
        ({ score: body === 'old body' ? 3 : 9, reason: 'judge' }) as never,
    });

    expect(outcome).toBe('kept');
    const after = (await repo().findByIdAsync('p-body'))!;
    expect(after.status).toBe('active'); // deployment survives
    expect(after.outcomeStatus).toBe('inconclusive'); // outcome authority is gone
    expect(after.outcomeStatus).not.toBe('verified');
    expect(after.measureReason).toContain('decision=keep'); // prose survives
  });

  it('still fails closed on an unknown score — the safety exits are untouched', async () => {
    await seedMeasuring({
      id: 'p-unknown',
      kind: 'refine-skill',
      changeJson: BODY_CHANGE,
      // The rollback material the revert replays. The skill row is deliberately
      // absent, so nothing touches the managed-skill filesystem.
      beforeSnapshotJson: JSON.stringify({
        skillId: 'sk-absent',
        priorBody: 'old body',
        priorStatus: 'active',
      }),
    });
    const proposal = (await repo().findByIdAsync('p-unknown'))!;

    const outcome = await measureProposal(proposal, {
      scoreSkillBody: async () => ({ score: 0, unknown: true, reason: 'scorer down' }) as never,
    });

    expect(outcome).toBe('reverted');
    const after = (await repo().findByIdAsync('p-unknown'))!;
    expect(after.status).toBe('reverted');
    // P1-2 — a revert is the record that something was CAUGHT. It must be
    // distinguishable from the `unproven` default, which means "nobody looked".
    expect(after.outcomeStatus).toBe('regressed');
    expect(after.outcomeStatus).not.toBe('unproven');
    expect(after.outcomeStatus).not.toBe('verified');
  });
});

describe('W6-c7 scope hygiene is diagnostic only — allowlist shrink cannot verify', () => {
  it('a passing functional guard DEPLOYS but does not verify', async () => {
    await seedMeasuringScopeRow('p-scope', 'cfg-scope');
    const proposal = (await repo().findByIdAsync('p-scope'))!;

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => new Set<string>(),
    });

    expect(outcome).toBe('kept');
    const after = (await repo().findByIdAsync('p-scope'))!;
    expect(after.status).toBe('active');
    expect(after.measureReason).toContain('functional guard passed');
    expect(after.outcomeStatus).toBe('inconclusive');
    expect(after.outcomeStatus).not.toBe('verified');
  });

  it('a FAILING functional guard still reverts — the safety-critical half is untouched', async () => {
    await seedMeasuringScopeRow('p-scope-bad', 'cfg-scope-bad');
    const proposal = (await repo().findByIdAsync('p-scope-bad'))!;

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => new Set<string>(['dead']),
    });

    expect(outcome).toBe('reverted');
    const after = (await repo().findByIdAsync('p-scope-bad'))!;
    expect(after.outcomeStatus).toBe('regressed');
    expect(after.outcomeStatus).not.toBe('unproven');
  });
});

describe('W6-c7 the behavioral re-run is diagnostic only', () => {
  it('a clean re-run DEPLOYS but does not verify', async () => {
    await seedMeasuring({ id: 'p-rerun', kind: 'refine-config', changeJson: RERUN_CHANGE });
    const proposal = (await repo().findByIdAsync('p-rerun'))!;

    const outcome = await measureProposal(proposal, {
      rerunScenario: async () => ({ status: 'completed', reason: 'no signature' }),
    });

    expect(outcome).toBe('kept');
    const after = (await repo().findByIdAsync('p-rerun'))!;
    expect(after.status).toBe('active');
    expect(after.outcomeStatus).toBe('inconclusive');
  });

  it('a reproduced failure reverts AND records regressed, not the unproven default', async () => {
    await seedMeasuring({
      id: 'p-rerun-bad',
      kind: 'refine-config',
      changeJson: RERUN_CHANGE,
      beforeSnapshotJson: JSON.stringify({
        agentConfigId: 'cfg-1',
        field: 'model',
        priorValue: 'old-model',
      }),
    });
    new AgentConfigsRepository().insert({ id: 'cfg-1', label: 'cfg-1', icon: 'x' });
    const proposal = (await repo().findByIdAsync('p-rerun-bad'))!;

    const outcome = await measureProposal(proposal, {
      rerunScenario: async () => ({ status: 'failed', reason: 'the original failure reproduced' }),
    });

    expect(outcome).toBe('reverted');
    const after = (await repo().findByIdAsync('p-rerun-bad'))!;
    expect(after.status).toBe('reverted');
    expect(after.outcomeStatus).toBe('regressed');
  });

  it('an infra error still SKIPS and leaves the row measuring for a later pass', async () => {
    await seedMeasuring({ id: 'p-infra', kind: 'refine-config', changeJson: RERUN_CHANGE });
    const proposal = (await repo().findByIdAsync('p-infra'))!;

    const outcome = await measureProposal(proposal, {
      rerunScenario: async () => ({ status: 'infra-error', reason: 'engine down' }),
    });

    expect(outcome).toBe('skipped');
    const after = (await repo().findByIdAsync('p-infra'))!;
    expect(after.status).toBe('measuring');
    expect(after.outcomeStatus).toBe('unproven');
  });

  it('a durably unresolvable payload still reaches reconciliation-required', async () => {
    await seedMeasuring({
      id: 'p-unresolvable',
      kind: 'refine-config',
      changeJson: JSON.stringify({ sessionIds: [] }),
    });
    const proposal = (await repo().findByIdAsync('p-unresolvable'))!;

    const outcome = await measureProposal(proposal, {});

    expect(outcome).toBe('reconciliation-required');
    expect((await repo().findByIdAsync('p-unresolvable'))!.status).toBe('reconciliation-required');
  });
});

describe('W6-c8 / W6-c9 deployment state and outcome state are distinct', () => {
  it('a proposal is simultaneously status=active and outcome_status=inconclusive', async () => {
    await seedMeasuring({ id: 'p-both', kind: 'refine-skill', changeJson: BODY_CHANGE });
    const proposal = (await repo().findByIdAsync('p-both'))!;
    await measureProposal(proposal, {
      scoreSkillBody: async (_p, body: string) =>
        ({ score: body === 'old body' ? 1 : 2, reason: 'judge' }) as never,
    });

    const after = (await repo().findByIdAsync('p-both'))!;
    expect([after.status, after.outcomeStatus]).toEqual(['active', 'inconclusive']);
  });

  it('the proposal STATUS machine is not extended — `inconclusive` is not a status', async () => {
    await seedMeasuring({ id: 'p-machine', kind: 'refine-skill', changeJson: BODY_CHANGE });
    await expect(repo().updateStatusAsync('p-machine', 'inconclusive')).rejects.toThrow(
      /Illegal agent_org_proposals status transition/,
    );
  });

  it('defaults to unproven — nothing is verified merely by existing', async () => {
    await seedMeasuring({ id: 'p-fresh', kind: 'refine-skill', changeJson: BODY_CHANGE });
    expect((await repo().findByIdAsync('p-fresh'))!.outcomeStatus).toBe('unproven');
  });

  it('reconciliation-required stays terminal for every automatic path', async () => {
    await seedMeasuring({ id: 'p-term', kind: 'refine-skill', changeJson: '{"bad":true}' });
    const proposal = (await repo().findByIdAsync('p-term'))!;
    expect(await measureProposal(proposal, {})).toBe('reconciliation-required');
    await expect(repo().updateStatusAsync('p-term', 'active')).rejects.toThrow(
      /Illegal agent_org_proposals status transition/,
    );
  });
});

describe('W6-c11 the outcome write is a revision-fenced CAS, not a raw UPDATE', () => {
  it('advances the revision exactly once', async () => {
    await seedMeasuring({ id: 'p-rev', kind: 'refine-skill', changeJson: BODY_CHANGE });
    const before = (await repo().findByIdAsync('p-rev'))!;

    await repo().setOutcomeStatusAtRevisionAsync({
      proposalId: 'p-rev',
      expectedRevision: before.revision,
      outcomeStatus: 'inconclusive',
    });

    const after = (await repo().findByIdAsync('p-rev'))!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.outcomeStatus).toBe('inconclusive');
    expect(after.status).toBe(before.status); // deployment untouched
  });

  it('refuses a write held against a revision it never read', async () => {
    await seedMeasuring({ id: 'p-stale', kind: 'refine-skill', changeJson: BODY_CHANGE });
    const stale = (await repo().findByIdAsync('p-stale'))!;
    await repo().setOutcomeStatusAtRevisionAsync({
      proposalId: 'p-stale',
      expectedRevision: stale.revision,
      outcomeStatus: 'inconclusive',
    });

    const refused = await repo().setOutcomeStatusAtRevisionAsync({
      proposalId: 'p-stale',
      expectedRevision: stale.revision, // now stale
      outcomeStatus: 'verified',
    });
    expect(refused).toBeNull();
    expect((await repo().findByIdAsync('p-stale'))!.outcomeStatus).toBe('inconclusive');
  });

  it('refuses an outcome value outside the closed set', async () => {
    await seedMeasuring({ id: 'p-junk', kind: 'refine-skill', changeJson: BODY_CHANGE });
    const current = (await repo().findByIdAsync('p-junk'))!;
    await expect(
      repo().setOutcomeStatusAtRevisionAsync({
        proposalId: 'p-junk',
        expectedRevision: current.revision,
        outcomeStatus: 'awesome' as never,
      }),
    ).rejects.toThrow(/outcome_status/);
  });
});
