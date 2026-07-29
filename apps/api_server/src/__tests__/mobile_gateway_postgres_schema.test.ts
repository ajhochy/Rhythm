import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { runPostgresBootstrap } from '../database/postgres_bootstrap';

describe('mobile gateway Postgres schema parity', () => {
  it('adds both verifier-only pairing tables with idempotent CREATE statements', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });

    await runPostgresBootstrap({ query } as unknown as Pool);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mobile_pairing_codes/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mobile_devices/i);
    expect(sql).toMatch(/code_verifier TEXT NOT NULL/i);
    expect(sql).toMatch(/token_verifier TEXT NOT NULL/i);
  });

  it('keeps project_id as a logical reference because projects is SQLite-only', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });

    await runPostgresBootstrap({ query } as unknown as Pool);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toMatch(
      /ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS project_id TEXT;/i,
    );
    expect(sql).not.toMatch(
      /ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS project_id[^;]*REFERENCES projects/i,
    );
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS projects\s*\(/i);
  });
});
