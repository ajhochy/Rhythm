/**
 * Real API + fork engine + Grid/Luna foreground gate. The operator starts the
 * isolated sandbox with an approved, private fixture and explicitly supplies
 * one owned Auto primary root and bearer. No server or provider is mocked here.
 * The sandbox directory is removed by tools/dev/sandbox.sh down after the run.
 */
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_COORDINATOR_AUTO === '1';
const gate = live ? describe : describe.skip;

gate('Coordinator Auto uses the actual Grid route through API and engine', () => {
  it('binds one reserved foreground command to the applied Grid model and native SDK message', async () => {
    assertLiveE2EIsolation();
    expect(process.env.RHYTHM_COORD_AUTO_LIVE_APPROVED).toBe('1');
    const api = 'http://127.0.0.1:4098';
    const engine = 'http://127.0.0.1:4097';
    const fixtureRoot = realpathSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT!);
    const sourceDb = realpathSync(process.env.RHYTHM_LIVE_DB_PATH!);
    const sourceConfig = realpathSync(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG!);
    const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR!);
    const dbPath = realpathSync(process.env.RHYTHM_COORD_AUTO_SANDBOX_DB_PATH!);
    expect(fixtureRoot).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sandbox).toMatch(/^\/private\/tmp\/rhythm-[^/]+$/);
    expect(sourceDb).toBe(join(fixtureRoot, 'rhythm.db'));
    expect(sourceConfig.startsWith(`${fixtureRoot}${sep}`)).toBe(true);
    expect(statSync(sourceDb).mode & 0o222).toBe(0);
    expect(statSync(sourceConfig).mode & 0o222).toBe(0);
    expect(dbPath).toBe(join(sandbox, 'rhythm.db'));
    expect(realpathSync(process.env.DB_PATH!)).toBe(dbPath);
    const sessionId = process.env.RHYTHM_COORD_AUTO_SESSION_ID;
    const projectId = process.env.RHYTHM_COORD_AUTO_PROJECT_ID;
    const token = process.env.RHYTHM_COORD_AUTO_BEARER;
    expect(sessionId && projectId && token).toBeTruthy();
    // The immutable source is a synthetic fixture, never a copied operator DB.
    const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
    try {
      const identities = source.prepare('SELECT id, email FROM users').all() as Array<{ id: number; email: string }>;
      expect(identities.length).toBeGreaterThan(0);
      expect(identities.every((user) => user.email.endsWith('@qualification.invalid'))).toBe(true);
    } finally { source.close(); }
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const post = async (path: string, body: object) => {
      const response = await fetch(`${api}/coordinator-conversations/${path}`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ kind: string; conversation?: { controlRevision: number } }>;
    };
    try {
      expect((await fetch(`${api}/health`, { signal: AbortSignal.timeout(5_000) })).ok).toBe(true);
      expect((await fetch(`${engine}/global/health`, { signal: AbortSignal.timeout(5_000) })).ok).toBe(true);
      const auth = await fetch(`${api}/auth/me`, {
        headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000),
      });
      expect(auth.status).toBe(200);
      const identity = await auth.json() as { user: { id: number; email: string } };
      expect(identity.user.email).toBe('coordinator-auto@qualification.invalid');
      expect((db.prepare('SELECT id, email FROM users WHERE id=?').get(identity.user.id) as
        { id: number; email: string })).toEqual({ id: identity.user.id, email: identity.user.email });
      const before = db.prepare(`SELECT model_mode, sdk_session_id, provider_id, model_id, router_decided_at,
        owner_user_id, project_id, cwd, coordinator_conversation_json FROM agent_sessions WHERE id=?`).get(sessionId) as
        { model_mode: string; sdk_session_id: string | null; provider_id: string | null; model_id: string | null;
          router_decided_at: string | null; owner_user_id: number | null; project_id: string | null; cwd: string;
          coordinator_conversation_json: string | null } | undefined;
      expect(before?.model_mode).toBe('auto');
      expect(before?.router_decided_at).toBeNull();
      expect(before?.owner_user_id).toBe(identity.user.id);
      expect(before?.project_id).toBe(projectId);
      expect(realpathSync(before!.cwd).startsWith(`${sandbox}${sep}`)).toBe(true);
      expect(JSON.parse(before!.coordinator_conversation_json!).primaryOwnerRoot).toBe(true);
      const oldDispatchIds = new Set((db.prepare(`SELECT id FROM agent_turn_dispatches WHERE session_id=?`).all(sessionId) as
        Array<{ id: string }>).map((entry) => entry.id));
      const oldAttempts = (db.prepare(`SELECT COUNT(*) AS n FROM agent_router_grid_attempts WHERE session_id=?`).get(sessionId) as { n: number }).n;
      const opened = await post('open', { sessionId, projectId });
      expect(opened.kind).toBe('found');
      const nonce = randomUUID();
      const request = { sessionId, projectId, expectedControlRevision: opened.conversation!.controlRevision,
        commandKey: `smoke-coordinator-auto-${nonce}`, message: `[smoke] ${nonce} Reply briefly with the word ready. No tools.` };
      const first = await post('message', request);
      expect(first.kind).toBe('foreground_accepted');
      let canonicalInput = false;
      for (let attempt = 0; attempt < 40 && !canonicalInput; attempt += 1) {
        const history = await fetch(`${api}/agent-sessions/${encodeURIComponent(sessionId!)}/messages?limit=100`, {
          headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
        });
        expect(history.status).toBe(200);
        const messages = await history.json() as { messages: Array<{ role: string; rawText?: string; strippedText?: string }> };
        canonicalInput = messages.messages.some((entry) => (entry.role === 'input' || entry.role === 'user') &&
          (entry.rawText ?? entry.strippedText ?? '').includes(nonce));
        if (!canonicalInput) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(canonicalInput).toBe(true);
      const row = db.prepare(`SELECT sdk_session_id, provider_id, model_id, router_variant, router_decided_at,
        anthropic_account_id, openai_account_id
        FROM agent_sessions WHERE id=?`).get(sessionId) as Record<string, string | null>;
      expect(row.router_decided_at).toBeTruthy();
      const dispatches = db.prepare(`SELECT id, requested_source, requested_provider_id, requested_model_id,
        resolved_provider_id, resolved_model_id, final_provider_id, final_model_id, sdk_user_message_id,
        origin, route_authed, reason_code, outcome FROM agent_turn_dispatches WHERE session_id=?`).all(sessionId) as
        Array<Record<string, string | number | null> & { id: string }>;
      const newDispatches = dispatches.filter((entry) => !oldDispatchIds.has(entry.id));
      expect(newDispatches).toHaveLength(1);
      const dispatch = newDispatches[0];
      expect(dispatch).toMatchObject({ requested_source: 'session', resolved_provider_id: row.provider_id,
        resolved_model_id: row.model_id, final_provider_id: row.provider_id, final_model_id: row.model_id,
        origin: 'prompt_api', route_authed: 1, reason_code: 'c2_foreground', outcome: 'accepted' });
      expect(dispatch.sdk_user_message_id).toBeTruthy();
      if (before!.provider_id && before!.model_id) {
        expect(dispatch.requested_provider_id).toBe(before!.provider_id);
        expect(dispatch.requested_model_id).toBe(before!.model_id);
      }
      const attempts = db.prepare(`SELECT result_json FROM agent_router_grid_attempts WHERE session_id=? ORDER BY id`).all(sessionId) as
        Array<{ result_json: string }>;
      expect(attempts.length).toBeGreaterThan(oldAttempts);
      const applied = attempts.slice(oldAttempts).map((entry) => JSON.parse(entry.result_json) as
        { applied: boolean; model: string | null; effortApplied: string | null; accountId: string | null }).filter((entry) => entry.applied);
      expect(applied).toHaveLength(1);
      expect(applied[0].model).toBe(`${row.provider_id}/${row.model_id}`);
      expect(row.router_variant).toBe(applied[0].effortApplied);
      if (row.provider_id === 'anthropic') expect(row.anthropic_account_id).toBe(applied[0].accountId);
      if (row.provider_id === 'openai') expect(row.openai_account_id).toBe(applied[0].accountId);
      const sdk = await fetch(`${engine}/session/${encodeURIComponent(row.sdk_session_id!)}`, { signal: AbortSignal.timeout(5_000) });
      expect(sdk.ok).toBe(true);
      expect((await post('message', request)).kind).toBe('foreground_accepted');
      expect((db.prepare(`SELECT COUNT(*) AS n FROM agent_turn_dispatches WHERE session_id=?`).get(sessionId) as { n: number }).n).toBe(oldDispatchIds.size + 1);
      expect((db.prepare(`SELECT COUNT(*) AS n FROM agent_router_grid_attempts WHERE session_id=?`).get(sessionId) as { n: number }).n).toBe(attempts.length);
    } finally {
      db.close();
    }
  }, 120_000);
});
