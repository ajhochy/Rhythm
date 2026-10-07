import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { PermissionMode } from '../models/agent_session';

describe('coordinator c4 native child permission mode', () => {
  let db: Database.Database;
  let repo: AgentSessionsRepository;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new AgentSessionsRepository();
  });
  afterEach(() => db.close());

  function parent(mode: PermissionMode, explicit = false) {
    const row = repo.insert({ agentKind: 'claude-code', taskId: null,
      cwd: '/private/tmp/coordinator-permission-fixture', name: 'root',
      permissionMode: mode, approvalBypassExplicit: explicit });
    repo.setSdkSessionId(row.id, 'sdk-root');
    return row;
  }

  it.each<PermissionMode>(['default', 'plan', 'acceptEdits', 'bypassPermissions'])(
    'inherits canonical %s through three native child levels without inventing own human consent', mode => {
      parent(mode, mode === 'bypassPermissions');
      let sdkParent = 'sdk-root';
      for (let depth = 1; depth <= 3; depth += 1) {
        const child = repo.upsertChildSession(`sdk-depth-${depth}`, sdkParent,
          'Inspect scope (@general subagent)', '/private/tmp/coordinator-permission-fixture');
        expect(child?.permissionMode).toBe(mode);
        expect(child?.approvalBypassExplicit).toBe(false);
        expect(child?.delegationDepth).toBe(depth);
        const stored = db.prepare('SELECT permission_mode,approval_bypass_explicit FROM agent_sessions WHERE id=?').get(child!.id);
        expect(stored).toEqual({ permission_mode: mode, approval_bypass_explicit: 0 });
        sdkParent = child!.sdkSessionId!;
      }
    },
  );

  it('preserves a child human override when the native creation event is replayed', () => {
    parent('plan');
    const child = repo.upsertChildSession('sdk-child', 'sdk-root', 'Inspect (@general subagent)', '/private/tmp/coordinator-permission-fixture')!;
    repo.updateFields(child.id, { permissionMode: 'bypassPermissions', approvalBypassExplicit: true });
    const replay = repo.upsertChildSession('sdk-child', 'sdk-root', 'Inspect (@general subagent)', '/private/tmp/coordinator-permission-fixture')!;
    expect(replay.id).toBe(child.id);
    expect(replay.permissionMode).toBe('bypassPermissions');
    expect(replay.approvalBypassExplicit).toBe(true);
  });

  it('does not mark inherited bypass as an explicit human selection even when the parent marker is absent', () => {
    parent('bypassPermissions');
    const child = repo.upsertChildSession('sdk-child', 'sdk-root', 'Inspect (@general subagent)', '/private/tmp/coordinator-permission-fixture')!;
    expect(child.permissionMode).toBe('bypassPermissions');
    expect(child.approvalBypassExplicit).toBe(false);
  });

  it('holds an invalid canonical parent mode before inserting a native child', () => {
    const root = parent('default');
    db.prepare('UPDATE agent_sessions SET permission_mode=? WHERE id=?').run('invented-mode', root.id);
    expect(repo.upsertChildSession('sdk-child', 'sdk-root', 'Inspect (@general subagent)', '/private/tmp/coordinator-permission-fixture')).toBeNull();
    expect(repo.findBySdkSessionId('sdk-child')).toBeNull();
  });
});
