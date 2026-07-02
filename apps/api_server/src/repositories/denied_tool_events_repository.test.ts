/**
 * Contract tests for issue #818 (org-optimizer-02) — denied_tool_events
 * repository aggregation.
 *
 * These MUST fail on the unmodified codebase: neither the `denied_tool_events`
 * table nor `DeniedToolEventsRepository` exist yet.
 *
 * Criteria covered:
 *   issue-818-c1 — denied_tool_events table (SQLite only) with at least: id,
 *                  session_id (nullable), agent_config_id (nullable),
 *                  tool_name, created_at. Aggregation is a query, not a stored
 *                  counter.
 *   issue-818-c4 — Repository exposes countByProfileAndToolAsync(sinceIso)
 *                  returning { agentConfigId, toolName, count }[].
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { DeniedToolEventsRepository } from './denied_tool_events_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('DeniedToolEventsRepository (issue-818 contract)', () => {
  let repo: DeniedToolEventsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new DeniedToolEventsRepository();
  });

  it('issue-818-c1: table exists with id/session_id/agent_config_id/tool_name/created_at columns, both nullable FK columns accepted', async () => {
    // Bug this catches: migration never added the table, or added it with the
    // wrong/missing nullable columns — insert would throw or the row would be
    // malformed.
    await repo.recordAsync({
      sessionId: 'sess-1',
      agentConfigId: null,
      toolName: 'rhythm_delete_task',
    });
    await repo.recordAsync({
      sessionId: null,
      agentConfigId: 'profile-1',
      toolName: 'bash',
    });

    const rows = await repo.listAllAsync();
    expect(rows).toHaveLength(2);

    const withSession = rows.find((r) => r.sessionId === 'sess-1');
    expect(withSession).toBeDefined();
    expect(withSession!.agentConfigId).toBeNull();
    expect(withSession!.toolName).toBe('rhythm_delete_task');
    expect(typeof withSession!.id).toBe('string');
    expect(typeof withSession!.createdAt).toBe('string');

    const withProfile = rows.find((r) => r.agentConfigId === 'profile-1');
    expect(withProfile).toBeDefined();
    expect(withProfile!.sessionId).toBeNull();
    expect(withProfile!.toolName).toBe('bash');
  });

  it('issue-818-c4: countByProfileAndToolAsync groups and counts within the window', async () => {
    // Bug this catches: aggregation query groups on the wrong columns (e.g.
    // collapses distinct tool names, or ignores the time window), producing
    // wrong counts for the org audit's broaden-scope signal.
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

    // Two denials of the same tool by the same profile — should count as 2.
    await repo.recordAsync({
      sessionId: 's1',
      agentConfigId: 'profile-A',
      toolName: 'rhythm_delete_task',
      createdAt: iso(-1000),
    });
    await repo.recordAsync({
      sessionId: 's2',
      agentConfigId: 'profile-A',
      toolName: 'rhythm_delete_task',
      createdAt: iso(-500),
    });
    // A different tool, same profile — separate group.
    await repo.recordAsync({
      sessionId: 's3',
      agentConfigId: 'profile-A',
      toolName: 'bash',
      createdAt: iso(-200),
    });
    // A different profile entirely — separate group.
    await repo.recordAsync({
      sessionId: 's4',
      agentConfigId: 'profile-B',
      toolName: 'rhythm_delete_task',
      createdAt: iso(-100),
    });
    // Outside the window (before `since`) — must be excluded.
    await repo.recordAsync({
      sessionId: 's5',
      agentConfigId: 'profile-A',
      toolName: 'rhythm_delete_task',
      createdAt: iso(-10_000),
    });

    const since = iso(-2000);
    const counts = await repo.countByProfileAndToolAsync(since);

    const profileATool = counts.find(
      (c) => c.agentConfigId === 'profile-A' && c.toolName === 'rhythm_delete_task',
    );
    expect(profileATool).toBeDefined();
    expect(profileATool!.count).toBe(2);

    const profileABash = counts.find(
      (c) => c.agentConfigId === 'profile-A' && c.toolName === 'bash',
    );
    expect(profileABash).toBeDefined();
    expect(profileABash!.count).toBe(1);

    const profileB = counts.find(
      (c) => c.agentConfigId === 'profile-B' && c.toolName === 'rhythm_delete_task',
    );
    expect(profileB).toBeDefined();
    expect(profileB!.count).toBe(1);

    // The out-of-window row must not have created a phantom 3rd count for
    // profile-A/rhythm_delete_task.
    expect(profileATool!.count).not.toBe(3);
  });

  it('issue-818-c4: rows with null agent_config_id are excluded from the profile aggregation (nothing to attribute)', async () => {
    // Bug this catches: aggregation groups null agentConfigId as its own
    // bucket and reports it to the org audit as a fake "profile", which is
    // meaningless — the audit only cares about real profile attribution.
    await repo.recordAsync({
      sessionId: 'sess-x',
      agentConfigId: null,
      toolName: 'rhythm_delete_task',
    });

    const counts = await repo.countByProfileAndToolAsync(
      new Date(Date.now() - 60_000).toISOString(),
    );
    expect(counts.find((c) => c.agentConfigId === null)).toBeUndefined();
  });
});
