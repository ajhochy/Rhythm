import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { OpencodeClientService } from '../services/opencode_client_service';
import { getModelProvenance } from '../services/model_provenance_service';
import * as resolver from '../services/agent_model_resolver';
import {
  _resetForTests as resetRedispatch,
  beginHandoff,
  decideHandoff,
  noteUserMessage,
  redispatchTurn,
  retainTurn,
} from '../services/turn_redispatch';

const { sessionMap, listAuthedProviders } = vi.hoisted(() => ({
  sessionMap: new Map<string, string>(),
  listAuthedProviders: vi.fn().mockResolvedValue(['openrouter']),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
}));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { subscribeToEvents: vi.fn().mockResolvedValue(null), listAuthedProviders },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

const originalDbClient = env.dbClient;
let db: Database.Database;

function serviceWith(session: Record<string, unknown>): OpencodeClientService {
  const service = new OpencodeClientService();
  (service as unknown as { client: unknown }).client = { session };
  return service;
}

function provenance(origin: 'prompt_api' | 'ws_input' = 'prompt_api') {
  return {
    sessionId: 's',
    sdkSessionId: 'sdk-s',
    origin,
    requestedSource: 'caller' as const,
    requestedProviderId: 'openrouter',
    requestedModelId: 'openrouter/free',
    resolvedProviderId: 'openrouter',
    resolvedModelId: 'openrouter/free',
    routeAuthed: true,
  };
}

function rows() {
  return new ModelProvenanceRepository().list('s');
}

beforeEach(() => {
  env.dbClient = 'sqlite';
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  db.prepare("INSERT INTO agent_sessions (id, sdk_session_id, agent_kind, cwd, name) VALUES ('s', 'sdk-s', 'build', '/', 'test')").run();
  sessionMap.clear();
  sessionMap.set('s', 'sdk-s');
});

afterEach(() => {
  sessionMap.clear();
  setDb(null);
  db.close();
  env.dbClient = originalDbClient;
  vi.restoreAllMocks();
  resetRedispatch();
});

describe('#1576 dispatch writes at the real SDK boundary', () => {
  it('issue-1576-c2: prompt writes pending before SDK and accepted after success; omitting provenance preserves the old API', async () => {
    const sdk = vi.fn(async () => {
      expect(rows()).toEqual([expect.objectContaining({ outcome: 'pending', origin: 'prompt_api' })]);
      return { data: { info: { id: 'assistant-1' }, parts: [] }, response: { status: 200 } };
    });
    const service = serviceWith({ prompt: sdk });

    await expect(service.prompt('sdk-s', 'safe', undefined, undefined, undefined, undefined, provenance())).resolves.toEqual(
      expect.objectContaining({ info: { id: 'assistant-1' } }),
    );
    expect(rows()).toEqual([expect.objectContaining({ outcome: 'accepted', origin: 'prompt_api' })]);

    await service.prompt('sdk-s', 'legacy');
    expect(rows()).toHaveLength(1);
  });

  it('issue-1576-c3: promptAsync settles SDK error and silent no-op as rejected, but a 204 as accepted', async () => {
    const service = serviceWith({
      promptAsync: vi.fn()
        .mockResolvedValueOnce({ error: { name: 'closed' }, response: { status: 400 } })
        .mockResolvedValueOnce({ response: { status: 200 } })
        .mockResolvedValueOnce({ response: { status: 204 } }),
    });

    expect(await service.promptAsync('sdk-s', 'one', undefined, undefined, undefined, undefined, undefined, provenance())).toBe(false);
    expect(await service.promptAsync('sdk-s', 'two', undefined, undefined, undefined, undefined, undefined, provenance())).toBe(false);
    expect(await service.promptAsync('sdk-s', 'three', undefined, undefined, undefined, undefined, undefined, provenance())).toBe(true);
    expect(rows().map((row) => row.outcome)).toEqual(['rejected', 'rejected', 'accepted']);
  });

  it('issue-1576-c4: provenance persistence is non-fatal and request body data cannot forge server-owned origin', async () => {
    const sdk = vi.fn().mockResolvedValue({ data: { info: { id: 'assistant-1' }, parts: [] }, response: { status: 200 } });
    const service = serviceWith({ prompt: sdk });

    await expect(service.prompt(
      'sdk-s',
      'safe',
      undefined,
      undefined,
      { provenance: { origin: 'fallback_redispatch' } },
      undefined,
      { ...provenance('ws_input'), sessionId: 'invalid id with spaces' },
    )).resolves.toEqual(expect.objectContaining({ info: { id: 'assistant-1' } }));
    expect(rows()).toEqual([]);
    expect(sdk.mock.calls[0][0].body.provenance).toEqual({ origin: 'fallback_redispatch' });
  });
});

describe('#1576 resolution and linkage metadata', () => {
  it('issue-1576-c5: the additive resolution wrapper reports trusted source, requested tier and auth while the old API stays route-only', async () => {
    const detailed = (resolver as unknown as Record<string, Function>).resolveModelForSessionTurnWithProvenance;
    expect(typeof detailed).toBe('function');
    const input = {
      agentId: 'build',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: { providerId: 'openrouter', modelId: 'openrouter/free' },
      requestedTier: 'cheap',
    };
    await expect(detailed(input)).resolves.toEqual({
      route: { providerID: 'openrouter', modelID: 'openrouter/free' },
      requestedSource: 'turn_override',
      requestedTier: 'cheap',
      routeAuthed: true,
    });
    await expect(resolver.resolveModelForSessionTurn(input)).resolves.toEqual({ providerID: 'openrouter', modelID: 'openrouter/free' });
  });

  it('issue-1576-c6: user message.updated links the oldest recent matching non-rejected dispatch exactly once', () => {
    const repo = new ModelProvenanceRepository();
    const rejected = repo.insert(provenance('ws_input'));
    repo.setOutcome(rejected.id, 'rejected');
    const oldestEligible = repo.insert(provenance('ws_input'));
    const newerEligible = repo.insert(provenance('ws_input'));
    const expired = repo.insert(provenance('ws_input'));
    db.prepare("UPDATE agent_turn_dispatches SET created_at = datetime('now', '-61 seconds') WHERE id = ?").run(expired.id);

    const bridge = new OpencodeStreamBridge();
    const relay = (event: unknown) => (bridge as unknown as { _relayEvent: (value: unknown) => void })._relayEvent(event);
    const event = { type: 'message.updated', properties: { info: { id: 'sdk-user-1', sessionID: 'sdk-s', role: 'user' } } };
    relay(event);
    relay(event);

    expect(repo.get(oldestEligible.id)?.sdkUserMessageId).toBe('sdk-user-1');
    expect(repo.get(newerEligible.id)?.sdkUserMessageId).toBeNull();
    expect(repo.get(rejected.id)?.sdkUserMessageId).toBeNull();
    expect(repo.get(expired.id)?.sdkUserMessageId).toBeNull();
  });

  it('issue-1576-c7: projection adds deterministic dispatches without changing existing keys', () => {
    const first = new ModelProvenanceRepository().insert(provenance('ws_input'));
    new ModelProvenanceRepository().setOutcome(first.id, 'accepted', 'sdk-user-1');
    const projection = getModelProvenance('s', 'openrouter/free') as ReturnType<typeof getModelProvenance> & { dispatches?: unknown[] };

    expect(Object.keys(projection).sort()).toEqual([
      'available', 'dispatches', 'multiModel', 'requestedModelId', 'routed', 'servedModels', 'steps',
    ]);
    expect(projection.dispatches).toEqual([
      expect.objectContaining({ id: first.id, origin: 'ws_input', outcome: 'accepted', sdkUserMessageId: 'sdk-user-1' }),
    ]);
  });

  it('issue-1576-c2 fallback: successful fallback writes an accepted row linked to its predecessor', async () => {
    const repo = new ModelProvenanceRepository();
    const first = repo.insert({ ...provenance('ws_input'), finalProviderId: 'anthropic', finalModelId: 'old-model' });
    repo.setOutcome(first.id, 'accepted');
    retainTurn('s', { sdkSessionId: 'sdk-s', data: 'retry' });
    noteUserMessage('s', 'sdk-user-old');
    beginHandoff('s');
    expect(decideHandoff('s', 'openrouter', 'openrouter/free')).toBe('proceed');

    await expect(redispatchTurn('s', {
      abort: vi.fn().mockResolvedValue(true),
      revert: vi.fn().mockResolvedValue(true),
      prepare: vi.fn().mockResolvedValue(true),
      prompt: vi.fn().mockResolvedValue(true),
      clearError: vi.fn(),
      setError: vi.fn(),
    })).resolves.toBe(true);

    expect(repo.list('s')).toEqual([
      expect.objectContaining({ id: first.id, origin: 'ws_input', outcome: 'accepted' }),
      expect.objectContaining({ origin: 'fallback_redispatch', predecessorId: first.id, outcome: 'accepted' }),
    ]);
  });
});
