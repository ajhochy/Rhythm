import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';

describe('rhythm setup creative install migration', () => {
  it('adds the disclosed-plan install/repair/uninstall runbook while retaining rhythm-only scope', () => {
    const db = new Database(':memory:'); runMigrations(db);
    const row = db.prepare(`SELECT system_prompt, allowed_mcps_json FROM agent_configs WHERE id = 'rhythm-setup'`).get() as { system_prompt: string; allowed_mcps_json: string };
    expect(row.system_prompt).toContain('exact planDigest');
    expect(row.system_prompt).toContain('operation repair or uninstall');
    expect(row.system_prompt).toContain('separate explicit acknowledgement');
    expect(row.allowed_mcps_json).toBe('["rhythm"]');
  });
});
