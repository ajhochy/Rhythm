import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({
  env: {
    agentExecutionEnabled: false,
  },
}));

import { runPostgresBootstrap } from '../database/postgres_bootstrap';

describe('phase 6 sharing Postgres bootstrap', () => {
  it('installs production share tables and guards with agent execution disabled', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

    await runPostgresBootstrap({ query } as unknown as Pool);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS shared_transcripts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS share_audit_log');
    expect(sql).toContain('shared_transcripts_snapshot_immutable');
    expect(sql).toContain('share_audit_log_no_delete');
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS agent_memory_changes');
  });
});
