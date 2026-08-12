import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyApprovedSessionBindingCleanup,
  buildSessionBindingCleanupReport,
  parseSessionBindingCleanupArgs,
} from './session_binding_cleanup';

function fixtureDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      sdk_session_id TEXT,
      name TEXT NOT NULL,
      project_id TEXT,
      profile_id TEXT,
      agent_kind TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'default',
      thinking_budget INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_configs (
      id TEXT PRIMARY KEY,
      oc_agent TEXT
    );
    INSERT INTO agent_configs (id, oc_agent) VALUES ('secretary', 'secretary');
  `);
  const insert = db.prepare(`
    INSERT INTO agent_sessions
      (id, sdk_session_id, name, project_id, profile_id, agent_kind,
       provider_id, model_id, permission_mode, thinking_budget,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    'candidate-review',
    'sdk-review',
    'Needs review',
    'project-a',
    'Theological-Researcher',
    'Theological-Researcher',
    'openai',
    'gpt-5.6-sol',
    'default',
    null,
    '2026-07-30T12:00:00.000Z',
    '2026-07-30T12:01:00.000Z',
  );
  insert.run(
    'candidate-legitimate',
    'sdk-legitimate',
    'Intentional theological research',
    'project-a',
    'Theological-Researcher',
    'Theological-Researcher',
    'openai',
    'gpt-5.6-sol',
    'plan',
    8192,
    '2026-07-29T12:00:00.000Z',
    '2026-07-29T12:01:00.000Z',
  );
  insert.run(
    'not-candidate',
    'sdk-secretary',
    'Secretary chat',
    'project-a',
    'secretary',
    'secretary',
    'anthropic',
    'claude-sonnet-4-5',
    'default',
    null,
    '2026-07-28T12:00:00.000Z',
    '2026-07-28T12:01:00.000Z',
  );
  return db;
}

describe('issue #1363 reviewed mobile session binding cleanup', () => {
  const databases: Database.Database[] = [];
  afterEach(() => {
    databases.splice(0).forEach((db) => db.close());
  });

  it('dry-run reports candidates and proposals without mutating any binding', () => {
    const db = fixtureDb();
    databases.push(db);
    const report = buildSessionBindingCleanupReport(
      db,
      '2026-08-10T12:00:00.000Z',
    );

    expect(report.mode).toBe('dry-run');
    expect(report.candidates.map(({ sessionId }) => sessionId)).toEqual([
      'candidate-legitimate',
      'candidate-review',
    ]);
    expect(report.candidates[0]).toMatchObject({
      proposed: {
        profileId: null,
        agentKind: 'Theological-Researcher',
      },
      reviewDecision: 'pending',
    });
    expect(
      db.prepare('SELECT profile_id FROM agent_sessions WHERE id = ?')
        .get('candidate-review'),
    ).toEqual({ profile_id: 'Theological-Researcher' });
  });

  it('apply changes only explicitly approved, unchanged candidates and records an audit', () => {
    const db = fixtureDb();
    databases.push(db);
    const report = buildSessionBindingCleanupReport(
      db,
      '2026-08-10T12:00:00.000Z',
    );
    report.candidates = report.candidates.map((candidate) => ({
      ...candidate,
      reviewDecision:
        candidate.sessionId === 'candidate-review'
          ? 'approve'
          : 'preserve',
      proposed:
        candidate.sessionId === 'candidate-review'
          ? {
              profileId: 'secretary',
              agentKind: 'secretary',
              note: 'Reviewed against the desktop chat and approved.',
            }
          : candidate.proposed,
    }));

    const audit = applyApprovedSessionBindingCleanup(
      db,
      report,
      '2026-08-10T12:05:00.000Z',
    );

    expect(audit).toMatchObject({
      mode: 'apply',
      reportId: report.reportId,
      appliedSessionIds: ['candidate-review'],
      preservedSessionIds: ['candidate-legitimate'],
    });
    expect(
      db.prepare('SELECT profile_id, agent_kind FROM agent_sessions WHERE id = ?')
        .get('candidate-review'),
    ).toEqual({ profile_id: 'secretary', agent_kind: 'secretary' });
    expect(
      db.prepare('SELECT profile_id FROM agent_sessions WHERE id = ?')
        .get('candidate-legitimate'),
    ).toEqual({ profile_id: 'Theological-Researcher' });
  });

  it('apply CLI mode is impossible without both reviewed input and audit output', () => {
    expect(parseSessionBindingCleanupArgs([])).toMatchObject({
      apply: false,
    });
    expect(() => parseSessionBindingCleanupArgs(['--apply'])).toThrow(
      /--approval-file.*--audit-output/,
    );
  });
});
