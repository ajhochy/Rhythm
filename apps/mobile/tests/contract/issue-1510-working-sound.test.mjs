import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Run the real TS modules; only native audio/files and storage are faked.
async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  Function('require', 'exports', output)((name) => {
    assert.ok(name in dependencies, `unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const utils = await loadModule('providers/opencode-provider-utils.ts');

test('legacy preference snapshots migrate once, preserving unrelated choices and subsequent opt-ins', () => {
  assert.equal(utils.defaultChatPreferences.workingSoundEnabled, false);
  for (const enabled of [true, false, undefined]) {
    const legacy = { workingSoundEnabled: enabled, workingSoundVariant: 'glass', speechRate: 1.25 };
    const migrated = utils.migrateWorkingSoundPreferences(legacy);
    assert.equal(migrated.workingSoundEnabled, false);
    assert.equal(migrated.workingSoundDefaultMigrated, 1);
    assert.equal(migrated.speechRate, 1.25);
    assert.equal(migrated.workingSoundVariant, 'glass');
    assert.deepEqual(utils.migrateWorkingSoundPreferences(migrated), migrated);
    const enabledAfterMigration = { ...migrated, workingSoundEnabled: true };
    assert.equal(utils.migrateWorkingSoundPreferences(JSON.parse(JSON.stringify(enabledAfterMigration))).workingSoundEnabled, true);
    assert.equal(legacy.workingSoundEnabled, enabled, 'migration does not mutate the input');
  }
});

test('real persistence hook migrates on hydration and host change; on/off survive remount', async () => {
  const saved = new Map([
    ['one', JSON.stringify({ workingSoundEnabled: true })],
    ['two', JSON.stringify({ workingSoundEnabled: true })],
  ]);
  const scopeFor = (_account, serverUrl) => ({ settingsKey: serverUrl });
  const { useOpencodePersistence } = await loadModule('providers/use-opencode-persistence.ts', {
    react: React,
    '@/providers/opencode-provider-utils': utils,
    '@/lib/opencode/connection-persistence': {
      parseStoredConnectionSettings: () => ({ publicSettings: {} }),
      serializePublicConnectionSettings: JSON.stringify,
    },
    '@/lib/security/connection-account-scope': {
      createDirectMacConnectionScope: scopeFor,
      canWriteDirectMacCredential: () => true,
    },
    '@/lib/security/connection-credential-store': {
      connectionCredentialStore: { getPassword: async () => '', setPassword: async () => {} },
      directMacStateManager: {
        purgeLegacyUnscopedState: async () => {}, getActiveScope: async () => null,
        selectActiveScope: async () => {}, readPublicSettings: async () => null,
        writePublicSettings: async () => {},
        readAuxiliaryState: async (scope) => ({ chatPreferences: saved.get(scope.settingsKey) }),
        writeAuxiliaryValue: async (scope, key, value) => {
          if (key === 'chatPreferencesKey') saved.set(scope.settingsKey, value);
        },
      },
    },
  });
  const defaults = { serverUrl: 'one', password: '', username: '', directory: '' };
  let state;
  function Harness() {
    const [settings, setSettings] = React.useState(defaults);
    const [chatPreferences, setChatPreferences] = React.useState(utils.defaultChatPreferences);
    const [activeProjectPath, setActiveProjectPath] = React.useState();
    const [lastSessionByProject, setLastSessionByProject] = React.useState({});
    useOpencodePersistence({ defaultChatPreferences: utils.defaultChatPreferences, defaultSettings: defaults,
      accountUserId: 1, settings, setSettings, chatPreferences, setChatPreferences,
      activeProjectPath, setActiveProjectPath, lastSessionByProject, setLastSessionByProject });
    state = { settings, setSettings, chatPreferences, setChatPreferences };
    return null;
  }
  let root;
  const mount = async () => {
    await act(async () => { root = create(React.createElement(Harness)); });
    await act(tick);
  };
  const setEnabled = async (workingSoundEnabled) => {
    await act(async () => state.setChatPreferences((current) => ({ ...current, workingSoundEnabled })));
  };
  try {
    await mount();
    assert.equal(state.chatPreferences.workingSoundEnabled, false);
    assert.equal(JSON.parse(saved.get('one')).workingSoundDefaultMigrated, 1);
    await setEnabled(true);
    await act(async () => root.unmount());
    await mount();
    assert.equal(state.chatPreferences.workingSoundEnabled, true, 're-enabled sound survives relaunch');
    await setEnabled(false);
    await act(async () => root.unmount());
    await mount();
    assert.equal(state.chatPreferences.workingSoundEnabled, false, 'off survives relaunch');
    await act(async () => state.setSettings((current) => ({ ...current, serverUrl: 'two' })));
    await act(tick);
    assert.equal(state.chatPreferences.workingSoundEnabled, false, 'switching hosts migrates that stored snapshot too');
    assert.equal(JSON.parse(saved.get('two')).workingSoundDefaultMigrated, 1);
  } finally {
    await act(async () => root?.unmount());
  }
});

async function audioHarness({ createGate, playGate, failPlay = false, failPause = false } = {}) {
  const players = [];
  let maxLoaded = 0;
  const api = await loadModule('lib/voice/working-sound.ts', {
    'expo-file-system': { Paths: { cache: '/fake-cache' }, File: class { exists = true; uri = 'fake.wav'; } },
    'base-64': { encode: (value) => Buffer.from(value).toString('base64') },
    '@/lib/voice/speech-output': { initializeVoiceAudioAsync: async () => {} },
    'expo-av': { Audio: { Sound: { createAsync: async (_source, options) => {
      await createGate?.promise;
      const player = {
        options, playing: false, loaded: true, position: 0, plays: 0,
        async setVolumeAsync(volume) { this.volume = volume; },
        async setIsLoopingAsync() {},
        async playAsync() {
          this.playing = true; this.plays += 1;
          await playGate?.promise;
          if (failPlay) { failPlay = false; throw new Error('play failed'); }
        },
        async pauseAsync() {
          if (failPause) { failPause = false; throw new Error('pause failed'); }
          this.playing = false;
        },
        async setPositionAsync(position) { this.position = position; },
        async unloadAsync() { this.loaded = false; this.playing = false; },
      };
      players.push(player);
      maxLoaded = Math.max(maxLoaded, players.filter((item) => item.loaded).length);
      return { sound: player };
    } } } },
  });
  return { ...api, players, maxLoaded: () => maxLoaded };
}

test('replayed starts share one player; stops, volume updates, and subsequent turns are idempotent', async () => {
  const h = await audioHarness();
  await Promise.all(Array.from({ length: 10 }, () => h.startWorkingSoundAsync('soft', 0.18)));
  const player = h.players[0];
  await h.startWorkingSoundAsync('soft', 0.3);
  assert.equal(h.players.length, 1);
  assert.equal(player.plays, 1, 'a repeated start does not restart native playback');
  assert.equal(player.volume, 0.3);
  assert.equal(player.options.isLooping, true);
  await Promise.all([h.stopWorkingSoundAsync(), h.stopWorkingSoundAsync()]);
  assert.equal(player.playing, false);
  assert.equal(player.position, 0);
  await h.startWorkingSoundAsync('soft', 0.18);
  assert.equal(player.playing, true);
  assert.equal(h.players.length, 1);
  await h.startWorkingSoundAsync('glass', 0.18);
  assert.equal(player.loaded, false);
  assert.equal(h.maxLoaded(), 1, 'a variant change releases the previous player first');
  await Promise.all([h.unloadWorkingSoundAsync(), h.unloadWorkingSoundAsync()]);
  assert.ok(h.players.every((item) => !item.loaded && !item.playing));
});

for (const transition of ['stopWorkingSoundAsync', 'unloadWorkingSoundAsync']) {
  test(`${transition} invalidates a pending native load before it can play`, async () => {
    const createGate = deferred();
    const h = await audioHarness({ createGate });
    const start = h.startWorkingSoundAsync('soft', 0.18);
    await tick();
    const stopped = h[transition]();
    createGate.resolve();
    assert.equal(await start, false);
    await stopped;
    assert.ok(h.players.every((player) => !player.playing && player.plays === 0));
    await h.unloadWorkingSoundAsync();
    assert.ok(h.players.every((player) => !player.loaded));
  });
}

test('stop racing with native play completion cannot leave orphaned playback', async () => {
  const playGate = deferred();
  const h = await audioHarness({ playGate });
  const start = h.startWorkingSoundAsync('soft', 0.18);
  await tick();
  assert.equal(h.players[0].playing, true);
  const stop = h.stopWorkingSoundAsync();
  playGate.resolve();
  await Promise.all([start, stop]);
  assert.equal(h.players[0].playing, false);
  await h.unloadWorkingSoundAsync();
});

test('failed native play releases its handle and the next turn can recover', async () => {
  const h = await audioHarness({ failPlay: true });
  await assert.rejects(h.startWorkingSoundAsync('soft', 0.18), /play failed/);
  assert.equal(h.players[0].playing, false);
  assert.equal(h.players[0].loaded, false);
  await h.startWorkingSoundAsync('soft', 0.18);
  assert.equal(h.players[1].playing, true);
  assert.equal(h.maxLoaded(), 1);
  await h.unloadWorkingSoundAsync();
});

test('a native pause failure falls back to unloading, preserving silence', async () => {
  const h = await audioHarness({ failPause: true });
  await h.startWorkingSoundAsync('soft', 0.18);
  await h.stopWorkingSoundAsync();
  assert.equal(h.players[0].loaded, false);
  assert.equal(h.players[0].playing, false);
});

test('rendered provider sound lifecycle respects preference, selected session, voice, cancellation, errors and app state', async () => {
  const h = await audioHarness();
  const source = await readFile(new URL('../../providers/opencode-provider.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('provider.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const provider = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'OpencodeProvider');
  // Mount the actual sound-related provider statements with React. Unrelated
  // network/UI orchestration is outside this focused native audio contract.
  const names = new Set(['stoppedWorkingSoundSessions', 'stopSessionWorkingSound', 'allowSessionWorkingSound', 'workingSoundBusy', 'abortSession']);
  const statements = provider.body.statements.filter((node) => {
    if (ts.isVariableStatement(node)) {
      return node.declarationList.declarations.some((declaration) => names.has(
        ts.isArrayBindingPattern(declaration.name) ? declaration.name.elements[0].name.getText(ast) : declaration.name.getText(ast),
      ));
    }
    return ts.isExpressionStatement(node) && node.getText(ast).includes('const syncWorkingSound');
  });
  assert.equal(statements.length, 6, 'all sound state, callbacks, and the playback effect must be exercised');
  let eventHandler;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleEvent') eventHandler = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(provider);
  assert.ok(eventHandler);
  const callbacks = new Set();
  const AppState = {
    currentState: 'active',
    addEventListener(_name, callback) { callbacks.add(callback); return { remove: () => callbacks.delete(callback) }; },
  };
  const noop = async () => {};
  const abortGate = deferred();
  const dependencies = {
    useState: React.useState, useEffect: React.useEffect, useCallback: React.useCallback,
    AppState, Platform: { OS: 'ios' }, ...h,
    pendingNotificationSessionIdsRef: { current: new Set() },
    busyNotificationSessionIdsRef: { current: new Set() },
    notificationRequestedAtRef: { current: new Map() },
    clearTrackedPendingNotification: noop,
    client: { session: { abort: () => abortGate.promise } },
    refreshSessions: noop, refreshMessages: noop, refreshSessionDiff: noop, refreshSessionTodos: noop,
    scheduleSessionRefresh() {}, coalescedIdleRefresh: { trigger() {} },
    setPromptError() {}, summarizeError: String,
  };
  const compiled = ts.transpileModule(`
    const { currentSessionId, sendingState, sessionStatuses, chatPreferences, conversationPhase, connection, setSessionStatuses } = state;
    const currentSessionIdRef = { current: currentSessionId };
    ${statements.map((node) => node.getText(ast)).join('\n')}
    const handleEvent = ${eventHandler};
    return { abortSession, handleEvent, allowSessionWorkingSound };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const renderSound = Function(...Object.keys(dependencies), 'state', compiled);
  let controls;
  let state = { currentSessionId: 'one', sendingState: { active: false },
    sessionStatuses: { one: { type: 'busy' }, two: { type: 'idle' } },
    chatPreferences: { ...utils.defaultChatPreferences }, conversationPhase: 'off', connection: { status: 'connected' } };
  function Harness({ input }) {
    const [statuses, setSessionStatuses] = React.useState(input.sessionStatuses);
    controls = { ...renderSound(...Object.values(dependencies), { ...input, sessionStatuses: statuses, setSessionStatuses }), setSessionStatuses };
    return null;
  }
  let root;
  const flush = async () => { await act(tick); };
  const render = async (patch = {}) => {
    state = { ...state, ...patch };
    await act(async () => {
      if (root) root.update(React.createElement(Harness, { input: state }));
      else root = create(React.createElement(Harness, { input: state }));
    });
    await flush();
  };
  const audible = () => h.players.some((player) => player.playing);
  const status = async (type) => {
    await act(async () => controls.handleEvent({ type: 'session.status', properties: { sessionID: 'one', status: { type } } }));
    await flush();
  };
  try {
    await render();
    assert.equal(h.players.length, 0, 'default-off busy turn never allocates audio');
    await render({ chatPreferences: { ...state.chatPreferences, workingSoundEnabled: true } });
    assert.equal(audible(), true);
    await status('busy'); await status('busy');
    assert.equal(h.players[0].plays, 1, 'replayed busy events do not restart the loop');
    await render({ chatPreferences: { ...state.chatPreferences, workingSoundEnabled: false } });
    assert.equal(audible(), false, 'off stops an active turn');
    await render({ chatPreferences: { ...state.chatPreferences, workingSoundEnabled: true } });
    await render({ currentSessionId: 'two' });
    assert.equal(audible(), false, 'a different background session cannot keep the loop alive');
    await render({ currentSessionId: 'one' });
    for (const conversationPhase of ['listening', 'speaking']) {
      await render({ conversationPhase });
      assert.equal(audible(), false, `${conversationPhase} remains free of processing audio`);
    }
    await render({ conversationPhase: 'off' });
    AppState.currentState = 'background';
    await act(async () => { for (const callback of callbacks) callback('background'); });
    await flush();
    assert.equal(audible(), false);
    AppState.currentState = 'active';
    await act(async () => { for (const callback of callbacks) callback('active'); });
    await flush();
    assert.equal(audible(), true);
    await render({ connection: { status: 'error' } });
    assert.equal(audible(), false, 'disconnect stops stale busy playback');
    await render({ connection: { status: 'connected' } });
    await status('idle');
    assert.equal(audible(), false, 'completion stops');
    await status('busy');
    assert.equal(audible(), true, 'a second turn can opt in');
    await act(async () => controls.handleEvent({ type: 'session.error', properties: { sessionID: 'one' } }));
    await flush();
    assert.equal(audible(), false, 'error stops even without an idle event');
    await act(async () => controls.setSessionStatuses({ one: { type: 'busy' } }));
    await flush();
    assert.equal(audible(), false, 'stale busy polling cannot restart a failed turn');
    await status('busy');
    let aborted;
    await act(async () => { aborted = controls.abortSession('one'); });
    await flush();
    assert.equal(audible(), false, 'cancel stops before the abort HTTP response');
    abortGate.resolve(); await aborted;
    await status('busy');
    await act(async () => controls.handleEvent({ type: 'session.idle', properties: { sessionID: 'one' } }));
    await flush();
    assert.equal(audible(), false, 'idle completion stops');
    await status('busy');
    await act(async () => root.unmount());
    await flush();
    assert.equal(audible(), false, 'unmount stops');
    assert.equal(callbacks.size, 0, 'unmount releases the app-state listener');
  } finally {
    abortGate.resolve();
    await act(async () => root?.unmount());
    await h.unloadWorkingSoundAsync();
  }
});
