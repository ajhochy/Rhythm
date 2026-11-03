/**
 * Chat-settings wire v1 (docs/ai/plans/2026-10-06-chat-settings-wire-contract.md,
 * frozen fixtures docs/ai/plans/2026-10-06-chat-settings-wire-fixtures.json).
 * Real router layer handlers (GET + PATCH /sessions/:id/state), real migrated
 * SQLite and repositories. `?identity=local-primary|sdk` is explicit; an absent
 * selector keeps the legacy SDK/full-profile semantics. An inert primary is
 * addressed only by its exact local id and never gains an SDK id or a fallback.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextFunction, Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { isReady: true, listAuthedProviders: vi.fn().mockResolvedValue(['provider-default', 'provider-pick']) },
  opencodeSessionMap: new Map<string, string>(),
}));

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { createMobileGatewayRouter } from '../routes/mobile_gateway_routes';

const OWNER = 7;
const PROJECT = { id: 'project-primary', root: '/projects/primary' };
const NOW = new Date('2026-10-06T12:00:00.000Z');
const fixtures = JSON.parse(readFileSync(
  resolve(__dirname, './fixtures/chat-settings-wire-fixtures.json'), 'utf8',
)) as {
  requests: Array<{ name: string; body?: Record<string, unknown>; response?: Record<string, unknown> }>;
  negativeCases: Array<{ body?: Record<string, unknown>; identity?: string; status?: number }>;
};
const bodyOf = (name: string) => fixtures.requests.find((request) => request.name === name)!.body!;

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (r: Request, s: Response, n: NextFunction) => unknown }> };
}
type Result = { ok?: Record<string, unknown>; err?: { statusCode?: number; status?: number } };

describe('mobile session state port: explicit identity wire v1', () => {
  let db: Database.Database;
  let router: Router;
  let sessions: AgentSessionsRepository;
  let authorize: (providerId: string, modelId: string) => Promise<boolean>;
  const primaryId = 'primary-local';
  const ordinaryId = 'ordinary-local';
  const ordinarySdk = 'ses-ordinary';

  const setColumns = (id: string, columns: Record<string, unknown>): void => {
    for (const [column, value] of Object.entries(columns)) {
      db.prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, id);
    }
  };
  function chat(id: string, over: Record<string, unknown> = {}): void {
    sessions.insert({ agentKind: 'librarian', taskId: null, cwd: '/tmp', name: id, profileId: 'secretary' } as never);
    const created = db.prepare('SELECT id FROM agent_sessions ORDER BY rowid DESC LIMIT 1').get() as { id: string };
    db.prepare('UPDATE agent_sessions SET id=? WHERE id=?').run(id, created.id);
    setColumns(id, {
      owner_user_id: OWNER, project_id: PROJECT.id, status: 'idle', permission_mode: 'plan',
      provider_id: 'provider-default', model_id: 'model-default', model_mode: 'fixed', thinking_budget: 2048, fast_mode: 1, ...over,
    });
  }
  function call(method: 'get' | 'patch', id: string, opts: { query?: Record<string, unknown>; body?: unknown; userId?: number; projectId?: string } = {}) {
    const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
      (l) => l.route?.path === '/sessions/:id/state' && l.route.methods[method],
    );
    const handler = layer!.route!.stack.at(-1)!.handle;
    return new Promise<Result>((resolveResult) => {
      void handler(
        {
          params: { id }, query: opts.query ?? {}, body: opts.body,
          mobileDevice: { userId: opts.userId ?? OWNER },
          mobileProject: { ...PROJECT, id: opts.projectId ?? PROJECT.id },
        } as unknown as Request,
        { json: (v: Record<string, unknown>) => resolveResult({ ok: v }) } as unknown as Response,
        (err?: unknown) => resolveResult({ err: err as { statusCode?: number } }),
      );
    });
  }
  const local = (method: 'get' | 'patch', body?: unknown, extra: Parameters<typeof call>[2] = {}) =>
    call(method, primaryId, { query: { identity: 'local-primary' }, body, ...extra });
  const sdk = (method: 'get' | 'patch', body?: unknown, id = ordinarySdk) =>
    call(method, id, { query: { identity: 'sdk' }, body });
  const status = (r: Result) => r.err?.statusCode ?? r.err?.status;
  const row = (id: string) => db.prepare(
    'SELECT provider_id, model_id, model_mode, thinking_budget, fast_mode, profile_id, agent_kind, permission_mode, sdk_session_id, router_decided_at, archived_at FROM agent_sessions WHERE id=?',
  ).get(id);
  const sessionCount = () => (db.prepare('SELECT COUNT(*) AS n FROM agent_sessions').get() as { n: number }).n;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    db.pragma('foreign_keys = OFF');
    setDb(db);
    db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES (?, 'Primary', ?, ?)`).run(PROJECT.id, PROJECT.root, NOW.toISOString());
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent)
      VALUES ('secretary', 'Secretary', 'x', 'synthetic', 1, 1)`).run();
    db.prepare(`UPDATE agent_configs SET oc_agent='secretary', session_selectable=1, model_provider='provider-default', model_id='model-default' WHERE id='secretary'`).run();
    sessions = new AgentSessionsRepository();
    chat(primaryId, { sdk_session_id: null, agent_kind: 'secretary' });
    const repo = new CoordinatorConversationsRepository(db, () => NOW);
    expect(repo.designatePrimaryOwnerRoot(
      { ownerUserId: OWNER, projectId: PROJECT.id, sessionId: primaryId },
      { allowUnboundSdk: true },
    ).kind).toBe('found');
    chat(ordinaryId, { sdk_session_id: ordinarySdk, agent_kind: 'secretary' });
    authorize = async () => true;
    router = createMobileGatewayRouter({ authorizeSessionModel: (p: string, m: string) => authorize(p, m) } as never);
  });

  it('GET reads an inert primary by its exact local id with the versioned shape and creates nothing', async () => {
    const before = sessionCount();
    const result = await local('get');
    const expected = fixtures.requests.find((request) => request.name === 'inert-primary-read')!.response!;
    expect(Object.keys(result.ok!).sort()).toEqual(Object.keys(expected).sort());
    expect(result.ok).toMatchObject({
      settingsContractVersion: 1, settingsIdentity: 'local-primary', localSessionId: primaryId, sdkSessionId: null,
      profileId: 'secretary', opencodeAgentId: 'secretary', profileAvailability: 'available',
      providerId: 'provider-default', modelId: 'model-default', modelMode: 'fixed', routerDecidedAt: null,
      thinkingBudget: 2048, permissionMode: 'plan', fastMode: true,
    });
    expect(sessionCount()).toBe(before);
    expect(row(primaryId)).toMatchObject({ sdk_session_id: null });
  });

  it('GET with sdk identity echoes the ordinary SDK id', async () => {
    const result = await sdk('get');
    expect(result.ok).toMatchObject({
      settingsContractVersion: 1, settingsIdentity: 'sdk', localSessionId: ordinaryId, sdkSessionId: ordinarySdk, fastMode: true,
    });
  });

  it('PATCH fixed-model-only changes only the tuple and returns the authoritative readback', async () => {
    authorize = vi.fn(async () => true);
    const before = row(primaryId);
    const result = await local('patch', { modelMode: 'fixed', providerId: 'provider-pick', modelId: 'model-pick' });
    expect(result.ok).toMatchObject({
      settingsIdentity: 'local-primary', localSessionId: primaryId, sdkSessionId: null,
      providerId: 'provider-pick', modelId: 'model-pick', modelMode: 'fixed',
      thinkingBudget: 2048, fastMode: true, profileId: 'secretary', opencodeAgentId: 'secretary', permissionMode: 'plan',
    });
    expect(authorize).toHaveBeenCalledWith('provider-pick', 'model-pick');
    expect(row(primaryId)).toEqual({ ...(before as object), provider_id: 'provider-pick', model_id: 'model-pick' });
    // the response IS the readback: a fresh GET returns the same state
    expect((await local('get')).ok).toEqual(result.ok);
    expect(fixtures.requests.some((request) => request.name === 'fixed-model-only')).toBe(true);
  });

  it('PATCH auto-only preserves the stored fallback tuple, reasoning and Fast', async () => {
    const result = await local('patch', bodyOf('auto-only'));
    expect(result.ok).toMatchObject({
      modelMode: 'auto', providerId: 'provider-default', modelId: 'model-default', routerDecidedAt: null,
      thinkingBudget: 2048, fastMode: true, profileId: 'secretary',
    });
    expect(row(primaryId)).toMatchObject({ model_mode: 'auto', provider_id: 'provider-default', model_id: 'model-default', thinking_budget: 2048, fast_mode: 1 });
  });

  it('PATCH reasoning-only (null) and explicit Fast off change exactly one field each', async () => {
    const reasoning = await local('patch', bodyOf('reasoning-only'));
    expect(reasoning.ok).toMatchObject({ thinkingBudget: null, modelMode: 'fixed', providerId: 'provider-default', fastMode: true });
    const fast = await local('patch', bodyOf('explicit-fast-off'));
    expect(fast.ok).toMatchObject({ fastMode: false, thinkingBudget: null, modelId: 'model-default' });
    const on = await local('patch', { fastMode: true });
    expect(on.ok).toMatchObject({ fastMode: true, thinkingBudget: null });
    const budget = await local('patch', { thinkingBudget: 0 });
    expect(budget.ok).toMatchObject({ thinkingBudget: 0, fastMode: true });
  });

  it('an unrelated edit preserves exact reasoning 2048 and Fast true, never resetting from profile defaults', async () => {
    db.prepare(`UPDATE agent_configs SET model_provider='provider-pick', model_id='model-pick' WHERE id='secretary'`).run();
    const result = await local('patch', { modelMode: 'fixed', providerId: 'provider-default', modelId: 'model-default' });
    expect(result.ok).toMatchObject({ thinkingBudget: 2048, fastMode: true, providerId: 'provider-default', profileId: 'secretary' });
  });

  it('PATCH with sdk identity edits the ordinary session through the same partial contract', async () => {
    const primaryBefore = row(primaryId);
    const result = await sdk('patch', bodyOf('ordinary-sdk-partial-fast'));
    expect(result.ok).toMatchObject({ settingsIdentity: 'sdk', sdkSessionId: ordinarySdk, localSessionId: ordinaryId, fastMode: true, thinkingBudget: 2048 });
    const off = await sdk('patch', { fastMode: false });
    expect(off.ok).toMatchObject({ fastMode: false });
    expect(row(primaryId)).toEqual(primaryBefore);
  });

  it('rejects every frozen negative body and an unknown identity with 400 and writes nothing', async () => {
    const snapshot = row(primaryId);
    for (const negative of fixtures.negativeCases.filter((c) => c.body !== undefined)) {
      expect(status(await local('patch', negative.body))).toBe(400);
      expect(status(await sdk('patch', negative.body))).toBe(400);
    }
    for (const extra of [
      { permissionMode: 'default' }, { opencodeAgentId: 'x' }, { profileId: null }, { modelMode: 'fixed' },
      { modelMode: 'fixed', providerId: '', modelId: 'm' }, { modelMode: 'fixed', providerId: 'p', modelId: '  ' },
      { modelMode: 'auto', providerId: 'p' }, { modelId: 'm' }, { thinkingBudget: 1.5 }, { thinkingBudget: 'high' },
      { fastMode: null }, { fastMode: 1 }, { modelMode: 'router' }, { thinkingBudget: 1, unknown: true },
    ]) {
      expect(status(await local('patch', extra)), JSON.stringify(extra)).toBe(400);
    }
    expect(status(await local('patch', [{ fastMode: true }]))).toBe(400);
    expect(status(await local('patch', undefined))).toBe(400);
    for (const identity of ['local', 'primary', '', 'SDK', 'sdk,local-primary']) {
      expect(status(await call('get', primaryId, { query: { identity } }))).toBe(400);
      expect(status(await call('patch', primaryId, { query: { identity }, body: { fastMode: false } }))).toBe(400);
    }
    expect(status(await call('get', primaryId, { query: { identity: ['sdk', 'local-primary'] } }))).toBe(400);
    expect(row(primaryId)).toEqual(snapshot);
  });

  it('refuses a model its provider authorization does not allow, writing nothing', async () => {
    authorize = async () => false;
    const snapshot = row(primaryId);
    const result = await local('patch', { modelMode: 'fixed', providerId: 'provider-pick', modelId: 'model-pick' });
    expect(result.err).toBeDefined();
    expect(status(result)).toBe(403);
    expect(row(primaryId)).toEqual(snapshot);
  });

  it('keeps selectors apart: no cross-identity or generic-key lookups, and no fallback', async () => {
    const snapshots = [row(primaryId), row(ordinaryId)];
    expect(status(await call('get', ordinarySdk, { query: { identity: 'local-primary' } }))).toBe(404);
    expect(status(await call('get', ordinaryId, { query: { identity: 'local-primary' } }))).toBe(404);
    expect(status(await call('get', primaryId, { query: { identity: 'sdk' } }))).toBe(404);
    expect(status(await call('get', ordinaryId, { query: { identity: 'sdk' } }))).toBe(404);
    for (const key of ['current', 'uiSessionId', 'primary', 'root:project-primary']) {
      expect(status(await call('patch', key, { query: { identity: 'local-primary' }, body: { fastMode: false } }))).toBe(404);
    }
    // legacy (no selector) never resolves a local id, so an inert primary is never reachable that way
    const legacy = await call('patch', primaryId, {
      body: { profileId: 'secretary', opencodeAgentId: null, providerId: 'p', modelId: 'm', thinkingBudget: null, permissionMode: 'plan' },
    });
    expect(status(legacy)).toBe(404);
    expect([row(primaryId), row(ordinaryId)]).toEqual(snapshots);
  });

  it.each([
    ['another owner', () => ({ userId: OWNER + 1 })],
    ['another project', () => ({ projectId: 'project-other' })],
  ])('holds a wrong-scope local-primary request (%s) with 404 and nothing written', async (_name, scope) => {
    const snapshot = row(primaryId);
    expect(status(await local('get', undefined, scope()))).toBe(404);
    expect(status(await local('patch', { fastMode: false }, scope()))).toBe(404);
    expect(row(primaryId)).toEqual(snapshot);
  });

  const staleChanges: Array<[string, () => void]> = [
    ['archived', () => setColumns(primaryId, { archived_at: NOW.toISOString() })],
    ['a child session', () => setColumns(primaryId, { parent_session_id: ordinaryId })],
    ['a system session', () => setColumns(primaryId, { is_system: 1 })],
    ['moved to another project', () => setColumns(primaryId, { project_id: 'project-other' })],
    ['moved to another owner', () => setColumns(primaryId, { owner_user_id: OWNER + 1 })],
    ['not a chat', () => setColumns(primaryId, { category: 'task' })],
    ['no longer designated', () => setColumns(primaryId, { coordinator_conversation_json: null })],
    ['its project archived', () => { db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run(NOW.toISOString(), PROJECT.id); }],
    ['its profile disabled', () => { db.prepare(`UPDATE agent_configs SET enabled=0 WHERE id='secretary'`).run(); }],
    ['its profile removed', () => setColumns(primaryId, { profile_id: null })],
  ];
  it.each(staleChanges)('holds when the primary is %s at request time', async (_name, change) => {
    change();
    const snapshot = row(primaryId);
    expect(status(await local('get'))).toBe(404);
    expect(status(await local('patch', { modelMode: 'fixed', providerId: 'provider-pick', modelId: 'model-pick' }))).toBe(404);
    expect(row(primaryId)).toEqual(snapshot);
  });

  it.each([
    ...staleChanges,
    ['a different profile selected', () => setColumns(primaryId, { profile_id: 'other-profile' })],
    ['a different agent', () => setColumns(primaryId, { agent_kind: 'other-agent' })],
  ])('re-proves the target after the awaited model authorization: %s', async (_name, change) => {
    authorize = async () => { change(); return true; };
    const result = await local('patch', { modelMode: 'fixed', providerId: 'provider-pick', modelId: 'model-pick', fastMode: false });
    expect(status(result)).toBe(404);
    expect(row(primaryId)).toMatchObject({ provider_id: 'provider-default', model_id: 'model-default', fast_mode: 1 });
  });

  it('also re-proves an sdk target replaced during the await', async () => {
    authorize = async () => { setColumns(ordinaryId, { sdk_session_id: 'ses-replaced' }); return true; };
    const result = await sdk('patch', { modelMode: 'fixed', providerId: 'provider-pick', modelId: 'model-pick' });
    expect(status(result)).toBe(404);
    expect(row(ordinaryId)).toMatchObject({ provider_id: 'provider-default', model_id: 'model-default' });
  });

  it('keeps the legacy no-selector SDK full-state PATCH working for an ordinary session', async () => {
    const result = await call('patch', ordinarySdk, {
      body: { profileId: null, opencodeAgentId: null, providerId: 'provider-pick', modelId: 'model-pick', thinkingBudget: null, permissionMode: 'default' },
    });
    expect(result.ok).toMatchObject({ localSessionId: ordinaryId, providerId: 'provider-pick', modelId: 'model-pick', thinkingBudget: null, permissionMode: 'default', profileId: null });
    // the legacy response may carry the additions; it is not the versioned shape
    expect(result.ok).not.toHaveProperty('settingsContractVersion');
  });
});
