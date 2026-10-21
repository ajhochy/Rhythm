/** Real sandbox API + fork gate for a freshly created synthetic primary. No model turn. */
import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const RUN = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_PRIMARY_MISSING_CWD === '1';
const API = 'http://127.0.0.1:4098';
const ENGINE = 'http://127.0.0.1:4097';

(RUN ? describe : describe.skip)('live synthetic primary missing workspace', () => {
  it('withholds real API readiness while preserving the root and ordinary sandbox engine', async () => {
    assertLiveE2EIsolation();
    const fixture = realpathSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT!);
    const sourceDb = realpathSync(process.env.RHYTHM_LIVE_DB_PATH!);
    const sourceConfig = realpathSync(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG!);
    const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR!);
    const dbPath = realpathSync(process.env.DB_PATH!);
    expect(fixture).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sandbox).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sourceDb).toBe(path.join(fixture, 'rhythm.db'));
    expect(sourceConfig.startsWith(`${fixture}${path.sep}`)).toBe(true);
    expect(statSync(sourceDb).mode & 0o222).toBe(0);
    expect(statSync(sourceConfig).mode & 0o222).toBe(0);
    expect(dbPath).toBe(path.join(sandbox, 'rhythm.db'));
    const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
    try {
      const users = source.prepare('SELECT email FROM users').all() as Array<{ email: string }>;
      expect(users.length).toBeGreaterThan(0);
      expect(users.every((row) => row.email.endsWith('.invalid'))).toBe(true);
    } finally { source.close(); }

    const bearer = process.env.RHYTHM_PRIMARY_LIVE_BEARER;
    expect(bearer).toBeTruthy();
    const headers = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' };
    const post = async (route: string, body: object) => {
      const response = await fetch(`${API}/coordinator-conversations/${route}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const me = await fetch(`${API}/auth/me`, { headers, signal: AbortSignal.timeout(5_000) });
    expect(me.status).toBe(200);
    const actor = await me.json() as { user: { id: number; email: string } };
    expect(actor.user.email.endsWith('.invalid')).toBe(true);
    expect((await fetch(`${ENGINE}/global/health`, { signal: AbortSignal.timeout(5_000) })).ok).toBe(true);

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const roots = () => db.prepare(`SELECT id,project_id,owner_user_id,sdk_session_id,cwd,coordinator_conversation_json
        FROM agent_sessions WHERE owner_user_id=? AND json_extract(coordinator_conversation_json,'$.primaryOwnerRoot')=1`)
        .all(actor.user.id) as Array<Record<string, unknown>>;
      expect(roots(), 'test must create the only root through normal API').toEqual([]);
      const commandKey = `smoke-primary-cwd-${randomUUID()}`;
      let setup = await post('setup', { commandKey });
      if (setup.body.kind === 'setup_profile_choice_required') {
        const profileId = process.env.RHYTHM_PRIMARY_LIVE_PROFILE_ID;
        expect(profileId).toBeTruthy();
        const choices = setup.body.profileChoices as Array<{ id: string }>;
        expect(choices.some((choice) => choice.id === profileId)).toBe(true);
        setup = await post('setup', { commandKey, profileId });
      }
      expect(setup.status).toBe(201);
      expect(setup.body.kind).toBe('setup_created');
      const sessionId = setup.body.sessionId as string;
      const projectId = setup.body.projectId as string;
      expect(roots()).toHaveLength(1);
      const root = roots()[0];
      expect(root).toMatchObject({ id: sessionId, project_id: projectId,
        owner_user_id: actor.user.id, sdk_session_id: null });
      const project = db.prepare(`SELECT cwd,archived_at,coordinator_owner_user_id,coordinator_setup_provenance,
        coordinator_workspace_generation FROM projects WHERE id=?`).get(projectId) as Record<string, unknown>;
      const cwd = String(project.cwd);
      expect(project).toMatchObject({ cwd: root.cwd, archived_at: null,
        coordinator_owner_user_id: actor.user.id,
        coordinator_setup_provenance: 'c2_fresh_owned_workspace_v1',
        coordinator_workspace_generation: expect.any(Number) });
      const parent = realpathSync(path.join(sandbox, 'live-artifacts', 'coordinator-workspaces'));
      expect(path.dirname(cwd)).toBe(parent);
      expect(path.basename(cwd)).toMatch(/^rhythm-[a-f0-9-]{36}$/);
      expect(realpathSync(cwd)).toBe(cwd);
      const original = lstatSync(cwd);
      expect(original.isDirectory() && !original.isSymbolicLink() && original.uid === process.getuid?.()).toBe(true);
      expect(readdirSync(cwd), 'only an inert empty cwd may be renamed').toEqual([]);
      const engineSessions = async () => {
        const response = await fetch(`${ENGINE}/session?directory=${encodeURIComponent(cwd)}`, {
          signal: AbortSignal.timeout(10_000),
        });
        expect(response.status).toBe(200);
        const rows = await response.json() as Array<{ directory: string }>;
        expect(Array.isArray(rows)).toBe(true);
        return rows.filter((row) => row.directory === cwd);
      };
      expect(await engineSessions()).toEqual([]);
      const request = { sessionId, projectId };
      expect(await post('status', request)).toMatchObject({ status: 200, body: { kind: 'status' } });
      const history = await post('history', { ...request, limit: 50 });
      expect(history).toMatchObject({ status: 200, body: { kind: 'history', messages: [] } });
      const journal = roots()[0].coordinator_conversation_json;
      const controlRevision = (JSON.parse(String(journal)) as { controlRevision: number }).controlRevision;
      const count = (sql: string, id: string) => (db.prepare(sql).get(id) as { n: number }).n;
      const counts = () => ({
        children: count('SELECT count(*) n FROM agent_sessions WHERE parent_session_id=?', sessionId),
        commands: count('SELECT count(*) n FROM coordinator_conversation_commands WHERE root_session_id=?', sessionId),
        routeAttempts: count('SELECT count(*) n FROM agent_router_grid_attempts WHERE session_id=?', sessionId),
        dispatches: count('SELECT count(*) n FROM agent_turn_dispatches WHERE session_id=?', sessionId),
      });
      const inert = { children: 0, commands: 0, routeAttempts: 0, dispatches: 0 };
      expect(counts()).toEqual(inert);
      const backup = path.join(parent, `.smoke-primary-cwd-${randomUUID()}`);
      expect(lstatSync(backup, { throwIfNoEntry: false })).toBeUndefined();
      let renamed = false;
      try {
        expect(roots()).toHaveLength(1);
        expect(readdirSync(cwd)).toEqual([]);
        renameSync(cwd, backup);
        renamed = true;
        expect(lstatSync(cwd, { throwIfNoEntry: false })).toBeUndefined();
        expect(await post('status', request)).toEqual({ status: 503, body: { kind: 'context_unavailable' } });
        expect(await post('message', { ...request, expectedControlRevision: controlRevision,
          commandKey: `smoke-missing-foreground-${randomUUID()}`, message: 'What is two plus two?' }))
          .toEqual({ status: 503, body: { kind: 'context_unavailable' } });
        expect(await post('open', request)).toMatchObject({ status: 200,
          body: { kind: 'replay', conversation: { sessionId, projectId } } });
        expect(await post('history', { ...request, limit: 50 })).toEqual(history);
        expect(counts()).toEqual(inert);
        expect(roots()[0].sdk_session_id).toBeNull();
        expect(roots()[0].coordinator_conversation_json).toBe(journal);
        expect(await engineSessions()).toEqual([]);
      } finally {
        if (renamed) {
          const moved = lstatSync(backup);
          expect(moved.isDirectory() && moved.dev === original.dev && moved.ino === original.ino).toBe(true);
          expect(lstatSync(cwd, { throwIfNoEntry: false })).toBeUndefined();
          renameSync(backup, cwd);
        }
      }
      expect(await post('status', request)).toMatchObject({ status: 200, body: { kind: 'status' } });
      expect(counts()).toEqual(inert);
      expect(roots()[0].coordinator_conversation_json).toBe(journal);
    } finally { db.close(); }
  }, 90_000);
});
