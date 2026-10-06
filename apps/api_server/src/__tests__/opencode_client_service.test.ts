import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, it, expect, beforeEach, vi } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { OpencodeClientService } from '../services/opencode_client_service';
import { OpencodeAuthStore } from '../services/opencode_auth_store';

// Prompt wrapper cases are ordinary only after a positive empty-ledger lookup.
// Keep that production boundary intact rather than treating a missing test DB
// as proof that an SDK session was never managed.
let boundaryDb: Database.Database | null = null;
let previousDb: Database.Database | null = null;

beforeAll(() => {
  boundaryDb = new Database(':memory:');
  boundaryDb.pragma('foreign_keys = ON');
  runMigrations(boundaryDb);
  previousDb = setDb(boundaryDb);
});

afterAll(() => {
  setDb(previousDb);
  if (boundaryDb?.open) boundaryDb.close();
  boundaryDb = null;
  previousDb = null;
});

function makeService(stubClient: Record<string, unknown>): OpencodeClientService {
  const svc = new OpencodeClientService();
  // Bypass initialize() by injecting the client and marking ready.
  (svc as unknown as { client: unknown }).client = stubClient;
  (svc as unknown as { status: string }).status = 'ready';
  return svc;
}

describe('OpencodeClientService — SDK response unwrap (.data)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listModels unwraps res.data.providers[].models', async () => {
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: {
            providers: [
              {
                id: 'anthropic',
                models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
              },
              { id: 'openrouter', models: [] },
            ],
          },
          request: {}, response: {},
        }),
      },
    });
    expect(await svc.listModels('anthropic')).toEqual([
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    ]);
    expect(await svc.listModels('unknown')).toEqual([]);
  });

  it('listModels unwraps object maps from newer SDK provider catalogs', async () => {
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: {
            providers: [
              {
                id: 'openai',
                models: {
                  'gpt-5.4-mini': { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
                  'gpt-5.4': { name: 'GPT-5.4' },
                },
              },
            ],
          },
          request: {},
          response: {},
        }),
      },
    });
    expect(await svc.listModels('openai')).toEqual([
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4', name: 'GPT-5.4' },
    ]);
  });

  it('setAuth returns true only when res.data === true', async () => {
    const ok = makeService({
      auth: { set: vi.fn().mockResolvedValue({ data: true, request: {}, response: {} }) },
    });
    expect(await ok.setAuth('openrouter', 'sk-or-test')).toBe(true);

    const bad = makeService({
      auth: {
        set: vi.fn().mockResolvedValue({
          data: undefined,
          error: { data: { error: [{ message: 'invalid_type' }] }, success: false },
          request: {}, response: {},
        }),
      },
    });
    expect(await bad.setAuth('openrouter', 'sk-or-test')).toBe(false);
  });

  it('createSession returns { id } from res.data.id', async () => {
    const svc = makeService({
      session: {
        create: vi.fn().mockResolvedValue({
          data: { id: 'sdk-session-123' }, request: {}, response: {},
        }),
      },
    });
    expect(await svc.createSession('hello')).toEqual({ id: 'sdk-session-123' });
  });

  it('#1123 createSession adds parentID only for the optional child-session path', async () => {
    const create = vi.fn().mockResolvedValue({
      data: { id: 'sdk-child' }, request: {}, response: {},
    });
    const svc = makeService({ session: { create } });

    await svc.createSession('top-level', '/tmp');
    await svc.createSession(
      'child',
      '/tmp',
      undefined,
      undefined,
      'anthropic',
      'sdk-parent',
    );

    expect(create.mock.calls[0][0].body).toEqual({ title: 'top-level' });
    expect(create.mock.calls[1][0].body).toEqual({
      title: 'child',
      parentID: 'sdk-parent',
    });
  });

  it('accepts only a server-derived finite execution deny baseline on a fresh default child session', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'finite-child' }, request: {}, response: {} });
    const svc = makeService({ session: { create } });
    const rules = [
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: '*', action: 'deny' },
      { permission: 'external_directory', pattern: '*', action: 'deny' },
      { permission: 'edit', pattern: 'server-owned/workspace/notes/*.md', action: 'ask' },
      { permission: 'write', pattern: 'server-owned/workspace/notes/*.md', action: 'allow' },
    ] as const;
    expect(await svc.createSession(
      'finite', '/server-owned/workspace', undefined, [], 'provider-a', 'sdk-parent', 'default', false, false, rules,
    )).toEqual({ id: 'finite-child' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].body.permission).toEqual(rules);
    expect(create.mock.calls[0][0].body.parentID).toBe('sdk-parent');

    expect(await svc.createSession(
      'invalid finite', '/server-owned/workspace', undefined, [], 'provider-a', 'sdk-parent', 'default', false, false,
      [
        { permission: '*', pattern: '*', action: 'deny' },
        { permission: 'bash', pattern: '*', action: 'deny' },
        { permission: 'external_directory', pattern: '*', action: 'deny' },
        { permission: 'edit', pattern: '/server-owned/workspace/notes/*.md', action: 'allow' },
      ],
    )).toMatchObject({ error: expect.stringContaining('finite execution session scope is invalid') });
    expect(create).toHaveBeenCalledTimes(1);

    expect(await svc.createSession(
      'off-root finite', '/server-owned/workspace', undefined, [], 'provider-a', 'sdk-parent', 'default', false, false,
      [
        { permission: '*', pattern: '*', action: 'deny' },
        { permission: 'bash', pattern: '*', action: 'deny' },
        { permission: 'external_directory', pattern: '*', action: 'deny' },
        { permission: 'write', pattern: 'notes/*.md', action: 'allow' },
      ],
    )).toMatchObject({ error: expect.stringContaining('finite execution session scope is invalid') });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('prompt returns res.data on success and null on error wrapper', async () => {
    const ok = makeService({
      session: {
        prompt: vi.fn().mockResolvedValue({
          data: { info: { id: 'm1' }, parts: [{ type: 'text', text: 'hi' }] },
          request: {}, response: {},
        }),
      },
    });
    const out = await ok.prompt('sid', 'hello');
    expect(out?.info.id).toBe('m1');

    const bad = makeService({
      session: {
        prompt: vi.fn().mockResolvedValue({
          data: undefined,
          error: { data: { message: 'no model' } },
          request: {}, response: {},
        }),
      },
    });
    expect(await bad.prompt('sid', 'hello')).toBeNull();
  });

  it('promptAsync returns true only when no error', async () => {
    const ok = makeService({
      session: { promptAsync: vi.fn().mockResolvedValue({ data: {}, request: {}, response: {} }) },
    });
    expect(await ok.promptAsync('sid', 'hi')).toBe(true);

    const bad = makeService({
      session: {
        promptAsync: vi.fn().mockResolvedValue({
          data: undefined, error: { data: { message: 'fail' } }, request: {}, response: {},
        }),
      },
    });
    expect(await bad.promptAsync('sid', 'hi')).toBe(false);
  });

  describe('C2-C — beforeDispatch real prompt-boundary hook', () => {
    it('prompt(): constructs the request, then runs the hook, then calls the SDK — in that order', async () => {
      const order: string[] = [];
      const sdkPrompt = vi.fn().mockImplementation(async (args: { body: Record<string, unknown> }) => {
        order.push('sdk-call');
        // The SDK only ever observes the FULLY-CONSTRUCTED request, including
        // opts.system — never a partial body built before the hook ran.
        expect(args.body.system).toBe('the-exact-system-override');
        return { data: { info: { id: 'm1' }, parts: [] }, request: {}, response: {} };
      });
      const svc = makeService({ session: { prompt: sdkPrompt } });

      const beforeDispatch = vi.fn().mockImplementation(async () => {
        order.push('hook');
      });

      const out = await svc.prompt('sid', 'hello', undefined, undefined, {
        system: 'the-exact-system-override',
      }, beforeDispatch);

      expect(out?.info.id).toBe('m1');
      expect(order).toEqual(['hook', 'sdk-call']);
      expect(sdkPrompt).toHaveBeenCalledTimes(1);
    });

    it('prompt(): a throwing hook blocks the SDK call entirely and propagates a closed error', async () => {
      const sdkPrompt = vi.fn().mockResolvedValue({
        data: { info: { id: 'm1' }, parts: [] }, request: {}, response: {},
      });
      const svc = makeService({ session: { prompt: sdkPrompt } });

      const rawError = new Error('raw internal secret detail: db-password-123');
      const beforeDispatch = vi.fn().mockRejectedValue(rawError);

      await expect(
        svc.prompt('sid', 'hello', undefined, undefined, undefined, beforeDispatch),
      ).rejects.toThrow();
      let caught: unknown;
      try {
        await svc.prompt('sid', 'hello', undefined, undefined, undefined, beforeDispatch);
      } catch (err) {
        caught = err;
      }
      expect(String(caught)).not.toContain('db-password-123');
      expect(sdkPrompt).not.toHaveBeenCalled();
    });

    it('prompt(): omitting beforeDispatch leaves existing behavior byte-for-byte unchanged', async () => {
      const sdkPrompt = vi.fn().mockResolvedValue({
        data: { info: { id: 'm1' }, parts: [{ type: 'text', text: 'hi' }] }, request: {}, response: {},
      });
      const svc = makeService({ session: { prompt: sdkPrompt } });
      const out = await svc.prompt('sid', 'hello');
      expect(out?.info.id).toBe('m1');
      expect(sdkPrompt).toHaveBeenCalledTimes(1);
    });

    it('promptAsync(): constructs the request, then runs the hook, then calls the SDK — in that order', async () => {
      const order: string[] = [];
      const sdkPromptAsync = vi.fn().mockImplementation(async (args: { body: Record<string, unknown> }) => {
        order.push('sdk-call');
        expect(args.body.system).toBe('the-exact-system-override');
        return { data: {}, request: {}, response: {} };
      });
      const svc = makeService({ session: { promptAsync: sdkPromptAsync } });

      const beforeDispatch = vi.fn().mockImplementation(async () => {
        order.push('hook');
      });

      const ok = await svc.promptAsync(
        'sid',
        'hi',
        undefined,
        undefined,
        { system: 'the-exact-system-override' },
        undefined,
        beforeDispatch,
      );

      expect(ok).toBe(true);
      expect(order).toEqual(['hook', 'sdk-call']);
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
    });

    it('promptAsync(): a throwing hook blocks the SDK call entirely and propagates a closed error', async () => {
      const sdkPromptAsync = vi.fn().mockResolvedValue({ data: {}, request: {}, response: {} });
      const svc = makeService({ session: { promptAsync: sdkPromptAsync } });

      const beforeDispatch = vi.fn().mockRejectedValue(new Error('raw internal secret detail'));

      await expect(
        svc.promptAsync('sid', 'hi', undefined, undefined, undefined, undefined, beforeDispatch),
      ).rejects.toThrow();
      expect(sdkPromptAsync).not.toHaveBeenCalled();
    });

    it('promptAsync(): omitting beforeDispatch leaves existing behavior byte-for-byte unchanged', async () => {
      const sdkPromptAsync = vi.fn().mockResolvedValue({ data: {}, request: {}, response: {} });
      const svc = makeService({ session: { promptAsync: sdkPromptAsync } });
      expect(await svc.promptAsync('sid', 'hi')).toBe(true);
      expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('C2 foreground durable ordinary dispatch', () => {
    it('mints the native user-message id, reserves the exact authenticated dispatch before the SDK call, and settles it only from SDK acknowledgement', async () => {
      const sessionId = 'c2-root-dispatch';
      const sdkSessionId = 'sdk-c2-dispatch';
      boundaryDb!.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(sessionId);
      boundaryDb!.prepare('DELETE FROM agent_sessions WHERE id=?').run(sessionId);
      boundaryDb!.prepare(`INSERT INTO agent_sessions (id, sdk_session_id, agent_kind, cwd, name)
        VALUES (?, ?, 'build', '/safe/c2', 'C2 root')`).run(sessionId, sdkSessionId);
      const callbacks: string[] = [];
      const sdkPromptAsync = vi.fn(async (input: { body: Record<string, unknown> }) => {
        expect(input.body.messageID).toBe('native-user-c2');
        expect(new ModelProvenanceRepository().list(sessionId)).toEqual([
          expect.objectContaining({
            sdkSessionId,
            sdkUserMessageId: 'native-user-c2',
            origin: 'prompt_api',
            requestedSource: 'session',
            routeAuthed: true,
            outcome: 'pending',
          }),
        ]);
        return { response: { status: 204 } };
      });
      const svc = makeService({ session: { promptAsync: sdkPromptAsync } });
      (svc as unknown as { server: { url: string; close(): void } }).server = {
        url: 'http://engine.test', close() {},
      };
      const shouldBindDayflow = vi.fn(async () => true);
      svc.setDayflowSdkHistoryGuard({
        shouldBindPrompt: shouldBindDayflow,
        revalidateBeforeSdk: async () => true,
      });
      const previousExports = process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
      process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '1';
      const fetcher = vi.fn(async (url: string) => {
        expect(url).toBe(`http://engine.test/session/${sdkSessionId}/rhythm-prompt-anchor?directory=%2Fsafe%2Fc2`);
        return { ok: true, json: async () => ({ messageID: 'native-user-c2' }) };
      });
      vi.stubGlobal('fetch', fetcher);
      try {
        await expect(svc.promptAsync(
          sdkSessionId,
          'ordinary C2 message',
          { providerID: 'provider-c2', modelID: 'model-c2' },
          '/safe/c2',
          undefined,
          undefined,
          undefined,
          {
            sessionId,
            sdkSessionId,
            origin: 'prompt_api',
            requestedSource: 'session',
            requestedProviderId: 'provider-c2',
            requestedModelId: 'model-c2',
            resolvedProviderId: 'provider-c2',
            resolvedModelId: 'model-c2',
            finalProviderId: 'provider-c2',
            finalModelId: 'model-c2',
            routeAuthed: true,
            reasonCode: 'c2_foreground',
          },
          undefined,
          {
            kind: 'coordinator_foreground_v1',
            actorUserId: 7,
            localSessionId: sessionId,
            sdkSessionId,
            projectId: 'project-c2',
            profileId: 'profile-c2',
            controlRevision: 4,
            commandKey: 'ordinary-c2-command',
            validate: ({ phase, dispatchId, sdkUserMessageId }) => {
              callbacks.push(phase);
              if (phase !== 'prepare') {
                expect(dispatchId).toEqual(expect.any(String));
                expect(sdkUserMessageId).toBe('native-user-c2');
              }
              return true;
            },
          },
        )).resolves.toBe(true);
        expect(callbacks).toEqual(['prepare', 'before_sdk', 'sdk_exposure']);
        expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
        // The C2 dispatch anchor is also the qualified Dayflow receiving
        // anchor. No second synthetic message may be minted for one turn.
        expect(shouldBindDayflow).toHaveBeenCalledWith(sdkSessionId);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(new ModelProvenanceRepository().list(sessionId)).toEqual([
          expect.objectContaining({ sdkUserMessageId: 'native-user-c2', outcome: 'accepted' }),
        ]);
      } finally {
        vi.unstubAllGlobals();
        if (previousExports === undefined) delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
        else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = previousExports;
        boundaryDb!.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(sessionId);
        boundaryDb!.prepare('DELETE FROM agent_sessions WHERE id=?').run(sessionId);
      }
    });

    it('holds a revoked C2 foreground reservation after its durable row is written and before any SDK exposure', async () => {
      const sessionId = 'c2-root-revoked';
      const sdkSessionId = 'sdk-c2-revoked';
      boundaryDb!.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(sessionId);
      boundaryDb!.prepare('DELETE FROM agent_sessions WHERE id=?').run(sessionId);
      boundaryDb!.prepare(`INSERT INTO agent_sessions (id, sdk_session_id, agent_kind, cwd, name)
        VALUES (?, ?, 'build', '/safe/c2', 'C2 root')`).run(sessionId, sdkSessionId);
      const sdkPromptAsync = vi.fn();
      const svc = makeService({ session: { promptAsync: sdkPromptAsync } });
      (svc as unknown as { server: { url: string; close(): void } }).server = {
        url: 'http://engine.test', close() {},
      };
      const previousExports = process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
      process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '1';
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ messageID: 'native-user-revoked' }) })));
      try {
        await expect(svc.promptAsync(
          sdkSessionId,
          'hold after revocation',
          { providerID: 'provider-c2', modelID: 'model-c2' },
          '/safe/c2',
          undefined,
          undefined,
          undefined,
          {
            sessionId,
            sdkSessionId,
            origin: 'prompt_api',
            requestedSource: 'session',
            routeAuthed: true,
          },
          undefined,
          {
            kind: 'coordinator_foreground_v1',
            actorUserId: 7,
            localSessionId: sessionId,
            sdkSessionId,
            projectId: 'project-c2',
            profileId: 'profile-c2',
            controlRevision: 4,
            commandKey: 'revoked-command',
            validate: ({ phase }) => phase !== 'sdk_exposure',
          },
        )).resolves.toBe(false);
        expect(sdkPromptAsync).not.toHaveBeenCalled();
        expect(new ModelProvenanceRepository().list(sessionId)).toEqual([
          expect.objectContaining({ sdkUserMessageId: 'native-user-revoked', outcome: 'rejected' }),
        ]);
      } finally {
        vi.unstubAllGlobals();
        if (previousExports === undefined) delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
        else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = previousExports;
        boundaryDb!.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(sessionId);
        boundaryDb!.prepare('DELETE FROM agent_sessions WHERE id=?').run(sessionId);
      }
    });
  });

  it('abortSession returns true when error is absent', async () => {
    const ok = makeService({
      session: { abort: vi.fn().mockResolvedValue({ data: true, request: {}, response: {} }) },
    });
    expect(await ok.abortSession('sid')).toBe(true);

    const bad = makeService({
      session: {
        abort: vi.fn().mockResolvedValue({
          data: undefined, error: { data: { message: 'not found' } }, request: {}, response: {},
        }),
      },
    });
    expect(await bad.abortSession('sid')).toBe(false);
  });

  it('getOAuthUrl unwraps res.data.{url, method, instructions}', async () => {
    const svc = makeService({
      provider: {
        oauth: {
          authorize: vi.fn().mockResolvedValue({
            data: {
              url: 'https://auth.openai.com/oauth/authorize?response_type=code',
              method: 'auto',
              instructions: 'Complete authorization in your browser.',
            },
            request: {}, response: {},
          }),
        },
      },
    });
    expect(await svc.getOAuthUrl('openai', 0)).toEqual({
      url: 'https://auth.openai.com/oauth/authorize?response_type=code',
      method: 'auto',
      instructions: 'Complete authorization in your browser.',
    });
  });

  it('getOAuthUrl returns { error } when SDK wrapper has error.data.message', async () => {
    const svc = makeService({
      provider: {
        oauth: {
          authorize: vi.fn().mockResolvedValue({
            data: undefined,
            error: { data: { message: 'TypeError: m[d.providerID].methods is undefined' } },
            request: {}, response: {},
          }),
        },
      },
    });
    expect(await svc.getOAuthUrl('anthropic', 0)).toEqual({
      error: 'TypeError: m[d.providerID].methods is undefined',
    });
  });

  it('handleOAuthCallback returns true only when res.data === true', async () => {
    const ok = makeService({
      provider: {
        oauth: {
          callback: vi.fn().mockResolvedValue({ data: true, request: {}, response: {} }),
        },
      },
    });
    expect(await ok.handleOAuthCallback('openai', 'code-123')).toBe(true);

    const bad = makeService({
      provider: {
        oauth: {
          callback: vi.fn().mockResolvedValue({
            data: undefined,
            error: { data: { message: 'bad code' } },
            request: {}, response: {},
          }),
        },
      },
    });
    expect(await bad.handleOAuthCallback('openai', 'code-123')).toBe(false);
  });

  it('setOAuthCredentials returns true only when res.data === true', async () => {
    const ok = makeService({
      auth: { set: vi.fn().mockResolvedValue({ data: true, request: {}, response: {} }) },
    });
    expect(
      await ok.setOAuthCredentials('anthropic', { access: 'a', refresh: 'r', expires: 1 }),
    ).toBe(true);
    const setMock = ((ok as unknown as { client: { auth: { set: ReturnType<typeof vi.fn> } } }).client.auth.set);
    expect(setMock).toHaveBeenCalledWith({
      path: { id: 'anthropic' },
      body: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 },
    });

    const bad = makeService({
      auth: {
        set: vi.fn().mockResolvedValue({
          data: undefined,
          error: { data: { message: 'rejected' } },
          request: {}, response: {},
        }),
      },
    });
    expect(
      await bad.setOAuthCredentials('anthropic', { access: 'a', refresh: 'r', expires: 1 }),
    ).toBe(false);
  });
});

describe('OpencodeClientService.listAuthedProviders', () => {
  it('delegates to OpencodeAuthStore.listAuthedProviders', async () => {
    const fakeStore: Pick<OpencodeAuthStore, 'listAuthedProviders'> = {
      listAuthedProviders: vi.fn().mockReturnValue(['openrouter', 'anthropic']),
    };
    const svc = makeService({});
    (svc as unknown as { authStore: typeof fakeStore }).authStore = fakeStore;
    expect(await svc.listAuthedProviders()).toEqual(['openrouter', 'anthropic']);
  });

  it('includes configured ollama without an auth-store entry', async () => {
    const fakeStore: Pick<OpencodeAuthStore, 'listAuthedProviders'> = {
      listAuthedProviders: vi.fn().mockReturnValue(['anthropic']),
    };
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: { providers: [{ id: 'anthropic' }, { id: 'ollama' }] },
        }),
      },
    });
    (svc as unknown as { authStore: typeof fakeStore }).authStore = fakeStore;

    expect(await svc.listAuthedProviders()).toEqual(['anthropic', 'ollama']);
  });

  it('does not include ollama when it is absent from the live provider catalog', async () => {
    const fakeStore: Pick<OpencodeAuthStore, 'listAuthedProviders'> = {
      listAuthedProviders: vi.fn().mockReturnValue(['anthropic']),
    };
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: { providers: [{ id: 'anthropic' }] },
        }),
      },
    });
    (svc as unknown as { authStore: typeof fakeStore }).authStore = fakeStore;

    expect(await svc.listAuthedProviders()).toEqual(['anthropic']);
  });

  it('#868 includes configured omlx without an auth-store entry, same as ollama', async () => {
    const fakeStore: Pick<OpencodeAuthStore, 'listAuthedProviders'> = {
      listAuthedProviders: vi.fn().mockReturnValue(['anthropic']),
    };
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: { providers: [{ id: 'anthropic' }, { id: 'omlx' }] },
        }),
      },
    });
    (svc as unknown as { authStore: typeof fakeStore }).authStore = fakeStore;

    expect(await svc.listAuthedProviders()).toEqual(['anthropic', 'omlx']);
  });

  it('#868 does not include omlx when it is absent from the live provider catalog (feature-flag off)', async () => {
    const fakeStore: Pick<OpencodeAuthStore, 'listAuthedProviders'> = {
      listAuthedProviders: vi.fn().mockReturnValue(['anthropic']),
    };
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: { providers: [{ id: 'anthropic' }] },
        }),
      },
    });
    (svc as unknown as { authStore: typeof fakeStore }).authStore = fakeStore;

    expect(await svc.listAuthedProviders()).toEqual(['anthropic']);
  });
});
