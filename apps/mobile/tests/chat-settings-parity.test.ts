import { act, fireEvent, render } from '@testing-library/react-native';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { PaperProvider } from 'react-native-paper';

import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
import { Colors } from '@/constants/theme';
import {
  changesProfileOrApproval,
  defaultChatPreferences,
  diffSessionSettings,
  hydratePreferencesFromSession,
  parseSessionSettingsState,
  replaceSessionExecutionState,
  sessionSettingsKey,
  type ChatPreferences,
  type SessionExecutionState,
  type SessionSettingsTarget,
} from '@/providers/opencode-provider-utils';
import {
  getMobileSessionSettings,
  patchMobileSessionSettings,
} from '@/providers/services/mobile-gateway-service';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

const PROJECT = 'project-example';
const PRIMARY: SessionSettingsTarget = { identity: 'local-primary', id: 'local-primary-example' };
const SDK: SessionSettingsTarget = { identity: 'sdk', id: 'sdk-example' };

// Synthetic frozen-contract fixtures (rhythm-chat-settings-wire-fixtures.json).
const primaryState = (overrides: Record<string, unknown> = {}) => ({
  settingsContractVersion: 1,
  settingsIdentity: 'local-primary',
  localSessionId: PRIMARY.id,
  sdkSessionId: null,
  profileId: 'secretary-example',
  opencodeAgentId: 'secretary-native-example',
  profileAvailability: 'available',
  providerId: 'authorized-provider-example',
  modelId: 'authorized-model-example',
  modelMode: 'fixed',
  routerDecidedAt: null,
  thinkingBudget: 2048,
  permissionMode: 'plan',
  fastMode: false,
  ...overrides,
});
const sdkState = (overrides: Record<string, unknown> = {}) => primaryState({
  settingsIdentity: 'sdk', localSessionId: 'ordinary-local-example', sdkSessionId: SDK.id, ...overrides,
});

function fakeClient(responder: (path: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => unknown) {
  const requests: { path: string; method?: string; headers?: Record<string, string>; body?: string }[] = [];
  const client = {
    request: async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
      requests.push({ path, ...init });
      return responder(path, init);
    },
  };
  return { client: client as never, requests };
}

describe('settings contract v1 HTTP adapter (actual service)', () => {
  test('GET uses the exact identity selector and project header and accepts the frozen primary shape', async () => {
    const { client, requests } = fakeClient(() => primaryState());
    const state = await getMobileSessionSettings(client, PROJECT, PRIMARY);
    expect(requests).toEqual([{
      path: '/mobile-gateway/sessions/local-primary-example/state?identity=local-primary',
      method: 'GET',
      headers: { 'X-Rhythm-Project-ID': PROJECT },
    }]);
    expect(state).toMatchObject({ sdkSessionId: null, fastMode: false, thinkingBudget: 2048 });
  });

  test.each([
    ['legacy response without version', (() => { const { settingsContractVersion: _v, settingsIdentity: _i, fastMode: _f, ...legacy } = primaryState(); return legacy; })()],
    ['wrong version', primaryState({ settingsContractVersion: 2 })],
    ['wrong identity echo', primaryState({ settingsIdentity: 'sdk' })],
    ['wrong local id echo', primaryState({ localSessionId: 'someone-else' })],
    ['missing fast', (() => { const { fastMode: _f, ...rest } = primaryState(); return rest; })()],
    ['negative reasoning', primaryState({ thinkingBudget: -1 })],
    ['unknown model mode', primaryState({ modelMode: 'router' })],
    ['null', null],
  ])('GET rejects %s so the editor stays disabled', async (_label, response) => {
    const { client } = fakeClient(() => response);
    await expect(getMobileSessionSettings(client, PROJECT, PRIMARY)).rejects.toThrow();
  });

  // Sol confirmed diagnostics (preserved assertions) + exact v1 positives.
  test('Sol v1 primary requires SDK identity presence even when null', () => {
    const { sdkSessionId: _s, ...missing } = primaryState();
    expect(parseSessionSettingsState(missing, PRIMARY)).toBeUndefined();
  });
  test('Sol v1 SDK response requires canonical local identity', () => {
    const { localSessionId: _l, ...missing } = sdkState();
    expect(parseSessionSettingsState(missing, SDK)).toBeUndefined();
  });
  test('Sol v1 primary rejects nonstring nonnull SDK identity', () => {
    expect(parseSessionSettingsState(primaryState({ sdkSessionId: 7 }), PRIMARY)).toBeUndefined();
  });
  test('exact v1 positives: primary with null SDK, SDK with its exact echo, and a blank local id is rejected', () => {
    expect(parseSessionSettingsState(primaryState(), PRIMARY)).toBeDefined();
    expect(parseSessionSettingsState(sdkState(), SDK)).toBeDefined();
    expect(parseSessionSettingsState(sdkState({ localSessionId: '' }), SDK)).toBeUndefined();
    expect(parseSessionSettingsState(sdkState({ localSessionId: 5 }), SDK)).toBeUndefined();
    expect(parseSessionSettingsState(sdkState({ sdkSessionId: null }), SDK)).toBeUndefined();
  });

  test('an sdk read must echo the requested SDK id', async () => {
    const { client } = fakeClient(() => sdkState({ sdkSessionId: 'another-sdk' }));
    await expect(getMobileSessionSettings(client, PROJECT, SDK)).rejects.toThrow();
    expect(parseSessionSettingsState(sdkState(), SDK)).toBeDefined();
  });

  test('PATCH sends exactly the partial body and returns the server readback; a bad response is not applied', async () => {
    const body = { modelMode: 'fixed', providerId: 'authorized-provider-example', modelId: 'another-authorized-model-example' };
    const { client, requests } = fakeClient(() => primaryState({ modelId: 'another-authorized-model-example' }));
    const state = await patchMobileSessionSettings(client, PROJECT, PRIMARY, body as never);
    expect(requests[0]).toMatchObject({
      path: '/mobile-gateway/sessions/local-primary-example/state?identity=local-primary',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Rhythm-Project-ID': PROJECT },
    });
    expect(JSON.parse(requests[0].body ?? '')).toEqual(body);
    expect(state.modelId).toBe('another-authorized-model-example');
    const bad = fakeClient(() => ({ ...primaryState(), settingsIdentity: 'sdk' }));
    await expect(patchMobileSessionSettings(bad.client, PROJECT, PRIMARY, { fastMode: true })).rejects.toThrow();
  });
});

describe('explicit-edit diff and hydration (actual utils)', () => {
  const base: ChatPreferences = {
    ...defaultChatPreferences,
    profileId: 'secretary-example' as never,
    mode: 'secretary-native-example' as never,
    providerId: 'authorized-provider-example',
    modelId: 'authorized-provider-example/authorized-model-example',
    modelMode: 'fixed',
    reasoning: 'low', // displays the exact stored 2048 budget
    permissionMode: 'plan',
    autoApprove: false,
    fastMode: false,
  };

  test('a fixed-model-only edit omits reasoning, Fast, profile and approval (exact 2048 stays untouched)', () => {
    expect(diffSessionSettings(base, {
      ...base, modelId: 'authorized-provider-example/another-authorized-model-example', modelMode: 'fixed',
    }, { fastSupported: true })).toEqual({
      modelMode: 'fixed', providerId: 'authorized-provider-example', modelId: 'another-authorized-model-example',
    });
  });

  test('Auto is exactly modelMode auto and never carries the fallback tuple', () => {
    expect(diffSessionSettings(base, { ...base, modelMode: 'auto' }, { fastSupported: true })).toEqual({ modelMode: 'auto' });
  });

  test('reasoning and Fast change only on an explicit edit; unknown Fast never produces a write', () => {
    expect(diffSessionSettings(base, { ...base, reasoning: 'default' }, { fastSupported: true })).toEqual({ thinkingBudget: null });
    expect(diffSessionSettings(base, { ...base, fastMode: true }, { fastSupported: true })).toEqual({ fastMode: true });
    expect(diffSessionSettings({ ...base, fastMode: true }, { ...base, fastMode: false }, { fastSupported: true })).toEqual({ fastMode: false });
    expect(diffSessionSettings({ ...base, fastMode: undefined }, { ...base, fastMode: undefined }, { fastSupported: true })).toEqual({});
    expect(diffSessionSettings(base, { ...base, fastMode: true }, { fastSupported: false })).toEqual({});
    expect(diffSessionSettings(base, base, { fastSupported: true })).toEqual({});
  });

  test('profile or approval edits are detected so they never ride the settings-only body', () => {
    expect(changesProfileOrApproval(base, { ...base, permissionMode: 'default' })).toBe(true);
    expect(changesProfileOrApproval(base, { ...base, profileId: 'other' as never })).toBe(true);
    expect(changesProfileOrApproval(base, { ...base, fastMode: true })).toBe(false);
  });

  test('hydration keeps unknown Fast unknown and never inherits another chat’s Fast', () => {
    const legacy = { ...primaryState() } as Record<string, unknown>;
    delete legacy.fastMode;
    expect(hydratePreferencesFromSession(legacy as unknown as SessionExecutionState, { ...base, fastMode: true }).fastMode).toBeUndefined();
    expect(hydratePreferencesFromSession(primaryState({ fastMode: true }) as unknown as SessionExecutionState, base).fastMode).toBe(true);
  });
});

function extractCallback(file: string, name: string): (environment: Record<string, unknown>) => (...args: unknown[]) => unknown {
  const path = resolve(process.cwd(), file);
  const source = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      initializer = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!initializer) throw new Error(`Actual ${name} is unavailable.`);
  const compiled = ts.transpileModule(`const action = ${initializer.getText(ast)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return (environment) => new Function('environment', `with (environment) { ${compiled}; return action; }`)(environment);
}

describe('actual provider settings handlers', () => {
  function providerEnvironment(options: { entry?: unknown; responder?: () => unknown } = {}) {
    const client = fakeClient(options.responder ?? (() => primaryState({ modelId: 'new-model' })));
    const calls = { settings: [] as unknown[], sessions: 0, preferences: 0 };
    const env: Record<string, unknown> = {
      pairedHostClientRef: { current: client.client },
      activeProjectPathRef: { current: PROJECT },
      sessionSettingsRef: { current: { [sessionSettingsKey(PROJECT, PRIMARY)]: options.entry ?? { status: 'ready', state: primaryState() } } },
      currentSessionIdRef: { current: SDK.id },
      settingsOrderRef: { current: new Map<string, number>() },
      settingsPendingRef: { current: new Map<string, number>() },
      sessionSettingsKey,
      getMobileSessionSettings,
      patchMobileSessionSettings,
      trackMacOffline: (operation: () => Promise<unknown>) => operation(),
      replaceSessionExecutionState,
      hydratePreferencesFromSession,
      setSessionSettings: () => { calls.settings.push(true); },
      setSessions: () => { calls.sessions += 1; },
      setChatPreferences: () => { calls.preferences += 1; },
    };
    return { env, calls, requests: client.requests };
  }
  const update = (env: Record<string, unknown>) => extractCallback('providers/opencode-provider.tsx', 'updateSessionSettings')(env) as
    (target: SessionSettingsTarget, patch: Record<string, unknown>, isCurrent?: () => boolean) => Promise<SessionExecutionState>;
  const load = (env: Record<string, unknown>) => extractCallback('providers/opencode-provider.tsx', 'loadSessionSettings')(env) as
    (target: SessionSettingsTarget, isCurrent?: () => boolean) => Promise<void>;

  test('an edit without v1 proof makes no request and never falls back', async () => {
    const { env, requests } = providerEnvironment({ entry: { status: 'unsupported' } });
    await expect(update(env)(PRIMARY, { fastMode: true })).rejects.toThrow(/not available/);
    expect(requests).toEqual([]);
  });

  test('a primary save stores only that exact readback and never touches ordinary sessions or preferences', async () => {
    const { env, calls, requests } = providerEnvironment();
    const state = await update(env)(PRIMARY, { modelMode: 'fixed', providerId: 'authorized-provider-example', modelId: 'new-model' });
    expect(state.modelId).toBe('new-model');
    expect(requests).toHaveLength(1);
    expect(calls).toEqual({ settings: [true], sessions: 0, preferences: 0 });
  });

  test('an ordinary SDK save updates that session and the current preferences from the readback', async () => {
    const { env, calls } = providerEnvironment({ responder: () => sdkState({ fastMode: true }) });
    (env.sessionSettingsRef as { current: Record<string, unknown> }).current = {
      [sessionSettingsKey(PROJECT, SDK)]: { status: 'ready', state: sdkState() },
    };
    const state = await update(env)(SDK, { fastMode: true });
    expect(state.fastMode).toBe(true);
    expect(calls).toEqual({ settings: [true], sessions: 1, preferences: 1 });
  });

  test.each([
    ['visible root changed', (env: Record<string, unknown>) => { void env; return () => false; }],
    ['paired client replaced', (env: Record<string, unknown>) => { (env.pairedHostClientRef as { current: unknown }).current = {}; return () => true; }],
    ['project changed', (env: Record<string, unknown>) => { (env.activeProjectPathRef as { current: string }).current = 'project-other'; return () => true; }],
  ])('%s during the await discards the response', async (_label, stale) => {
    const { env, calls } = providerEnvironment();
    // Flip the currency source only after the request is in flight.
    let flip: () => boolean = () => true;
    const original = env.patchMobileSessionSettings as typeof patchMobileSessionSettings;
    env.patchMobileSessionSettings = async (...args: Parameters<typeof patchMobileSessionSettings>) => {
      const result = await original(...args);
      flip = stale(env);
      return result;
    };
    await expect(update(env)(PRIMARY, { fastMode: true }, () => flip())).rejects.toThrow(/changed while saving/);
    expect(calls).toEqual({ settings: [], sessions: 0, preferences: 0 });
  });

  test('Sol stale before save must make zero PATCH requests', async () => {
    const { env, calls, requests } = providerEnvironment();
    await expect(update(env)(PRIMARY, { fastMode: true }, () => false)).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(calls).toEqual({ settings: [], sessions: 0, preferences: 0 });
  });

  test('currency lost between the entry check and the deferred transport callback still issues zero requests', async () => {
    const { env, calls, requests } = providerEnvironment();
    let current = true;
    // The real caller's isCurrent shape: a closure over the visible target. It flips only when the
    // deferred transport wrapper starts, i.e. after the pre-check but before the request.
    env.trackMacOffline = async (operation: () => Promise<unknown>) => { current = false; return operation(); };
    await expect(update(env)(PRIMARY, { fastMode: true }, () => current)).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(calls).toEqual({ settings: [], sessions: 0, preferences: 0 });
  });

  // A functional-updater cache that mirrors React state so ordering and currency inside the updater are real.
  function cacheEnvironment(options: { responder?: () => unknown } = {}) {
    const harness = providerEnvironment(options);
    const key = sessionSettingsKey(PROJECT, PRIMARY);
    const ref = harness.env.sessionSettingsRef as { current: Record<string, { status: string; state?: { fastMode?: boolean } }> };
    const pending: ((current: typeof ref.current) => typeof ref.current)[] = [];
    harness.env.setSessionSettings = (updater: (current: typeof ref.current) => typeof ref.current) => { pending.push(updater); };
    const flush = () => { while (pending.length) ref.current = pending.shift()!(ref.current); };
    const fast = () => ref.current[key]?.state?.fastMode;
    return { ...harness, key, ref, pending, flush, fast };
  }

  test('Sol older GET cannot overwrite a later canonical PATCH readback', async () => {
    const { env, flush, fast, ref } = cacheEnvironment();
    let finishGet: (state: unknown) => void = () => undefined;
    env.getMobileSessionSettings = () => new Promise((resolve) => { finishGet = resolve; });
    env.patchMobileSessionSettings = async () => primaryState({ fastMode: true });
    const oldRead = load(env)(PRIMARY);
    await update(env)(PRIMARY, { fastMode: true });
    flush();
    expect(fast()).toBe(true);
    finishGet(primaryState({ fastMode: false }));
    await oldRead;
    flush();
    expect(fast()).toBe(true);
    expect(ref.current[sessionSettingsKey(PROJECT, PRIMARY)].status).toBe('ready');
  });

  test('an obsolete GET rejection after a canonical PATCH cannot mark the key unsupported', async () => {
    const { env, flush, fast, key, ref } = cacheEnvironment();
    let failGet: (error: Error) => void = () => undefined;
    env.getMobileSessionSettings = () => new Promise((_resolve, reject) => { failGet = reject; });
    env.patchMobileSessionSettings = async () => primaryState({ fastMode: true });
    const oldRead = load(env)(PRIMARY);
    await update(env)(PRIMARY, { fastMode: true });
    flush();
    failGet(new Error('obsolete probe failed'));
    await oldRead;
    flush();
    expect(ref.current[key].status).toBe('ready');
    expect(fast()).toBe(true);
  });

  test('a probe started during a save is invalidated by the canonical readback', async () => {
    const { env, flush, fast } = cacheEnvironment();
    let finishPatch: (state: unknown) => void = () => undefined;
    let finishGet: (state: unknown) => void = () => undefined;
    env.patchMobileSessionSettings = () => new Promise((resolve) => { finishPatch = resolve; });
    env.getMobileSessionSettings = () => new Promise((resolve) => { finishGet = resolve; });
    const saving = update(env)(PRIMARY, { fastMode: true });
    await Promise.resolve();
    const duringSaveProbe = load(env)(PRIMARY);
    finishPatch(primaryState({ fastMode: true }));
    await saving;
    flush();
    finishGet(primaryState({ fastMode: false }));
    await duringSaveProbe;
    flush();
    expect(fast()).toBe(true);
  });

  test('Sol ordering: a during-save failed probe must not publish unsupported before canonical readback', async () => {
    const { env, flush, key, ref } = cacheEnvironment();
    let finishPatch: (state: unknown) => void = () => undefined;
    env.patchMobileSessionSettings = () => new Promise((resolve) => { finishPatch = resolve; });
    env.getMobileSessionSettings = async () => { throw new Error('obsolete capability probe'); };
    const saving = update(env)(PRIMARY, { fastMode: true });
    await Promise.resolve();
    await load(env)(PRIMARY, () => true);
    flush();
    const whileSaving = ref.current[key].status;
    finishPatch(primaryState({ fastMode: true }));
    await saving;
    flush();
    expect(ref.current[key].state?.fastMode).toBe(true);
    expect(whileSaving).toBe('ready');
  });

  test('a during-save successful old-state probe is suppressed while pending and a failed save keeps the prior state', async () => {
    const { env, flush, key, ref, fast } = cacheEnvironment();
    let failPatch: (error: Error) => void = () => undefined;
    env.patchMobileSessionSettings = () => new Promise((_resolve, reject) => { failPatch = reject; });
    env.getMobileSessionSettings = async () => primaryState({ fastMode: true });
    const saving = update(env)(PRIMARY, { fastMode: true });
    await Promise.resolve();
    await load(env)(PRIMARY, () => true);
    flush();
    expect(fast()).toBe(false);
    failPatch(new Error('save rejected'));
    await expect(saving).rejects.toThrow('save rejected');
    flush();
    // Failure leaves the verified prior state: neither the suppressed probe nor the failed save published.
    expect(ref.current[key].status).toBe('ready');
    expect(fast()).toBe(false);
  });

  test('a fresh probe after the last overlapping save settles publishes again, even after a failed save', async () => {
    const { env, flush, key, ref, fast } = cacheEnvironment();
    const patches: { resolve: (state: unknown) => void; reject: (error: Error) => void }[] = [];
    env.patchMobileSessionSettings = () => new Promise((resolve, reject) => { patches.push({ resolve, reject }); });
    const first = update(env)(PRIMARY, { fastMode: true });
    await Promise.resolve();
    const second = update(env)(PRIMARY, { fastMode: false });
    await Promise.resolve();
    patches[0].reject(new Error('first save failed'));
    await expect(first).rejects.toThrow('first save failed');
    // One save is still pending, so a probe now remains suppressed.
    env.getMobileSessionSettings = async () => primaryState({ fastMode: true });
    await load(env)(PRIMARY, () => true);
    flush();
    expect(fast()).toBe(false);
    patches[1].resolve(primaryState({ fastMode: false }));
    await second;
    flush();
    // The last settle cleared pending; a fresh read now publishes canonical server state.
    await load(env)(PRIMARY, () => true);
    flush();
    expect(ref.current[key].status).toBe('ready');
    expect(fast()).toBe(true);
  });

  test('a fresh probe after the save finishes still publishes, and currency is rechecked inside the updater', async () => {
    const fresh = cacheEnvironment({ responder: () => primaryState({ fastMode: true }) });
    await update(fresh.env)(PRIMARY, { fastMode: true });
    fresh.flush();
    fresh.env.getMobileSessionSettings = async () => primaryState({ fastMode: false });
    await load(fresh.env)(PRIMARY);
    fresh.flush();
    expect(fresh.fast()).toBe(false);

    // Currency lost after the response but before React applies the functional update.
    const lost = cacheEnvironment({ responder: () => primaryState({ fastMode: true }) });
    let current = true;
    await update(lost.env)(PRIMARY, { fastMode: true }, () => current);
    current = false;
    lost.flush();
    expect(lost.fast()).toBe(false);
    const probe = cacheEnvironment();
    let probeCurrent = true;
    probe.env.getMobileSessionSettings = async () => primaryState({ fastMode: true });
    await load(probe.env)(PRIMARY, () => probeCurrent);
    probeCurrent = false;
    probe.flush();
    expect(probe.fast()).toBe(false);
  });

  test('a rejected save leaves stored settings untouched', async () => {
    const { env, calls } = providerEnvironment({ responder: () => { throw new Error('conflict'); } });
    await expect(update(env)(PRIMARY, { fastMode: true })).rejects.toThrow('conflict');
    expect(calls).toEqual({ settings: [], sessions: 0, preferences: 0 });
  });

  test('a probe records ready, marks old/malformed Macs unsupported, and a stale probe records nothing', async () => {
    const ready = providerEnvironment({ responder: () => primaryState() });
    await load(ready.env)(PRIMARY);
    expect(ready.calls.settings).toEqual([true]);
    expect(ready.requests[0].method).toBe('GET');

    const old = providerEnvironment({ responder: () => ({ localSessionId: PRIMARY.id }) });
    await load(old.env)(PRIMARY);
    expect(old.calls.settings).toEqual([true]);

    const stale = providerEnvironment({ responder: () => primaryState() });
    await load(stale.env)(PRIMARY, () => false);
    expect(stale.calls.settings).toEqual([]);
  });
});

describe('actual ChatView settings handler', () => {
  function chatViewEnvironment(overrides: Record<string, unknown> = {}) {
    const calls = { settings: [] as unknown[][], legacy: [] as unknown[][], loads: 0 };
    const display: ChatPreferences = {
      ...defaultChatPreferences,
      modelId: 'authorized-provider-example/authorized-model-example',
      providerId: 'authorized-provider-example',
      modelMode: 'fixed',
      reasoning: 'low',
      permissionMode: 'plan',
      autoApprove: false,
      fastMode: false,
    };
    const key = sessionSettingsKey(PROJECT, PRIMARY);
    const env: Record<string, unknown> = {
      settingsTarget: PRIMARY,
      settingsKey: key,
      settingsKeyRef: { current: key },
      settingsEntry: { status: 'ready', state: primaryState() },
      displayPreferences: display,
      chatPreferences: { ...display, modelId: 'ordinary-provider/ordinary-model', fastMode: undefined },
      changesProfileOrApproval,
      diffSessionSettings,
      hydratePreferencesFromSession,
      loadSessionSettings: async () => { calls.loads += 1; },
      updateSessionPreferences: async (...args: unknown[]) => { calls.legacy.push(args); return display; },
      updateSessionSettings: async (...args: unknown[]) => {
        calls.settings.push(args);
        return primaryState({ modelId: 'another-authorized-model-example' }) as unknown as SessionExecutionState;
      },
      ...overrides,
    };
    return { env, calls, display };
  }
  const handler = (env: Record<string, unknown>) => extractCallback('components/chat/chat-view.tsx', 'handleUpdateSessionPreferences')(env) as
    (next: ChatPreferences) => Promise<ChatPreferences>;

  test('a Rhythm model edit targets the exact local primary with only the changed fields and never the legacy path', async () => {
    const { env, calls, display } = chatViewEnvironment();
    await handler(env)({ ...display, modelId: 'authorized-provider-example/another-authorized-model-example' });
    expect(calls.legacy).toEqual([]);
    expect(calls.settings).toHaveLength(1);
    expect(calls.settings[0][0]).toEqual(PRIMARY);
    expect(calls.settings[0][1]).toEqual({
      modelMode: 'fixed', providerId: 'authorized-provider-example', modelId: 'another-authorized-model-example',
    });
  });

  test('a Rhythm profile/approval edit is refused without any request', async () => {
    const { env, calls, display } = chatViewEnvironment();
    await expect(handler(env)({ ...display, permissionMode: 'default' })).rejects.toThrow(/cannot be changed/);
    expect(calls.settings).toEqual([]);
    expect(calls.legacy).toEqual([]);
  });

  test('an unchanged save and a pending/unsupported primary never reach the server', async () => {
    const same = chatViewEnvironment();
    expect(await handler(same.env)(same.display)).toBe(same.display);
    expect(same.calls.settings).toEqual([]);
    const pending = chatViewEnvironment({ settingsEntry: undefined, updateSessionSettings: async () => { throw new Error('not available'); } });
    await expect(handler(pending.env)({ ...pending.display, fastMode: true })).rejects.toThrow();
    expect(pending.calls.legacy).toEqual([]);
  });

  test('ordinary SDK with v1 proof sends a partial Fast toggle; without proof the legacy path omits Fast', async () => {
    const withProof = chatViewEnvironment({
      settingsTarget: SDK,
      settingsKey: sessionSettingsKey(PROJECT, SDK),
      settingsEntry: { status: 'ready', state: sdkState() },
    });
    await handler(withProof.env)({ ...withProof.display, fastMode: true });
    expect(withProof.calls.settings[0][0]).toEqual(SDK);
    expect(withProof.calls.settings[0][1]).toEqual({ fastMode: true });
    expect(withProof.calls.legacy).toEqual([]);

    const legacy = chatViewEnvironment({ settingsTarget: SDK, settingsKey: sessionSettingsKey(PROJECT, SDK), settingsEntry: undefined });
    await handler(legacy.env)({ ...legacy.display, fastMode: true, reasoning: 'high' });
    expect(legacy.calls.settings).toEqual([]);
    expect(legacy.calls.legacy[0][0]).toBe(SDK.id);
    expect(legacy.calls.legacy[0][1]).not.toHaveProperty('fastMode');
    expect(legacy.calls.legacy[0][1]).toMatchObject({ reasoning: 'high' });
  });
});

describe('actual configuration sheet', () => {
  const model = {
    id: 'authorized-provider-example/authorized-model-example', label: 'Authorized model', providerID: 'authorized-provider-example',
    providerLabel: 'Provider', modelID: 'authorized-model-example', supportsReasoning: true, supportsAttachments: false,
    inputModalities: ['text'], supportsToolCalls: true,
  };
  const preferences: ChatPreferences = {
    ...defaultChatPreferences, modelId: model.id, providerId: model.providerID, modelMode: 'fixed', fastMode: false,
  };
  function sheet(props: Record<string, unknown>) {
    return createElement(PaperProvider, null, createElement(SessionConfigurationSheet, {
      availableModels: [model] as never,
      availableProfiles: [],
      availableProviders: [{ id: 'authorized-provider-example', label: 'Provider', modelCount: 1, configured: true, connected: true }] as never,
      mode: 'edit',
      onDismiss: () => undefined,
      palette: Colors.light,
      preferences,
      visible: true,
      ...props,
    } as never));
  }

  test('opening the sheet writes nothing; Fast appears only with canonical support and toggles explicitly', async () => {
    const onPreferencesChange = jest.fn(async (next: Partial<ChatPreferences>) => ({ ...preferences, ...next }));
    const hidden = render(sheet({ onPreferencesChange }));
    expect(hidden.queryByTestId('session-fast-switch')).toBeNull();
    expect(onPreferencesChange).not.toHaveBeenCalled();
    hidden.unmount();

    const shown = render(sheet({ onPreferencesChange, settingsGate: { showFast: true, modelOnly: true, scopeNote: 'Saved to this Rhythm chat.' } }));
    expect(onPreferencesChange).not.toHaveBeenCalled();
    expect(shown.getByTestId('session-settings-note')).toBeTruthy();
    await act(async () => { fireEvent(shown.getByTestId('session-fast-switch'), 'valueChange', true); });
    expect(onPreferencesChange).toHaveBeenCalledTimes(1);
    expect(onPreferencesChange.mock.calls[0][0]).toMatchObject({ fastMode: true, modelId: model.id });
  });

  test('a rejected save keeps the prior setting and shows the error', async () => {
    const onPreferencesChange = jest.fn(async () => { throw new Error('Mac refused the change'); });
    const screen = render(sheet({ onPreferencesChange, settingsGate: { showFast: true } }));
    await act(async () => { fireEvent(screen.getByTestId('session-fast-switch'), 'valueChange', true); });
    expect(screen.getByText('Mac refused the change')).toBeTruthy();
    expect(screen.getByTestId('session-fast-switch').props.value).toBe(false);
  });

  test('an unavailable canonical state locks model, reasoning and Fast and explains why', () => {
    const screen = render(sheet({
      onPreferencesChange: jest.fn(),
      settingsGate: { modelOnly: true, showFast: true, unavailableReason: 'Chat settings are not available for this chat on this Mac yet.' },
    }));
    expect(screen.getByText('Chat settings are not available for this chat on this Mac yet.')).toBeTruthy();
    expect(screen.getByTestId('session-model-row').props.accessibilityState?.disabled ?? screen.getByTestId('session-model-row').props.disabled).toBeTruthy();
    expect(screen.getByTestId('session-profile-row').props.accessibilityState?.disabled ?? screen.getByTestId('session-profile-row').props.disabled).toBeTruthy();
  });
});
