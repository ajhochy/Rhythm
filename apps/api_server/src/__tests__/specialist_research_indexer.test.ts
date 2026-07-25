import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { indexResearchSession } from '../services/specialist_research_indexer';

describe('specialist research session indexer', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
  });

  function session(id: string, profile: string, status = 'idle') {
    db.prepare(`INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, created_at, updated_at)
      VALUES (?, ?, ?, '.', ?, ?, ?)`)
      .run(id, profile, status, `${profile} report`, '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
  }

  function output(id: string, text: string, parts: unknown[]) {
    db.prepare(`INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
      VALUES (?, 'output', ?, ?, ?, ?)`)
      .run(id, text, text, `${id}-message`, JSON.stringify(parts));
  }

  it('indexes scheduled, interactive, and delegated specialist sessions idempotently from persisted parts', async () => {
    session('scheduled', 'AI-Trend-Researcher');
    session('interactive', 'Theological-Researcher');
    session('child', 'AI-Trend-Researcher');
    output('scheduled', 'Trend report', [{ type: 'tool', input: { url: 'https://example.com/a' } }, { type: 'text', text: 'Trend report' }]);
    output('interactive', 'Theology report', [{ type: 'tool', output: { path: 'Areas/Research/Theology/report.md', url: 'https://example.com/b' } }]);
    output('child', 'Delegated report', [{ type: 'text', text: 'Delegated report' }]);

    await indexResearchSession('scheduled');
    await indexResearchSession('interactive');
    await indexResearchSession('child');
    await indexResearchSession('interactive'); // idle replay

    const rows = db.prepare(`SELECT agent_session_id, research_type, origin, sources_json, vault_path FROM agent_research_jobs ORDER BY agent_session_id`).all();
    expect(rows).toEqual([
      expect.objectContaining({ agent_session_id: 'child', research_type: 'ai-trends', origin: 'specialist-run' }),
      expect.objectContaining({ agent_session_id: 'interactive', research_type: 'theological', origin: 'specialist-run', vault_path: 'Areas/Research/Theology/report.md' }),
      expect.objectContaining({ agent_session_id: 'scheduled', research_type: 'ai-trends', origin: 'specialist-run', sources_json: '["https://example.com/a"]' }),
    ]);
  });

  it('ignores unrelated profiles and records specialist errors without retry provenance', async () => {
    session('other', 'research');
    session('failed', 'Theological-Researcher', 'error');
    db.prepare(`UPDATE agent_sessions SET status_message = 'upstream failed' WHERE id = 'failed'`).run();
    await indexResearchSession('other');
    await indexResearchSession('failed');
    expect(db.prepare(`SELECT status, origin, research_type, error FROM agent_research_jobs`).all()).toEqual([
      { status: 'error', origin: 'specialist-run', research_type: 'theological', error: 'upstream failed' },
    ]);
  });
});
