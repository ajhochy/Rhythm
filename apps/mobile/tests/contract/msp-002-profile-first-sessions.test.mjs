import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

import { profileCatalogPayload } from '../fake-opencode/fixtures.mjs';

const mobileRoot = new URL('../../', import.meta.url);
const readMobileSource = (path) =>
  readFile(new URL(path, mobileRoot), 'utf8');

const utilsSource = await readMobileSource(
  'providers/opencode-provider-utils.ts',
);
const utilsOutput = ts.transpileModule(utilsSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const providerUtils = await import(
  `data:text/javascript,${encodeURIComponent(utilsOutput)}`
);

const basePreferences = {
  mode: 'research',
  profileId: 'profile-research',
  providerId: 'openai',
  modelId: 'openai/gpt-research',
  enabledModelIds: [],
  providerModelSelections: {},
  reasoning: 'low',
  permissionMode: 'bypassPermissions',
  autoApprove: true,
  autoPlayAssistantReplies: false,
  preferOnDeviceRecognition: true,
  resumeListeningAfterReply: true,
  speechRate: 1,
  workingSoundEnabled: true,
  workingSoundVariant: 'soft',
  workingSoundVolume: 0.18,
  responseScope: 'brief',
  includeNextActions: true,
};

const secretary = {
  id: 'profile-secretary',
  profileId: 'profile-secretary',
  opencodeAgentId: 'secretary',
  label: 'Secretary',
  defaults: {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    reasoningEffort: 'high',
    approvalMode: 'plan',
  },
};

test('issue-2-c1: every new-chat entry point uses the Secretary-first creation flow', async () => {
  // Regression caught: one plus button calls session.create directly and
  // silently inherits the last globally selected profile, or the fake gateway
  // omits Secretary and leaves the shared Create action permanently disabled.
  const fakeSecretary = profileCatalogPayload().profiles.find(
    (profile) =>
      profile.name === 'Secretary' &&
      profile.opencodeAgentId === 'secretary',
  );
  assert.ok(
    fakeSecretary,
    'the foundation harness catalog must expose the Secretary default',
  );
  assert.equal(
    typeof providerUtils.getNewSessionPreferences,
    'function',
    'the unified creation flow needs a Secretary-first preference builder',
  );
  if (typeof providerUtils.getNewSessionPreferences === 'function') {
    const preferences = providerUtils.getNewSessionPreferences(
      [secretary],
      basePreferences,
    );
    assert.equal(preferences.profileId, secretary.profileId);
    assert.equal(preferences.mode, secretary.opencodeAgentId);
  }

  const [
    chatList,
    chatView,
    workspace,
    agentChatProvider,
    opencodeProvider,
    fakeServer,
  ] =
    await Promise.all([
      readMobileSource('components/chat/chat-list.tsx'),
      readMobileSource('components/chat/chat-view.tsx'),
      readMobileSource('app/agents/workspace.tsx'),
      readMobileSource('providers/agent-chat-provider.tsx'),
      readMobileSource('providers/opencode-provider.tsx'),
      readMobileSource('tests/fake-opencode/server.mjs'),
    ]);
  const directAgentRoute =
    fakeServer.match(
      /if \(req\.method === 'GET' && pathname === '\/agent'\) \{([\s\S]*?)\n    \}/,
    )?.[1] ?? '';
  assert.match(
    directAgentRoute,
    /name:\s*'secretary'/,
    'the direct web harness agent catalog must expose the Secretary default',
  );
  assert.match(
    chatList,
    /await opencode\.loadSessionProfiles\(targetProject\)/,
    'the direct Create sheet must resolve profiles when capability hydration is still pending',
  );
  assert.match(
    chatList,
    /visible=\{createSheetVisible && isFocused\}/,
    'the Create sheet must stop covering the chat surface when navigation leaves Chats',
  );
  const createSessionBlock =
    opencodeProvider.match(
      /const createSession = useCallback\([\s\S]*?\n  \);\n/,
    )?.[0] ?? '';
  assert.match(
    createSessionBlock,
    /await loadSessionProfiles\(projectId\)/,
    'automatic session creation must resolve Secretary before applying the no-Secretary gate',
  );
  const loadSessionProfilesBlock =
    opencodeProvider.match(
      /const loadSessionProfiles = useCallback\([\s\S]*?\n  \);\n/,
    )?.[0] ?? '';
  assert.ok(
    loadSessionProfilesBlock.indexOf('if (pairedHostClient)') >= 0 &&
      loadSessionProfilesBlock.indexOf('return refreshChatCapabilities()') >=
        0 &&
      loadSessionProfilesBlock.indexOf('if (pairedHostClient)') <
        loadSessionProfilesBlock.indexOf('return refreshChatCapabilities()'),
    'paired creation must use its scoped profile catalog before the active-project capability refresh',
  );
  for (const [name, source] of [
    ['Chat list', chatList],
    ['Chat header', chatView],
    ['Workspace', workspace],
  ]) {
    assert.match(
      source,
      /SessionConfigurationSheet[\s\S]*mode="create"/,
      `${name} must open the shared profile-first creation sheet`,
    );
  }
  assert.doesNotMatch(
    agentChatProvider,
    /client\.session\.create/,
    'cross-project chat creation must delegate to the unified provider flow',
  );
});

test('issue-2-c2: profile selection applies the profile model and execution defaults', () => {
  // Regression caught: changing Profile updates only the agent ID, leaving
  // the previous profile's model, reasoning, or approval policy behind.
  assert.equal(typeof providerUtils.applyProfileDefaults, 'function');
  if (typeof providerUtils.applyProfileDefaults !== 'function') return;
  const next = providerUtils.applyProfileDefaults(
    secretary,
    basePreferences,
  );
  assert.deepEqual(
    {
      profileId: next.profileId,
      mode: next.mode,
      providerId: next.providerId,
      modelId: next.modelId,
      reasoning: next.reasoning,
      permissionMode: next.permissionMode,
      autoApprove: next.autoApprove,
    },
    {
      profileId: 'profile-secretary',
      mode: 'secretary',
      providerId: 'anthropic',
      modelId: 'anthropic/claude-sonnet-4-5',
      reasoning: 'high',
      permissionMode: 'plan',
      autoApprove: false,
    },
  );
});

test('issue-2-c3: session edits use the authoritative PATCH and hydration seams', async () => {
  // Regression caught: controls update mobile globals only, so reopening the
  // chat restores stale server values.
  const provider = await readMobileSource('providers/opencode-provider.tsx');
  assert.match(
    provider,
    /const updateSessionPreferences = useCallback/,
  );
  assert.match(
    provider,
    /updateMobileSessionProfileState\(/,
  );
  assert.match(
    provider,
    /hydratePreferencesFromSession\(authoritative/,
  );
});

test('issue-2-c4: three-dot configuration sheet labels all session-scoped controls', async () => {
  // Regression caught: configuration remains as unlabeled compact composer
  // icons, so users cannot understand scope or approval behavior.
  const [header, sheet, composer] = await Promise.all([
    readMobileSource('components/chat/chat-header.tsx'),
    readMobileSource('components/chat/session-configuration-sheet.tsx')
      .catch(() => ''),
    readMobileSource('components/chat/chat-composer.tsx'),
  ]);
  assert.match(header, /SessionConfigurationSheet/);
  assert.match(header, /accessibilityLabel="Chat menu"/);
  assert.match(header, /accessibilityHint="Session configuration"/);
  for (const label of ['Profile', 'Model', 'Reasoning', 'Approval Policy']) {
    assert.match(sheet, new RegExp(`accessibilityLabel=.*${label}|>${label}<`));
  }
  assert.match(
    sheet,
    /Applies only to this chat[\s\S]*global\s+OpenCode/,
  );
  assert.doesNotMatch(composer, /getAutoApproveIcon|shield-check|shield-key/);
});

test('issue-2-c5: profile and model search cover labels IDs and metadata', () => {
  // Regression caught: search matches the friendly label but cannot find a
  // stable profile/model ID or provider/account identifier copied from logs.
  assert.equal(typeof providerUtils.profileMatchesSearch, 'function');
  assert.equal(typeof providerUtils.modelMatchesSearch, 'function');
  if (
    typeof providerUtils.profileMatchesSearch !== 'function' ||
    typeof providerUtils.modelMatchesSearch !== 'function'
  ) return;
  assert.equal(
    providerUtils.profileMatchesSearch(secretary, 'PROFILE-SECRETARY'),
    true,
  );
  assert.equal(
    providerUtils.profileMatchesSearch(secretary, 'anthropic'),
    true,
  );
  const model = {
    id: 'anthropic/claude-sonnet-4-5',
    label: 'Claude Sonnet',
    providerID: 'anthropic',
    providerLabel: 'Anthropic',
    modelID: 'claude-sonnet-4-5',
  };
  assert.equal(
    providerUtils.modelMatchesSearch(model, 'claude-sonnet-4-5', {
      accountLabel: 'Work account',
      providerLabel: 'Anthropic',
    }),
    true,
  );
  assert.equal(
    providerUtils.modelMatchesSearch(model, 'work account', {
      accountLabel: 'Work account',
      providerLabel: 'Anthropic',
    }),
    true,
  );
});

test('issue-2-c6: updating one session cannot mutate another session execution state', () => {
  // Regression caught: persisting chat A replaces shared preference state, so
  // chat B reopens with chat A's profile/model/reasoning/approval overrides.
  assert.equal(typeof providerUtils.replaceSessionExecutionState, 'function');
  if (typeof providerUtils.replaceSessionExecutionState !== 'function') return;
  const sessionA = {
    id: 'session-a',
    rhythm: {
      profileId: 'profile-secretary',
      opencodeAgentId: 'secretary',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      thinkingBudget: 1024,
      permissionMode: 'default',
      profileAvailability: 'available',
    },
  };
  const sessionB = {
    id: 'session-b',
    rhythm: {
      profileId: 'profile-research',
      opencodeAgentId: 'research',
      providerId: 'openai',
      modelId: 'gpt-research',
      thinkingBudget: 8192,
      permissionMode: 'plan',
      profileAvailability: 'available',
    },
  };
  const nextStateA = {
    ...sessionA.rhythm,
    modelId: 'claude-opus-4-1',
    permissionMode: 'acceptEdits',
  };
  const next = providerUtils.replaceSessionExecutionState(
    [sessionA, sessionB],
    sessionA.id,
    nextStateA,
  );
  assert.notStrictEqual(next[0], sessionA);
  assert.strictEqual(next[1], sessionB);
  assert.deepEqual(next[1].rhythm, sessionB.rhythm);
  assert.equal(next[0].rhythm.modelId, 'claude-opus-4-1');

  const defaults = {
    ...basePreferences,
    profileId: undefined,
    modelId: undefined,
  };
  const openedA = providerUtils.hydratePreferencesFromSession(
    next[0].rhythm,
    defaults,
  );
  const openedB = providerUtils.hydratePreferencesFromSession(
    next[1].rhythm,
    openedA,
  );
  const reopenedA = providerUtils.hydratePreferencesFromSession(
    next[0].rhythm,
    openedB,
  );
  assert.equal(openedA.modelId, 'anthropic/claude-opus-4-1');
  assert.equal(openedB.profileId, 'profile-research');
  assert.equal(openedB.modelId, 'openai/gpt-research');
  assert.equal(openedB.reasoning, 'high');
  assert.equal(openedB.permissionMode, 'plan');
  assert.equal(reopenedA.profileId, 'profile-secretary');
  assert.equal(reopenedA.modelId, 'anthropic/claude-opus-4-1');
  assert.equal(reopenedA.permissionMode, 'acceptEdits');
});

test('issue-2-c7: session Approval Policy does not write global OpenCode config', async () => {
  // Regression caught: a per-chat-looking shield toggles config.permission
  // globally instead of PATCHing the selected session record.
  const [provider, sheet] = await Promise.all([
    readMobileSource('providers/opencode-provider.tsx'),
    readMobileSource('components/chat/session-configuration-sheet.tsx')
      .catch(() => ''),
  ]);
  assert.match(sheet, /onPreferencesChange/);
  assert.match(provider, /updateSessionPreferences/);
  const sessionPreferenceBlock =
    provider.match(
      /const updateSessionPreferences[\s\S]*?\n  \);\n/,
    )?.[0] ?? '';
  assert.match(sessionPreferenceBlock, /persistSessionPreferences/);
  assert.doesNotMatch(sessionPreferenceBlock, /client\.config\.update/);
});
