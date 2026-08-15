/**
 * Postgres parity for AgentOrgProposalsRepository — #1113 sibling.
 *
 * docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §5 originally
 * decided `agent_org_proposals` was local-SQLite-only, never synced to
 * Postgres, matching agent_skills/agent_scheduled_tasks/agent_webhook_
 * endpoints. That assumption predates #1111/#1113: the org-optimizer's own
 * seed (org_optimizer_seed.ts) now runs on a Postgres-backed deployment,
 * gated on the deployment ROLE (env.agentExecutionEnabled), not the DB
 * engine — so the optimizer (and every proposal it writes) now genuinely
 * runs against Postgres-backed prod. Without this fix, every proposal
 * silently vanished per-instance via the exact same throwaway `:memory:`
 * fallback #1113 fixed for agent_capability_gaps (getDb() unconditionally
 * throws under Postgres — no local `_db` — so the constructor fell back to
 * an in-memory SQLite DB every time).
 *
 * This mocks the Postgres pool to prove ROUTING (the postgres path is used,
 * local SQLite/getDb never touched) and basic SQL/row-mapping shape — the
 * full real-engine behavior (create -> read -> persist across a server
 * restart) is proven separately against a live disposable Postgres
 * container (see the run log for that evidence).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPoolQuery = vi.fn();
const mockGetDb = vi.fn(() => {
  throw new Error('getDb should never be called when env.dbClient is postgres');
});

vi.mock('../database/db', () => ({
  getDb: mockGetDb,
  getPostgresPool: () => ({ query: mockPoolQuery }),
}));

function pgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    audit_run_id: null,
    kind: 'external-adoption',
    risk: 'high',
    external: 1,
    status: 'proposed',
    title: 'Adopt MCP server: test-weather-mcp',
    rationale: null,
    signal_ref: 'gapId:dedup-abc',
    target_ref: 'mcp:test-weather-mcp',
    change_json: null,
    before_snapshot_json: null,
    provenance_json: null,
    dedup_key: 'external-adoption:mcp:test-weather-mcp',
    baseline_score: null,
    post_score: null,
    measure_reason: null,
    decided_by_user_id: null,
    revision: 0,
    created_at: new Date('2026-07-16T00:00:00.000Z'),
    updated_at: new Date('2026-07-16T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AgentOrgProposalsRepository Postgres branch (#1113 sibling)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockGetDb.mockClear();
    process.env.DB_CLIENT = 'postgres';
  });

  afterEach(() => {
    delete process.env.DB_CLIENT;
  });

  it('createAsync inserts via the Postgres pool and never touches local SQLite', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // pre-check findByDedupKeyAny -> no existing row
      .mockResolvedValueOnce({ rows: [pgRow()] }); // ON CONFLICT DO NOTHING RETURNING *

    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const result = await repo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      external: 1,
      title: 'Adopt MCP server: test-weather-mcp',
      dedupKey: 'external-adoption:mcp:test-weather-mcp',
    });

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(/INSERT INTO agent_org_proposals/i);
    expect(result.id).toBe('p-1');
    expect(result.createdAt).toBe('2026-07-16T00:00:00.000Z'); // Date -> ISO string, not a raw Date
  });

  it('createAsync falls back to a re-select when dedup_key already exists (ON CONFLICT DO NOTHING)', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // pre-check findByDedupKeyAny -> not found
      .mockResolvedValueOnce({ rows: [] }) // conflict: INSERT returns no row
      .mockResolvedValueOnce({ rows: [pgRow()] }); // re-select the existing row

    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const result = await repo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      title: 'Adopt MCP server: test-weather-mcp',
      dedupKey: 'external-adoption:mcp:test-weather-mcp',
    });

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(result.id).toBe('p-1');
  });

  it('createAsync returns the existing row unchanged when dedup_key already exists BEFORE inserting', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow()] }); // pre-check finds it

    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const result = await repo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      title: 'A different title — must be ignored',
      dedupKey: 'external-adoption:mcp:test-weather-mcp',
    });

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery).toHaveBeenCalledTimes(1); // only the pre-check — no INSERT attempted
    expect(result.title).toBe('Adopt MCP server: test-weather-mcp'); // unchanged, not the new input
  });

  it('findByIdAsync reads a single row via the Postgres pool', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow()] });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const found = await repo.findByIdAsync('p-1');
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/SELECT \* FROM agent_org_proposals WHERE id/i);
    expect(found?.id).toBe('p-1');
    expect(found?.external).toBe(1);
  });

  it('listProposedAsync reads rows via the Postgres pool', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow(), pgRow({ id: 'p-2' })] });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const rows = await repo.listProposedAsync();
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/SELECT \* FROM agent_org_proposals WHERE status/i);
    expect(rows).toHaveLength(2);
  });

  it('existsByDedupKeyAsync checks the Postgres pool', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const exists = await repo.existsByDedupKeyAsync('external-adoption:mcp:test-weather-mcp');
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(exists).toBe(true);
  });

  it('listAttemptsForBaseAsync reads rows via the Postgres pool', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [pgRow({ dedup_key: 'workflow-fix:x:a1' }), pgRow({ id: 'p-2', dedup_key: 'workflow-fix:x:a2' })],
    });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const attempts = await repo.listAttemptsForBaseAsync('workflow-fix:x');
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/dedup_key LIKE/i);
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2]);
  });

  it('updateStatusAsync performs source-status CAS with RETURNING and returns that row directly', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [pgRow()] }) // findByIdAsync (existing check)
      .mockResolvedValueOnce({ rows: [pgRow({ status: 'approved', revision: 1 })] }); // UPDATE RETURNING

    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const updated = await repo.updateStatusAsync('p-1', 'approved');

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(
      /UPDATE agent_org_proposals\s+SET[\s\S]*revision = revision \+ 1[\s\S]*WHERE id = \$\d+[\s\S]*status = \$\d+[\s\S]*revision = \$\d+[\s\S]*RETURNING \*/i,
    );
    expect(mockPoolQuery.mock.calls[1][1]).toEqual([
      'approved',
      expect.any(String),
      'p-1',
      'proposed',
      0,
    ]);
    expect(updated?.status).toBe('approved');
    expect(updated?.revision).toBe(1);
  });

  it('maps proposal revisions on PostgreSQL reads', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow({ revision: 17 })] });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    expect((await repo.findByIdAsync('p-1'))?.revision).toBe(17);
  });

  it('claimScopeApprovedWithSnapshotAsync binds revision/kind/change in placeholder order', async () => {
    const changeJson = ' { "agentConfigId": "config-1" } ';
    const snapshot = '{"version":"scope-state-v2"}';
    mockPoolQuery.mockResolvedValueOnce({
      rows: [pgRow({
        kind: 'broaden-scope',
        change_json: changeJson,
        status: 'approved',
        before_snapshot_json: snapshot,
        decided_by_user_id: 42,
        revision: 1,
      })],
    });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const claimed = await repo.claimScopeApprovedWithSnapshotAsync({
      id: 'p-1',
      decidedByUserId: 42,
      expectedRevision: 0,
      expectedKind: 'broaden-scope',
      expectedChangeJson: changeJson,
      beforeSnapshotJson: snapshot,
      validateSnapshot: () => true,
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(
      /SET status = 'approved'[\s\S]*revision = revision \+ 1[\s\S]*WHERE id = \$4[\s\S]*status IN \('proposed', 'failed'\)[\s\S]*revision = \$5[\s\S]*kind = \$6[\s\S]*change_json = \$7[\s\S]*RETURNING \*/i,
    );
    expect(mockPoolQuery.mock.calls[0][1]).toEqual([
      42,
      snapshot,
      expect.any(String),
      'p-1',
      0,
      'broaden-scope',
      changeJson,
    ]);
    expect(claimed).toMatchObject({ status: 'approved', revision: 1 });
  });

  it('claimScopeApprovedWithSnapshotAsync returns null on a zero-row stale claim', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    const claimed = await repo.claimScopeApprovedWithSnapshotAsync({
      id: 'p-1',
      decidedByUserId: 42,
      expectedRevision: 9,
      expectedKind: 'broaden-scope',
      expectedChangeJson: '{}',
      beforeSnapshotJson: '{}',
      validateSnapshot: () => true,
    });
    expect(claimed).toBeNull();
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a zero-row source-status conflict from a missing id', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [pgRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pgRow({ status: 'rejected' })] });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    await expect(repo.updateStatusAsync('p-1', 'approved')).rejects.toThrow(/concurrent|conflict/i);
    expect(mockPoolQuery).toHaveBeenCalledTimes(3);
  });

  it('updateStatusAsync throws on an illegal transition without ever calling UPDATE', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow({ status: 'rejected' })] }); // terminal status

    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();
    await expect(repo.updateStatusAsync('p-1', 'applied')).rejects.toThrow(/Illegal/);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1); // only the findByIdAsync read
  });

  it('claimAppliedWithSnapshotAsync pre-reads then binds source revision and kind', async () => {
    const snapshot = JSON.stringify({ version: 'scope-delta-v2', requestedRemove: ['x'] });
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [pgRow()] })
      .mockResolvedValueOnce({
        rows: [pgRow({
          status: 'applied',
          before_snapshot_json: snapshot,
          decided_by_user_id: 42,
          revision: 1,
        })],
      });
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    const claimed = await repo.claimAppliedWithSnapshotAsync('p-1', 42, snapshot, '{"normalized":true}');

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(
      /UPDATE agent_org_proposals[\s\S]*revision = revision \+ 1[\s\S]*status IN \('proposed', 'failed'\)[\s\S]*revision = \$6[\s\S]*kind = \$7[\s\S]*RETURNING \*/i,
    );
    expect(mockPoolQuery.mock.calls[1][1]).toEqual([
      42,
      snapshot,
      '{"normalized":true}',
      expect.any(String),
      'p-1',
      0,
      'external-adoption',
    ]);
    expect(claimed).toMatchObject({ status: 'applied', beforeSnapshotJson: snapshot, decidedByUserId: 42 });
  });

  it('claimAppliedWithSnapshotAsync rejects a null actor before issuing SQL', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    await expect((repo.claimAppliedWithSnapshotAsync as any)('p-1', null, '{}')).rejects.toThrow(/actor|user/i);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('refuses split-store atomic scope transitions before issuing PostgreSQL or SQLite writes', async () => {
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const repo = new AgentOrgProposalsRepository();

    await expect(repo.transitionScopeAtomicallyAsync({
      proposalId: 'p-1',
      expectedProposalStatus: 'active',
      nextProposalStatus: 'reverted',
      expectedKind: 'broaden-scope',
      expectedChangeJson: '{"agentConfigId":"config-1"}',
      expectedBeforeSnapshotJson: '{"version":"scope-state-v2"}',
      targetId: 'config-1',
      field: 'allowedSkillsJson',
      expectedTargetValue: '["x"]',
      nextTargetValue: null,
      nextBaselineScore: null,
      nextPostScore: null,
      nextMeasureReason: null,
    })).rejects.toThrow(/unavailable.*PostgreSQL|PostgreSQL.*split-store/i);
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});
