/**
 * CONTRACT TEST for issue #817 (org-optimizer-01) — must fail before
 * implementation, then pass once agent_org_proposals table/model/repository
 * exist. See docs/ai/contracts/issue-817.json for the criterion mapping.
 *
 * Covers:
 *  - issue-817-c1: agent_org_proposals table + all specified columns in SQLite.
 *  - issue-817-c2: idx_org_proposals_status + UNIQUE idx_org_proposals_dedup.
 *  - issue-817-c3: table absent from postgres_bootstrap.ts.
 *  - issue-817-c4: AgentOrgProposal TS interface + fromJson/toJson round-trip.
 *  - issue-817-c5: repository createAsync/findByIdAsync/listByStatusAsync/
 *    listProposedAsync/existsByDedupKeyAsync/updateStatusAsync.
 *  - issue-817-c6: legal + illegal status transitions enforced.
 *  - issue-817-c7: duplicate dedup_key insert is a no-op/skip, not a crash.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function sqliteColumns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[])
    .map((c) => c.name)
    .sort();
}

describe('issue-817-c1: agent_org_proposals table exists in SQLite with the specified columns', () => {
  it('has every column from the decision-doc DDL', () => {
    // Bug this catches: migrations.ts never gains the agent_org_proposals
    // CREATE TABLE block, so table_info() returns an empty column set (or
    // throws) instead of the full 20-column set below.
    const db = makeDb();
    const cols = sqliteColumns(db, 'agent_org_proposals');
    const expected = [
      'id',
      'audit_run_id',
      'kind',
      'risk',
      'external',
      'status',
      'title',
      'rationale',
      'signal_ref',
      'target_ref',
      'change_json',
      'before_snapshot_json',
      'provenance_json',
      'dedup_key',
      'baseline_score',
      'post_score',
      'measure_reason',
      'decided_by_user_id',
      'revision',
      'reconciliation_reason',
      'owner_user_id',
      'diagnosis_confidence',
      'diagnosis_confidence_version',
      // W6-c8 — additive outcome authority, distinct from `status`.
      'outcome_status',
      'created_at',
      'updated_at',
    ].sort();
    expect(cols).toEqual(expected);
    db.close();
  });
});

describe('issue-817-c2: required indexes exist (status + unique dedup)', () => {
  it('creates idx_org_proposals_status on status', () => {
    // Bug this catches: the status index is omitted, so listByStatusAsync
    // queries silently degrade to full table scans undetected until scale.
    const db = makeDb();
    const indexes = db
      .prepare(`PRAGMA index_list(agent_org_proposals)`)
      .all() as { name: string; unique: number }[];
    const statusIndex = indexes.find((i) => i.name === 'idx_org_proposals_status');
    expect(statusIndex).toBeDefined();
    db.close();
  });

  it('creates a UNIQUE index idx_org_proposals_dedup on dedup_key', () => {
    // Bug this catches: dedup_key has no UNIQUE constraint, so duplicate
    // proposals silently double-insert instead of being rejected/skipped.
    const db = makeDb();
    const indexes = db
      .prepare(`PRAGMA index_list(agent_org_proposals)`)
      .all() as { name: string; unique: number }[];
    const dedupIndex = indexes.find((i) => i.name === 'idx_org_proposals_dedup');
    expect(dedupIndex).toBeDefined();
    expect(dedupIndex?.unique).toBe(1);
    db.close();
  });
});

describe('issue-817-c3 (superseded by the proposals-parity fix, #1113 sibling): agent_org_proposals IS now in postgres_bootstrap.ts', () => {
  it('postgres_bootstrap.ts creates the agent_org_proposals table', () => {
    // #817's original call was "local-only, never synced to prod" (see
    // docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §5). That
    // predates #1111/#1113, which made the org-optimizer's own seed run
    // against a Postgres-backed deployment (role-gated, not engine-gated) —
    // so proposals now genuinely get written there too, and a proposal store
    // that silently discards every row under Postgres (the exact #1113 bug
    // class: getDb() throws -> falls back to a throwaway in-memory SQLite DB)
    // defeats the review queue entirely. Bug THIS test catches: the table
    // definition drifting out of postgres_bootstrap.ts again.
    const pgSource = readFileSync(
      join(__dirname, '..', 'database', 'postgres_bootstrap.ts'),
      'utf8',
    );
    expect(pgSource).toMatch(/CREATE TABLE IF NOT EXISTS agent_org_proposals/);
  });
});

describe('issue-817-c4: AgentOrgProposal model has fromJson/toJson matching all columns', () => {
  it('fromJson/toJson round-trips every column-backed field', async () => {
    // Bug this catches: the model interface or its (de)serializer drops a
    // field (e.g. before_snapshot_json), silently losing data on round-trip.
    const mod = await import('../models/agent_org_proposal');
    expect(typeof mod.agentOrgProposalFromJson).toBe('function');
    expect(typeof mod.agentOrgProposalToJson).toBe('function');

    const sample = {
      id: 'p1',
      auditRunId: 'run-1',
      kind: 'tighten-scope',
      risk: 'low' as const,
      external: 0,
      status: 'proposed' as const,
      title: 'Tighten over-broad scope',
      rationale: 'Never invoked in trailing window',
      signalRef: '{"count":3}',
      targetRef: 'agent_config:secretary',
      changeJson: '{"remove":["nfl_mcp"]}',
      beforeSnapshotJson: '{"allowed":["nfl_mcp","rhythm"]}',
      provenanceJson: null,
      dedupKey: 'tighten-scope:secretary:nfl_mcp',
      baselineScore: null,
      postScore: null,
      measureReason: null,
      reconciliationReason: null,
      decidedByUserId: null,
      ownerUserId: null,
      diagnosisConfidence: null,
      diagnosisConfidenceVersion: null,
      outcomeStatus: 'unproven' as const,
      revision: 0,
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    };

    const json = mod.agentOrgProposalToJson(sample);
    const restored = mod.agentOrgProposalFromJson(json);
    expect(restored).toEqual(sample);
  });
});

describe('issue-817-c5: repository CRUD + status listing', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('createAsync -> findByIdAsync round-trip', async () => {
    // Bug this catches: createAsync doesn't persist all fields, or
    // findByIdAsync fails to map a row back to the model.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    const created = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'Tighten scope for secretary',
      dedupKey: 'tighten-scope:secretary:nfl_mcp',
    });

    expect(created.id).toBeTruthy();
    expect(created.status).toBe('proposed');

    const found = await repo.findByIdAsync(created.id);
    expect(found).not.toBeNull();
    expect(found?.title).toBe('Tighten scope for secretary');
    expect(found?.kind).toBe('tighten-scope');
    expect(found?.risk).toBe('low');
  });

  it('listByStatusAsync returns only rows in the given status', async () => {
    // Bug this catches: the status filter is missing or wrong, so callers
    // building the review queue would see proposals from every lifecycle
    // stage mixed together.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'A',
      dedupKey: 'dedup-a',
    });
    const b = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'B',
      dedupKey: 'dedup-b',
    });
    await repo.updateStatusAsync(b.id, 'approved');

    const proposed = await repo.listByStatusAsync('proposed');
    const approved = await repo.listByStatusAsync('approved');

    expect(proposed.map((p) => p.title)).toEqual(['A']);
    expect(approved.map((p) => p.title)).toEqual(['B']);
  });

  it('listProposedAsync returns only status=proposed rows', async () => {
    // Bug this catches: listProposedAsync is a naive "return everything"
    // stub instead of filtering to the review-queue-relevant status.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    const a = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'A',
      dedupKey: 'dedup-a2',
    });
    await repo.updateStatusAsync(a.id, 'approved');
    await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'B',
      dedupKey: 'dedup-b2',
    });

    const proposed = await repo.listProposedAsync();
    expect(proposed.map((p) => p.title)).toEqual(['B']);
  });

  it('existsByDedupKeyAsync reports true only for a seen key', async () => {
    // Bug this catches: the dedup lookup always returns false (or true),
    // defeating the idempotency guard generators rely on.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    expect(await repo.existsByDedupKeyAsync('never-seen')).toBe(false);

    await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'A',
      dedupKey: 'seen-key',
    });

    expect(await repo.existsByDedupKeyAsync('seen-key')).toBe(true);
  });

  it('claimScopeApprovedWithSnapshotAsync is a revision-bound, one-winner SQLite claim', async () => {
    // W1 package C: a scope proposal is claimed `approved` — never `applied` —
    // so the loser sees a plain conflict with the target still untouched.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const exactChangeJson = ' { "agentConfigId": "config-1", "remove": ["x"] } ';
    const proposal = await repo.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'Atomic claim',
      changeJson: exactChangeJson,
      dedupKey: 'w1:atomic-claim',
    });

    const snapshot = JSON.stringify({ version: 'scope-delta-v2', requestedRemove: ['x'] });
    const claim = (actor: number) => repo.claimScopeApprovedWithSnapshotAsync({
      id: proposal.id,
      decidedByUserId: actor,
      expectedRevision: proposal.revision,
      expectedKind: 'prune-scope',
      expectedChangeJson: exactChangeJson,
      beforeSnapshotJson: snapshot,
      validateSnapshot: () => true,
    });
    const [first, second] = await Promise.all([claim(7), claim(8)]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((row) => row === null)).toHaveLength(1);
    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored).toMatchObject({
      status: 'approved',
      beforeSnapshotJson: snapshot,
      changeJson: exactChangeJson,
    });
    expect([7, 8]).toContain(stored?.decidedByUserId);
  });

  it('claimAppliedWithSnapshotAsync remains a one-winner claim for non-scope kinds', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const exactChangeJson = ' { "configPatch": { "agentConfigId": "config-1", "field": "modelId", "value": "m" } } ';
    const proposal = await repo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'Non-scope atomic claim',
      changeJson: exactChangeJson,
      dedupKey: 'w1:atomic-claim-non-scope',
    });

    const snapshot = JSON.stringify({ agentConfigId: 'config-1', field: 'modelId', priorValue: null });
    const [first, second] = await Promise.all([
      repo.claimAppliedWithSnapshotAsync(proposal.id, 7, snapshot, exactChangeJson),
      repo.claimAppliedWithSnapshotAsync(proposal.id, 8, snapshot, exactChangeJson),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((row) => row === null)).toHaveLength(1);
    expect(await repo.findByIdAsync(proposal.id)).toMatchObject({
      status: 'applied',
      beforeSnapshotJson: snapshot,
      changeJson: exactChangeJson,
    });
  });
});

describe('issue-817-c6: status transitions are enforced (legal allowed, illegal rejected)', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('allows proposed -> approved', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'A',
      dedupKey: 'k-approve',
    });
    const updated = await repo.updateStatusAsync(p.id, 'approved');
    expect(updated?.status).toBe('approved');
  });

  it('allows proposed -> rejected', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'A',
      dedupKey: 'k-reject',
    });
    const updated = await repo.updateStatusAsync(p.id, 'rejected');
    expect(updated?.status).toBe('rejected');
  });

  it('allows proposed -> applied (auto-apply lane, no approval step required)', async () => {
    // Bug this catches: the state machine wrongly requires 'approved' before
    // 'applied', which would break the full-autonomy-with-rollback auto path
    // the maintainer locked in on 2026-07-02.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'A',
      dedupKey: 'k-auto-apply',
    });
    const updated = await repo.updateStatusAsync(p.id, 'applied');
    expect(updated?.status).toBe('applied');
  });

  it('allows approved -> applied', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'A',
      dedupKey: 'k-approved-applied',
    });
    await repo.updateStatusAsync(p.id, 'approved');
    const updated = await repo.updateStatusAsync(p.id, 'applied');
    expect(updated?.status).toBe('applied');
  });

  it('allows applied -> measuring -> active', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'A',
      dedupKey: 'k-lifecycle-active',
    });
    await repo.updateStatusAsync(p.id, 'applied');
    await repo.updateStatusAsync(p.id, 'measuring');
    const updated = await repo.updateStatusAsync(p.id, 'active');
    expect(updated?.status).toBe('active');
  });

  it('allows applied -> measuring -> reverted', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'A',
      dedupKey: 'k-lifecycle-reverted',
    });
    await repo.updateStatusAsync(p.id, 'applied');
    await repo.updateStatusAsync(p.id, 'measuring');
    const updated = await repo.updateStatusAsync(p.id, 'reverted');
    expect(updated?.status).toBe('reverted');
  });

  it('uses the validated source status as a CAS so one stale measuring writer cannot overwrite the winner', async () => {
    // Regression caught: measuring -> active paused after its validation read,
    // measuring -> reverted committed, then the stale active write won by id.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const setup = new AgentOrgProposalsRepository();
    const p = await setup.createAsync({
      kind: 'refine-config',
      risk: 'high',
      title: 'Status CAS race',
      dedupKey: `status-cas-race:${crypto.randomUUID()}`,
    });
    await setup.updateStatusAsync(p.id, 'applied');
    await setup.updateStatusAsync(p.id, 'measuring');
    expect((await setup.findByIdAsync(p.id))?.status).toBe('measuring');

    const stale = new AgentOrgProposalsRepository();
    const originalFind = stale.findByIdAsync.bind(stale);
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = new Promise<void>((resolve) => { captured = resolve; });
    let firstRead = true;
    stale.findByIdAsync = async (id: string) => {
      const row = await originalFind(id);
      if (firstRead) {
        firstRead = false;
        captured();
        await gate;
      }
      return row;
    };

    const staleActive = stale.updateStatusAsync(p.id, 'active');
    await read;
    const winner = await setup.updateStatusAsync(p.id, 'reverted');
    release();

    expect(winner?.status).toBe('reverted');
    await expect(staleActive).rejects.toThrow(/concurrent|conflict/i);
    expect((await setup.findByIdAsync(p.id))?.status).toBe('reverted');
  });

  it('rejects proposed -> active (skipping the whole apply/measure lifecycle)', async () => {
    // Bug this catches: updateStatusAsync writes whatever status string it is
    // given with no validation, letting a proposal jump straight from
    // 'proposed' to 'active' and bypass measurement entirely.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'A',
      dedupKey: 'k-illegal-1',
    });
    await expect(repo.updateStatusAsync(p.id, 'active')).rejects.toThrow();
  });

  it('rejects rejected -> applied (terminal state cannot be revived)', async () => {
    // Bug this catches: 'rejected' is treated as just another status instead
    // of a terminal state, allowing a human-rejected proposal to later be
    // silently applied.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'A',
      dedupKey: 'k-illegal-2',
    });
    await repo.updateStatusAsync(p.id, 'rejected');
    await expect(repo.updateStatusAsync(p.id, 'applied')).rejects.toThrow();
  });

  it('rejects active -> approved (cannot move backward out of terminal-ish active)', async () => {
    // Bug this catches: no forward-only enforcement lets a fully-active,
    // already-measured proposal be pushed back into the human review queue.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'A',
      dedupKey: 'k-illegal-3',
    });
    await repo.updateStatusAsync(p.id, 'applied');
    await repo.updateStatusAsync(p.id, 'measuring');
    await repo.updateStatusAsync(p.id, 'active');
    await expect(repo.updateStatusAsync(p.id, 'approved')).rejects.toThrow();
  });
});

describe('issue-817-c7: duplicate dedup_key insert is a no-op/skip, not a crash', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('createAsync with an already-used dedup_key does not throw and does not double-insert', async () => {
    // Bug this catches: the UNIQUE index throws a raw SQLITE_CONSTRAINT error
    // straight out of createAsync instead of being caught and treated as a
    // no-op, which would crash every generator's insert-if-new call site.
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    const first = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'First',
      dedupKey: 'same-key',
    });

    await expect(
      repo.createAsync({
        kind: 'tighten-scope',
        risk: 'low',
        title: 'Second (should be skipped)',
        dedupKey: 'same-key',
      }),
    ).resolves.not.toThrow();

    const all = await repo.listByStatusAsync('proposed');
    const matching = all.filter((p) => p.dedupKey === 'same-key');
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(first.id);
    expect(matching[0].title).toBe('First');
  });
});
