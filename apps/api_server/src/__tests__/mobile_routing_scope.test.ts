/**
 * Routing scope + mobile routing through the proxy.
 * Covers: proxy body rewrite for Auto sessions, echo/explicit/fixed handling,
 * failure fallback, mobile session state PATCH (modelMode), config GET/PUT for
 * routing fields, and the router_decided_at migration.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { NextFunction, Request, Response, Router } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    isProviderInAuthStore: () => true,
    providerSnapshot: vi.fn().mockResolvedValue({ providers: [] }),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// Routing scope is independent of the operator's live provider quota. Keep this
// fixture healthy so the real tier resolver can exercise the frontier choice.
vi.mock('../services/usage_budget_service', () => ({
  getUsageBudget: vi.fn().mockResolvedValue({
    fetchedAt: '2026-10-06T00:00:00Z',
    providers: [
      { provider: 'anthropic', label: 'Anthropic', kind: 'window', items: [{ label: '5h', remainingFraction: 1 }] },
      { provider: 'openai', label: 'OpenAI', kind: 'window', items: [{ label: '5h', remainingFraction: 1 }] },
    ],
  }),
}));

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { asOpenCodeAgentId } from '../models/agent_session';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { createMobileGatewayRouter } from '../routes/mobile_gateway_routes';
import { classifyRouteTier } from '../services/agent_model_resolver';
import type { RerankClient } from '../services/decision/decision_client';
import { setRerankClientForTests } from '../services/decision/decision_client';
import { updateConfig, buildConfigView, DecisionConfigError } from '../services/decision/decision_config_service';
import { resetDecisionSettingsCacheForTests } from '../services/decision/decision_settings';
import { routeMobilePromptBody } from '../services/decision/mobile_prompt_routing';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import { listDecisions } from '../services/decision/decision_log';
import { waitForShadowRoutingForTests } from '../services/decision/model_router';

const ENV = [
  'RHYTHM_DECISION_ROUTER_FILE', 'AGENT_DECISION_MODEL_ROUTING', 'AGENT_DECISION_CAPACITY_ROUTING',
  'AGENT_DECISION_ROUTING_SCOPE', 'AGENT_DECISION_ESCALATE_MIN_CONFIDENCE',
];
const ROOT = '/Users/person';
let PROJECT = { id: 'routing-project', root: '/routing/project' };
let OWNER = 1;
const SONNET = { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' };
let saved: Record<string, string | undefined>;
let db: Database.Database;
let prev: Database.Database | null;
let dir: string;

const fakeClient = (scores: number[]) => {
  const rerank = vi.fn(async () => ({ status: 'ok' as const, scores, latencyMs: 1, model: 'fake' }));
  return { client: { rerank } as RerankClient, rerank };
};

function mobileSession(sdkSessionId: string, mode?: 'fixed') {
  const repo = new AgentSessionsRepository();
  const s = repo.reconcileMobileSession({
    sdkSessionId,
    ownerUserId: OWNER,
    projectId: PROJECT.id,
    cwd: ROOT,
    name: 'Mobile chat',
    archivedAt: null,
    opencodeAgentId: asOpenCodeAgentId('claude-code'),
    providerId: SONNET.providerID,
    modelId: SONNET.modelID,
  })!;
  if (mode) repo.updateFields(s.id, { modelMode: mode });
  return s;
}

function makeProxy() {
  const prompts: Array<Record<string, unknown>> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/session' && init?.method === 'GET') {
      return new Response(JSON.stringify([{ id: 'ses-1', directory: ROOT }, { id: 'ses-2', directory: ROOT }]), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/prompt_async')) {
      prompts.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  });
  const proxy = new MobileOpenCodeProxy({
    baseUrl: 'http://opencode.test',
    fetchFn,
    ownershipRepository: {
      isResourceOwnedBy: () => true,
      isResourceExplicitlyOwnedBy: () => true,
      claimResource: () => true,
      releaseResource: () => true,
      resolveSessionDirectoryForOwner: () => ROOT,
    },
    preparePromptStream: async () => undefined,
  } as never);
  const send = (sessionId: string, extra: Record<string, unknown> = {}) =>
    proxy.forward({
      method: 'POST',
      path: `/session/${sessionId}/prompt_async`,
      query: new URLSearchParams(),
      body: { parts: [{ type: 'text', text: 'redesign the whole auth architecture' }], ...extra },
      project: PROJECT,
      userId: OWNER,
    });
  return { prompts, send };
}

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'mobile-routing-'));
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'decision-router.json');
  process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
  process.env.AGENT_DECISION_CAPACITY_ROUTING = 'off';
  delete process.env.AGENT_DECISION_ROUTING_SCOPE;
  delete process.env.AGENT_DECISION_ESCALATE_MIN_CONFIDENCE;
  resetDecisionSettingsCacheForTests();
  db = new Database(':memory:');
  runMigrations(db);
  prev = setDb(db);
  OWNER = new UsersRepository().create({ name: 'Owner', email: 'owner@example.test' }).id;
  const project = new ProjectsRepository().insert({
    name: 'Routing project', cwd: '/routing/project', icon: null,
    vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
  });
  PROJECT = { id: project.id, root: project.cwd };
});
afterEach(async () => {
  await waitForShadowRoutingForTests();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setRerankClientForTests(null);
  resetDecisionSettingsCacheForTests();
  vi.restoreAllMocks();
  setDb(prev);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

type Model = { providerID: string; modelID: string };
const modelOf = (b: Record<string, unknown>) => b.model as Model | undefined;

describe('mobile proxy routing', () => {
  it('sessions created through reconcileMobileSession default to auto', () => {
    expect(mobileSession('ses-1').modelMode).toBe('auto');
  });

  it('auto: first prompt rewrites model and persists; second prompt skips the reranker and reuses the pick', async () => {
    const { client, rerank } = fakeClient([0.02, 0.05, 0.95]);
    setRerankClientForTests(client);
    mobileSession('ses-1');
    const { prompts, send } = makeProxy();

    expect((await send('ses-1')).status).toBe(204);
    const first = modelOf(prompts[0])!;
    expect(first.providerID).toBe('anthropic');
    expect(classifyRouteTier({ providerID: first.providerID, modelID: first.modelID })).toBe('frontier');
    const row = new AgentSessionsRepository().findBySdkSessionId('ses-1')!;
    expect(row.modelMode).toBe('auto');
    expect(row.routerDecidedAt).toBeTruthy();
    expect(row.modelId).toBe(first.modelID);
    expect(rerank).toHaveBeenCalledTimes(1);

    await send('ses-1');
    expect(rerank).toHaveBeenCalledTimes(1);
    expect(modelOf(prompts[1])).toEqual(first);
  });

  it('auto: a body model equal to the stored model is an echo and is replaced by the routed pick', async () => {
    setRerankClientForTests(fakeClient([0.02, 0.05, 0.95]).client);
    mobileSession('ses-1');
    const { prompts, send } = makeProxy();
    await send('ses-1', { model: SONNET });
    const m = modelOf(prompts[0])!;
    expect(m).not.toEqual(SONNET);
    expect(classifyRouteTier({ providerID: m.providerID, modelID: m.modelID })).toBe('frontier');
  });

  it('auto: a different explicit model is forwarded unchanged and the router is not consulted', async () => {
    const { client, rerank } = fakeClient([0.02, 0.05, 0.95]);
    setRerankClientForTests(client);
    mobileSession('ses-1');
    const { prompts, send } = makeProxy();
    const explicit = { providerID: 'openai', modelID: 'gpt-5.6-luna' };
    await send('ses-1', { model: explicit });
    expect(modelOf(prompts[0])).toEqual(explicit);
    expect(rerank).not.toHaveBeenCalled();
    expect(new AgentSessionsRepository().findBySdkSessionId('ses-1')!.routerDecidedAt).toBeNull();
  });

  it('fixed sessions are untouched', async () => {
    const { client, rerank } = fakeClient([0.02, 0.05, 0.95]);
    setRerankClientForTests(client);
    mobileSession('ses-1', 'fixed');
    const { prompts, send } = makeProxy();
    await send('ses-1');
    expect(modelOf(prompts[0])).toBeUndefined();
    await send('ses-1', { model: SONNET });
    expect(modelOf(prompts[1])).toEqual(SONNET);
    expect(rerank).not.toHaveBeenCalled();
  });

  it('shadow mode: body untouched apart from the stored model, nothing persisted', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'shadow';
    const { client, rerank } = fakeClient([0.02, 0.05, 0.95]);
    setRerankClientForTests(client);
    mobileSession('ses-1');
    const before = new AgentSessionsRepository().findBySdkSessionId('ses-1');
    const { prompts, send } = makeProxy();
    await send('ses-1', { model: SONNET });
    await send('ses-1', { model: SONNET });
    await waitForShadowRoutingForTests();
    expect(prompts.map(modelOf)).toEqual([SONNET, SONNET]);
    expect(rerank).toHaveBeenCalledTimes(1);
    expect(new AgentSessionsRepository().findBySdkSessionId('ses-1')).toEqual(before);
    const rows = listDecisions({ feature: 'model_routing' });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ wouldApply: true, catalog: 'static', pickedModel: 'anthropic/claude-opus-4-7', catalogLatencyMs: expect.any(Number) });
  });

  it('any failure forwards the original body unchanged', async () => {
    mobileSession('ses-1');
    vi.spyOn(AgentSessionsRepository.prototype, 'findBySdkSessionId').mockImplementation(() => {
      throw new Error('db down');
    });
    const body = { parts: [{ type: 'text', text: 'hi' }] };
    expect(await routeMobilePromptBody({ sdkSessionId: 'ses-1', userId: OWNER, body })).toBe(body);
  });

  it('another user never has their session routed', async () => {
    mobileSession('ses-1');
    const body = { parts: [{ type: 'text', text: 'hi' }] };
    expect(await routeMobilePromptBody({ sdkSessionId: 'ses-1', userId: OWNER + 1000, body })).toBe(body);
  });
});

describe('mobile session state PATCH modelMode', () => {
  interface RouteLayer {
    route?: { path: string; stack: Array<{ handle: (r: Request, s: Response, n: NextFunction) => void }> };
  }
  const patch = (router: Router, body: Record<string, unknown>) => {
    const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
      (l) => l.route?.path === '/sessions/:id/state',
    );
    const handler = layer!.route!.stack.at(-1)!.handle;
    return new Promise<{ ok?: Record<string, unknown>; err?: unknown }>((resolve) => {
      handler(
        {
          params: { id: 'ses-1' },
          body: {
            profileId: null, opencodeAgentId: null, providerId: 'anthropic', modelId: 'claude-opus-4-7',
            thinkingBudget: null, permissionMode: 'default', ...body,
          },
          mobileDevice: { userId: OWNER },
          mobileProject: PROJECT,
        } as unknown as Request,
        { json: (v: Record<string, unknown>) => resolve({ ok: v }) } as unknown as Response,
        (err?: unknown) => resolve({ err }),
      );
    });
  };

  it('accepts auto/fixed, rejects others, clears router_decided_at on auto, returns modelMode', async () => {
    const router = createMobileGatewayRouter({} as never);
    const s = mobileSession('ses-1');
    const repo = new AgentSessionsRepository();
    repo.setRouterDecision(s.id, { providerId: 'anthropic', modelId: 'claude-opus-4-7', decidedAt: '2026-01-01T00:00:00Z' });

    const bad = await patch(router, { modelMode: 'router' });
    expect((bad.err as { statusCode?: number; status?: number }).statusCode ?? (bad.err as { status?: number }).status).toBe(400);

    const pinned = await patch(router, { modelMode: 'fixed' });
    expect(pinned.ok).toMatchObject({ modelMode: 'fixed', modelId: 'claude-opus-4-7' });

    const auto = await patch(router, { modelMode: 'auto' });
    expect(auto.ok).toMatchObject({ modelMode: 'auto', routerDecidedAt: null });
    expect(repo.findById(s.id)!.routerDecidedAt).toBeNull();

    const untouched = await patch(router, {});
    expect(untouched.ok).toMatchObject({ modelMode: 'auto' });
  });
});

describe('routing config', () => {
  it('defaults, PUT round-trip, validation and env lock', () => {
    const v0 = buildConfigView();
    expect(v0.routing).toEqual({ scope: 'first_prompt', escalateMinConfidence: 0.75, minConfidence: 0.55, lowConfidenceTier: null });
    const v1 = updateConfig({ routing: { scope: 'escalate_only', escalateMinConfidence: 0.9 } });
    expect(v1.routing).toEqual({ scope: 'escalate_only', escalateMinConfidence: 0.9, minConfidence: 0.55, lowConfidenceTier: null });
    expect(v1.effective.routing).toEqual({ scope: 'escalate_only', escalateMinConfidence: 0.9, minConfidence: 0.55, lowConfidenceTier: 'keep' });

    const code = (fn: () => unknown) => {
      try { fn(); } catch (e) { return e instanceof DecisionConfigError ? [e.status, e.code] : ['other']; }
      return ['none'];
    };
    expect(code(() => updateConfig({ routing: { scope: 'sometimes' } }))).toEqual([400, 'invalid_routing_scope']);
    for (const bad of [0, 1.5, -1, 'x', null]) {
      expect(code(() => updateConfig({ routing: { escalateMinConfidence: bad } }))).toEqual([400, 'invalid_confidence']);
    }

    process.env.AGENT_DECISION_ROUTING_SCOPE = 'every_prompt';
    process.env.AGENT_DECISION_ESCALATE_MIN_CONFIDENCE = '0.6';
    const v2 = buildConfigView();
    expect(v2.lockedByEnv).toEqual(expect.arrayContaining(['routing.scope', 'routing.escalateMinConfidence']));
    expect(v2.effective.routing).toEqual({ scope: 'every_prompt', escalateMinConfidence: 0.6, minConfidence: 0.55, lowConfidenceTier: 'keep' });
    expect(v2.routing.scope).toBe('escalate_only');
  });
});

describe('router_decided_at migration', () => {
  it('adds a nullable column to a legacy table and is idempotent', () => {
    const legacy = new Database(':memory:');
    runMigrations(legacy);
    legacy.exec('ALTER TABLE agent_sessions DROP COLUMN router_decided_at');
    legacy.prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, created_at, updated_at)
       VALUES ('legacy', 'claude-code', 'idle', '/tmp', 'old', 'now', 'now')`,
    ).run();
    runMigrations(legacy);
    runMigrations(legacy);
    const col = (legacy.pragma('table_info(agent_sessions)') as { name: string; notnull: number }[]).find(
      (c) => c.name === 'router_decided_at',
    );
    expect(col?.notnull).toBe(0);
    expect(
      (legacy.prepare('SELECT router_decided_at AS v FROM agent_sessions WHERE id = ?').get('legacy') as { v: unknown }).v,
    ).toBeNull();
    legacy.close();
  });
});
