import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentPromptInjectionsRepository } from '../repositories/agent_prompt_injections_repository';

describe('#1577 legacy prompt-injection outcomes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
  });

  it('refuses contradictory outcomes for legacy terminal rows without hiding their original outcome', () => {
    const acceptedId = Number(db.prepare(
      `INSERT INTO agent_prompt_injections
         (target_session_id, source, prompt, accepted, error)
       VALUES ('legacy-session', 'http', 'legacy accepted', 1, NULL)`,
    ).run().lastInsertRowid);
    const rejectedId = Number(db.prepare(
      `INSERT INTO agent_prompt_injections
         (target_session_id, source, prompt, accepted, error)
       VALUES ('legacy-session', 'http', 'legacy rejected', 0, 'engine refused')`,
    ).run().lastInsertRowid);
    const repository = new AgentPromptInjectionsRepository(db);

    expect(repository.settle(acceptedId, false, 'contradictory rejection')).toEqual({
      status: 'conflict',
      reason: 'legacy_terminal_outcome',
    });
    expect(repository.settle(rejectedId, true)).toEqual({
      status: 'conflict',
      reason: 'legacy_terminal_outcome',
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM agent_prompt_injection_outcomes').get(),
    ).toEqual({ count: 0 });
    expect(repository.listForSession('legacy-session')).toMatchObject([
      { id: rejectedId, accepted: false, error: 'engine refused' },
      { id: acceptedId, accepted: true, error: null },
    ]);
  });
});
