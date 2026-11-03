/**
 * OpencodeClientService owned-engine adapters for the C0 provider contract
 * (frame read, durable enrollment), the projected-load ingress and the callback
 * native-anchor mint. The SDK and `fetch` are stubs: these are request-shape and
 * fail-closed tests, not live engine proof.
 */
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { ENROLLMENT_REQUEST_BODY } from '../contracts/dayflow_provider_admission_contract';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { OpencodeClientService } from '../services/opencode_client_service';
import { nonce, request } from './helpers/dayflow_provider_harness';

let db: Database.Database;
let previousDb: Database.Database | null;
beforeAll(() => {
  db = new Database(':memory:');
  runMigrations(db);
  previousDb = setDb(db);
});
afterAll(() => { setDb(previousDb); db.close(); });

const SDK = 'sdk-provider-client';
const ROOT = 'provider-client-root';
const MARKER = 'c2_goal_callback:dg-client';

function service(sdk: Record<string, unknown> = {}): OpencodeClientService {
  const svc = new OpencodeClientService();
  (svc as unknown as { client: unknown }).client = { session: sdk };
  (svc as unknown as { status: string }).status = 'ready';
  (svc as unknown as { server: unknown }).server = { url: 'http://engine.test', close() {} };
  return svc;
}

function pendingExport(req = request()) {
  return {
    schemaVersion: 1, status: 'pending', request: req, agentName: 'secretary', userKind: 'authored',
    initiatingUserMessageId: null, inputGroupCount: 3, originCoverage: 'complete',
    sourceProofs: [{ sourceAnchorId: 'msg_1', stored: true, visible: true, relation: 'before_current', derivedSummaryIds: [] }],
  };
}

const reply = (body: unknown, ok = true) => ({ ok, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

describe('owned-engine frame and enrollment adapters', () => {
  const previous = process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
  beforeEach(() => { process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '1'; });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (previous === undefined) delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
    else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = previous;
  });

  it('reads the frame with the exact URL, no body, a redirect refusal and the 2 s deadline', async () => {
    const req = request();
    const fetcher = vi.fn(async () => reply(pendingExport(req)));
    vi.stubGlobal('fetch', fetcher);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const frame = await service().getDayflowProviderFrame(SDK, req.requestNonce, '/safe/dir', ['msg_1', 'msg_2']);
    expect(frame).toMatchObject({ status: 'pending', request: req });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `http://engine.test/session/${SDK}/rhythm-provider-frame/${req.requestNonce}?directory=%2Fsafe%2Fdir&sourceAnchorIds=${encodeURIComponent('["msg_1","msg_2"]')}`,
    );
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('error');
    expect(timeout).toHaveBeenCalledWith(2000);
  });

  it('returns the unavailable statuses verbatim and null for everything else', async () => {
    for (const status of ['cancelled', 'replaced', 'not_pending']) {
      vi.stubGlobal('fetch', vi.fn(async () => reply({ schemaVersion: 1, status })));
      expect(await service().getDayflowProviderFrame(SDK, nonce(), undefined)).toEqual({ schemaVersion: 1, status });
    }
    const cases: Array<[string, () => unknown]> = [
      ['non-ok', () => reply(pendingExport(), false)],
      ['malformed', () => reply('{nope')],
      ['extra key', () => reply({ ...pendingExport(), extra: 1 })],
      ['oversize', () => reply(JSON.stringify({ ...pendingExport(), pad: 'x'.repeat(33_000) }))],
      ['network error', () => { throw new Error('down'); }],
    ];
    for (const [name, respond] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => respond()));
      expect(await service().getDayflowProviderFrame(SDK, nonce(), undefined), name).toBeNull();
    }
  });

  it('is unavailable (no fetch) when exports are disabled, the engine is not owned, or anchors exceed the bound', async () => {
    const fetcher = vi.fn(async () => reply(pendingExport()));
    vi.stubGlobal('fetch', fetcher);
    expect(await service().getDayflowProviderFrame(SDK, nonce(), undefined, Array.from({ length: 65 }, (_, i) => `m${i}`))).toBeNull();
    const unowned = service();
    (unowned as unknown as { server: unknown }).server = undefined;
    expect(await unowned.getDayflowProviderFrame(SDK, nonce(), undefined)).toBeNull();
    process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '0';
    expect(await service().getDayflowProviderFrame(SDK, nonce(), undefined)).toBeNull();
    expect(await service().enrollDayflowGuard(SDK, undefined)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enrolls with the exact POST body and succeeds only on the exact echoed reply', async () => {
    const ok = { schemaVersion: 1, sdkSessionId: SDK, engineGeneration: 'engine_1', guarded: true };
    const fetcher = vi.fn(async () => reply(ok));
    vi.stubGlobal('fetch', fetcher);
    expect(await service().enrollDayflowGuard(SDK, '/safe/dir')).toEqual({ engineGeneration: 'engine_1' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://engine.test/session/${SDK}/rhythm-dayflow-guard?directory=%2Fsafe%2Fdir`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(ENROLLMENT_REQUEST_BODY));
    expect(init.body).toBe('{"schemaVersion":1,"guarded":true}');
    expect(init.redirect).toBe('error');
    for (const bad of [
      reply(ok, false), reply('nope'), reply({ ...ok, guarded: false }), reply({ ...ok, sdkSessionId: 'other' }),
      reply({ ...ok, extra: 1 }), reply({ schemaVersion: 1 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => bad));
      expect(await service().enrollDayflowGuard(SDK, undefined)).toBeNull();
    }
  });
});

describe('projected-load ingress and callback native anchor', () => {
  const previous = process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
  const provenance = new ModelProvenanceRepository();

  function seedRoot(withHistory: boolean): void {
    db.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(ROOT);
    db.prepare('DELETE FROM agent_sessions WHERE id=?').run(ROOT);
    db.prepare(`INSERT INTO agent_sessions (id, sdk_session_id, agent_kind, cwd, name) VALUES (?, ?, 'build', '/safe/c2', 'root')`).run(ROOT, SDK);
    if (withHistory) {
      db.prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_dependency_revalidation_failed',
        dayflow_context_nonreuse_at='2026-10-06T00:00:00.000Z' WHERE id=?`).run(ROOT);
    }
  }
  beforeEach(() => {
    process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '1';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ messageID: 'native-user-x' }) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (previous === undefined) delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
    else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = previous;
    db.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(ROOT);
    db.prepare('DELETE FROM agent_sessions WHERE id=?').run(ROOT);
  });

  const foregroundProvenance = () => ({
    sessionId: ROOT, sdkSessionId: SDK, origin: 'prompt_api' as const, requestedSource: 'session' as const,
    routeAuthed: true, reasonCode: 'c2_foreground',
  });
  const foregroundContext = () => ({
    kind: 'coordinator_foreground_v1' as const, actorUserId: 7, localSessionId: ROOT, sdkSessionId: SDK, projectId: 'p',
    profileId: 'profile', controlRevision: 1, commandKey: 'k', validate: () => true,
  });
  const callbackProvenance = (reasonCode = MARKER) => ({
    sessionId: ROOT, sdkSessionId: SDK, origin: 'delegation_completion' as const, requestedSource: 'agent_config' as const,
    routeAuthed: null, reasonCode,
  });
  const callbackContext = () => ({ kind: 'coordinator_callback_v1' as const, validate: () => true });
  const guard = (over: Record<string, unknown> = {}) => ({
    shouldBindPrompt: async () => true,
    revalidateBeforeSdk: async () => false,
    revalidateForProjectedLoad: async () => true,
    ...over,
  });

  async function foregroundPrompt(svc: OpencodeClientService) {
    return svc.promptAsync(SDK, 'hi', undefined, '/safe/c2', undefined, undefined, undefined,
      foregroundProvenance() as never, undefined, foregroundContext());
  }
  async function callbackPrompt(svc: OpencodeClientService, reasonCode?: string) {
    return svc.promptAsync(SDK, 'hi', undefined, '/safe/c2', undefined, undefined, undefined,
      callbackProvenance(reasonCode) as never, undefined, undefined, callbackContext());
  }

  it('enqueues a typed foreground for a projected provider request only when the guard proves it', async () => {
    seedRoot(true);
    const promptAsync = vi.fn(async () => ({ response: { status: 204 } }));
    const withProof = service({ promptAsync });
    withProof.setDayflowSdkHistoryGuard(guard() as never);
    expect(await foregroundPrompt(withProof)).toBe(true);
    expect(promptAsync).toHaveBeenCalledTimes(1);
    // nothing about the sticky marker or stored history was changed by the ingress
    expect(db.prepare('SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id=?').get(ROOT))
      .toEqual({ code: 'dayflow_dependency_revalidation_failed' });

    promptAsync.mockClear();
    seedRoot(true);
    const refusals: Array<Record<string, unknown>> = [
      { revalidateForProjectedLoad: async () => false },
      { revalidateForProjectedLoad: undefined },
      { revalidateForProjectedLoad: async () => { throw new Error('no'); } },
    ];
    for (const over of refusals) {
      const svc = service({ promptAsync });
      svc.setDayflowSdkHistoryGuard(guard(over) as never);
      expect(await foregroundPrompt(svc)).toBe(false);
    }
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('keeps raw-history reuse unchanged: a guard that revalidates raw history still passes, and an untyped call still holds', async () => {
    seedRoot(true);
    const promptAsync = vi.fn(async () => ({ response: { status: 204 } }));
    const raw = service({ promptAsync });
    raw.setDayflowSdkHistoryGuard(guard({ revalidateBeforeSdk: async () => true, revalidateForProjectedLoad: undefined }) as never);
    expect(await foregroundPrompt(raw)).toBe(true);

    promptAsync.mockClear();
    const untyped = service({ promptAsync });
    untyped.setDayflowSdkHistoryGuard(guard() as never);
    expect(await untyped.promptAsync(SDK, 'hi', undefined, '/safe/c2', undefined, undefined, undefined,
      { sessionId: ROOT, sdkSessionId: SDK, origin: 'prompt_api', requestedSource: 'session', routeAuthed: true } as never)).toBe(false);
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('mints the real native user message for an exact callback, persists it in the row and puts it in the SDK body', async () => {
    seedRoot(false);
    const promptAsync = vi.fn(async (input: { body: Record<string, unknown> }) => {
      expect(input.body.messageID).toBe('native-user-x');
      return { response: { status: 204 } };
    });
    const svc = service({ promptAsync });
    svc.setDayflowSdkHistoryGuard(guard({ revalidateBeforeSdk: async () => true }) as never);
    expect(await callbackPrompt(svc)).toBe(true);
    expect(provenance.list(ROOT)).toEqual([
      expect.objectContaining({ sdkUserMessageId: 'native-user-x', origin: 'delegation_completion', routeAuthed: null, outcome: 'accepted' }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses (no SDK call, no row) when a receiver applies but the native anchor cannot be minted', async () => {
    seedRoot(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const promptAsync = vi.fn();
    const svc = service({ promptAsync });
    svc.setDayflowSdkHistoryGuard(guard({ revalidateBeforeSdk: async () => true }) as never);
    expect(await callbackPrompt(svc)).toBe(false);
    expect(promptAsync).not.toHaveBeenCalled();
    expect(provenance.list(ROOT)).toEqual([]);
  });

  it('leaves a callback on a root with no Dayflow receiver, or with no guard composed, exactly as before', async () => {
    for (const composed of [false, true]) {
      seedRoot(false);
      const promptAsync = vi.fn(async (input: { body: Record<string, unknown> }) => {
        expect(input.body.messageID).toBeUndefined();
        return { response: { status: 204 } };
      });
      const svc = service({ promptAsync });
      if (composed) svc.setDayflowSdkHistoryGuard(guard({ shouldBindPrompt: async () => false, revalidateBeforeSdk: async () => true }) as never);
      expect(await callbackPrompt(svc)).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      db.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(ROOT);
    }
  });

  it('rejects a callback whose provenance is not the exact marker, and never lets a callback start a child', async () => {
    seedRoot(false);
    const promptAsync = vi.fn();
    const svc = service({ promptAsync });
    svc.setDayflowSdkHistoryGuard(guard() as never);
    expect(await callbackPrompt(svc, 'c2_goal_callback')).toBe(false);
    expect(await callbackPrompt(svc, 'c2_foreground')).toBe(false);
    expect(promptAsync).not.toHaveBeenCalled();
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_async_delegations').get() as { n: number }).n).toBe(0);
  });
});
