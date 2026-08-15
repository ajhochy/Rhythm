/**
 * W6-c3 — the additive experiment table and its repository.
 *
 * Seven things must be recordable and the specs must be immutable once
 * declared. The immutability claim is scoped EXACTLY as W4 was forced to scope
 * it after an independent review: no UPDATE or DELETE path can rewrite a spec.
 * `INSERT OR REPLACE` is NOT blocked, because SQLite fires BEFORE DELETE for
 * REPLACE conflict resolution only under `PRAGMA recursive_triggers`, which is
 * OFF here. Both directions of that boundary are pinned below so the gap
 * cannot be quietly widened OR quietly overclaimed.
 */

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentOrgExperimentsRepository } from '../agent_org_experiments_repository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

function declareInput(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: 'prop-1',
    adapter: 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify({ version: 'proposal-evidence-v1' }),
    baselineSpecJson: JSON.stringify({ configRevision: 4 }),
    candidateSpecJson: JSON.stringify({ configRevision: 5 }),
    assignmentKey: 'exp-key-1',
    stoppingRule: { minSamplesPerCohort: 10, minEffect: 0.05 },
    maxExposure: 20,
    ...overrides,
  };
}

describe('W6-c3 experiment record', () => {
  it('stores all seven declared elements and reads them back', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const created = await repo.declareAsync(declareInput());

    const read = await repo.findByIdAsync(created.id);
    expect(read).not.toBeNull();
    expect(read!.baselineSpecJson).toBe(JSON.stringify({ configRevision: 4 }));
    expect(read!.candidateSpecJson).toBe(JSON.stringify({ configRevision: 5 }));
    expect(read!.assignmentKey).toBe('exp-key-1');
    expect(read!.stoppingRule).toEqual({ minSamplesPerCohort: 10, minEffect: 0.05 });
    expect(read!.maxExposure).toBe(20);
    // results and decision are the two elements that are NOT predeclared.
    expect(read!.results).toBeNull();
    expect(read!.decision).toBeNull();
  });

  it('refuses a declaration with no stopping rule or no maximum exposure', async () => {
    const repo = new AgentOrgExperimentsRepository();
    await expect(repo.declareAsync(declareInput({ stoppingRule: null }))).rejects.toThrow(
      /stopping rule/i,
    );
    await expect(repo.declareAsync(declareInput({ maxExposure: null }))).rejects.toThrow(
      /maximum exposure/i,
    );
  });

  it('requires results to carry per-cohort sample count and primary metric value', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const exp = await repo.declareAsync(declareInput());
    // An empty blob cannot satisfy `results`.
    await expect(repo.recordResultsAsync(exp.id, {} as never)).rejects.toThrow(/results/i);
    await expect(
      repo.recordResultsAsync(exp.id, {
        baseline: { sampleCount: 12 },
        candidate: { sampleCount: 11, primaryMetricValue: 0.7 },
      } as never),
    ).rejects.toThrow(/primaryMetricValue/i);

    const ok = await repo.recordResultsAsync(exp.id, {
      baseline: { sampleCount: 12, primaryMetricValue: 0.5 },
      candidate: { sampleCount: 11, primaryMetricValue: 0.7 },
    });
    expect(ok.results?.candidate.primaryMetricValue).toBe(0.7);
    expect(ok.resultsRecordedAt).not.toBeNull();
  });

  it('records the stopping rule and cap BEFORE any result, so a result cannot author its own rule', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const exp = await repo.declareAsync(declareInput());
    expect(exp.declaredAt).not.toBeNull();
    expect(exp.resultsRecordedAt).toBeNull();

    await repo.recordResultsAsync(exp.id, {
      baseline: { sampleCount: 12, primaryMetricValue: 0.5 },
      candidate: { sampleCount: 11, primaryMetricValue: 0.7 },
    });

    // Rewriting the stopping rule or the cap after the fact is refused by the
    // database, not merely by the repository.
    expect(() =>
      db
        .prepare(`UPDATE agent_org_experiments SET stopping_rule_json = ? WHERE id = ?`)
        .run(JSON.stringify({ minSamplesPerCohort: 1, minEffect: 0 }), exp.id),
    ).toThrow(/immutable/i);
    expect(() =>
      db.prepare(`UPDATE agent_org_experiments SET max_exposure = 999 WHERE id = ?`).run(exp.id),
    ).toThrow(/immutable/i);
  });
});

describe('P2-2 / P2-3 declaration guards', () => {
  it('refuses a declared adapter that contradicts the bundle it carries', async () => {
    const repo = new AgentOrgExperimentsRepository();
    await expect(
      repo.declareAsync(
        declareInput({
          adapter: 'llm-body-score',
          evidenceBundleJson: JSON.stringify({
            version: 'proposal-evidence-v1',
            experimentAdapter: 'paired-cohort-outcome',
          }),
        }),
      ),
    ).rejects.toThrow(/adapter/i);
  });

  it('refuses a SECOND undecided experiment on the same proposal', async () => {
    const repo = new AgentOrgExperimentsRepository();
    await repo.declareAsync(declareInput());
    // Two undecided experiments would read the SAME ledger cohort pool through
    // different stopping rules and both stamp outcome_status; last writer wins.
    await expect(repo.declareAsync(declareInput())).rejects.toThrow(/undecided experiment/i);
  });

  it('permits a NEW experiment once the previous one is decided', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const first = await repo.declareAsync(declareInput());
    await repo.recordResultsAsync(first.id, {
      baseline: { sampleCount: 12, primaryMetricValue: 0.5 },
      candidate: { sampleCount: 11, primaryMetricValue: 0.7 },
    });
    await repo.recordDecisionAsync(first.id, 'inconclusive', 'not enough signal');

    const second = await repo.declareAsync(declareInput());
    expect(second.id).not.toBe(first.id);
  });
});

describe('W6-c3 spec immutability, scoped honestly', () => {
  it('blocks every UPDATE of a baseline or candidate spec', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const exp = await repo.declareAsync(declareInput());
    expect(() =>
      db
        .prepare(`UPDATE agent_org_experiments SET baseline_spec_json = ? WHERE id = ?`)
        .run('{"configRevision":99}', exp.id),
    ).toThrow(/immutable/i);
    expect(() =>
      db
        .prepare(`UPDATE agent_org_experiments SET candidate_spec_json = ? WHERE id = ?`)
        .run('{"configRevision":99}', exp.id),
    ).toThrow(/immutable/i);
    expect(() =>
      db
        .prepare(`UPDATE agent_org_experiments SET assignment_key = 'other' WHERE id = ?`)
        .run(exp.id),
    ).toThrow(/immutable/i);
  });

  it('blocks DELETE outright', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const exp = await repo.declareAsync(declareInput());
    expect(() =>
      db.prepare(`DELETE FROM agent_org_experiments WHERE id = ?`).run(exp.id),
    ).toThrow(/immutable/i);
  });

  it('still permits the results and decision writes — immutability is of the SPEC', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const exp = await repo.declareAsync(declareInput());
    await repo.recordResultsAsync(exp.id, {
      baseline: { sampleCount: 12, primaryMetricValue: 0.5 },
      candidate: { sampleCount: 11, primaryMetricValue: 0.7 },
    });
    const decided = await repo.recordDecisionAsync(exp.id, 'promote', 'candidate beat baseline');
    expect(decided.decision).toBe('promote');
    expect(decided.decidedAt).not.toBeNull();
  });

  it('pins the REPLACE boundary in BOTH directions rather than overclaiming', async () => {
    const repo = new AgentOrgExperimentsRepository();
    const exp = await repo.declareAsync(declareInput());
    // Same id and same proposal, so the partial unique index is untouched.


    // Direction 1 — the pragma this claim depends on really is OFF.
    expect(db.pragma('recursive_triggers', { simple: true })).toBe(0);

    // Direction 2 — with it OFF, INSERT OR REPLACE is NOT blocked. That is the
    // documented gap, and no repository method does this.
    expect(() =>
      db
        .prepare(
          `INSERT OR REPLACE INTO agent_org_experiments
             (id, proposal_id, adapter, evidence_bundle_json, baseline_spec_json,
              candidate_spec_json, assignment_key, stopping_rule_json, max_exposure, declared_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          exp.id,
          'prop-1',
          'paired-cohort-outcome',
          '{}',
          '{"rewritten":true}',
          '{}',
          'k',
          '{}',
          1,
          new Date().toISOString(),
        ),
    ).not.toThrow();
  });
});
