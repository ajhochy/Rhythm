/**
 * #1113 (Discovery-005) — AgentCapabilityGapsRepository must use a real
 * Postgres backing under env.dbClient === 'postgres', never the throwaway
 * `:memory:` SQLite fallback (the bug: every gap silently vanished per
 * repository instance in prod). This mocks the Postgres pool to prove the
 * ROUTING (postgres path used, getDb/local-SQLite never touched) and basic
 * SQL/row-mapping shape. The full real-engine behavior (insert -> list ->
 * resolve durability) is proven separately against a live disposable
 * Postgres container (see the run log / PR description for that evidence) —
 * mocking pg's full SQL semantics here would just test the mock.
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
    id: 'gap-1',
    dedup_key: 'dedup-abc',
    intent_title: 'Summarize weekly attendance',
    intent_problem: null,
    intent_tags_json: null,
    sample_session_id: null,
    agent_config_id: null,
    status: 'open',
    created_at: new Date('2026-07-16T00:00:00.000Z'),
    updated_at: new Date('2026-07-16T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AgentCapabilityGapsRepository Postgres branch (#1113)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockGetDb.mockClear();
    process.env.DB_CLIENT = 'postgres';
  });

  afterEach(() => {
    delete process.env.DB_CLIENT;
  });

  it('insertIfAbsentAsync inserts via the Postgres pool and never touches local SQLite', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow()], rowCount: 1 });

    const { AgentCapabilityGapsRepository } = await import(
      '../repositories/agent_capability_gaps_repository'
    );
    const repo = new AgentCapabilityGapsRepository();
    const result = await repo.insertIfAbsentAsync({ intentTitle: 'Summarize weekly attendance' });

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/INSERT INTO agent_capability_gaps/i);
    expect(result.inserted).toBe(true);
    expect(result.gap.intentTitle).toBe('Summarize weekly attendance');
    expect(result.gap.createdAt).toBe('2026-07-16T00:00:00.000Z'); // Date -> ISO string, not a raw Date
  });

  it('insertIfAbsentAsync falls back to a re-select when the Postgres INSERT hits ON CONFLICT DO NOTHING', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // conflict: nothing inserted
      .mockResolvedValueOnce({ rows: [pgRow()] }); // re-select the existing row

    const { AgentCapabilityGapsRepository } = await import(
      '../repositories/agent_capability_gaps_repository'
    );
    const repo = new AgentCapabilityGapsRepository();
    const result = await repo.insertIfAbsentAsync({ intentTitle: 'Summarize weekly attendance' });

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(result.inserted).toBe(false);
    expect(result.gap.id).toBe('gap-1');
  });

  it('listOpenAsync reads open gaps from the Postgres pool', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow(), pgRow({ id: 'gap-2' })] });

    const { AgentCapabilityGapsRepository } = await import(
      '../repositories/agent_capability_gaps_repository'
    );
    const repo = new AgentCapabilityGapsRepository();
    const rows = await repo.listOpenAsync();

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/SELECT \* FROM agent_capability_gaps WHERE status/i);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'open')).toBe(true);
  });

  it('resolveByDedupKeyAsync updates status via the Postgres pool', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const { AgentCapabilityGapsRepository } = await import(
      '../repositories/agent_capability_gaps_repository'
    );
    const repo = new AgentCapabilityGapsRepository();
    await repo.resolveByDedupKeyAsync('dedup-abc');

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockPoolQuery.mock.calls[0][0]).toMatch(/UPDATE agent_capability_gaps SET status/i);
    expect(mockPoolQuery.mock.calls[0][1]).toContain('dedup-abc');
  });

  it('findByDedupKeyAsync reads a single row via the Postgres pool', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [pgRow()] });

    const { AgentCapabilityGapsRepository } = await import(
      '../repositories/agent_capability_gaps_repository'
    );
    const repo = new AgentCapabilityGapsRepository();
    const gap = await repo.findByDedupKeyAsync('dedup-abc');

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(gap).not.toBeNull();
    expect(gap!.dedupKey).toBe('dedup-abc');
  });
});
