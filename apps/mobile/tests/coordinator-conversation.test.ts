import { fireEvent, render } from '@testing-library/react-native';
import { createElement } from 'react';
import { PaperProvider } from 'react-native-paper';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import {
  resolveMobileCoordinatorBinding,
  type MobileCoordinatorBinding,
} from '@/providers/coordinator-conversation-binding';
import {
  coordinatorDraftScope,
  routeCoordinatorComposerInput,
  shouldApplyCoordinatorAcknowledgement,
} from '@/components/chat/coordinator-composer-routing';
import { CoordinatorConversationCard } from '@/components/chat/coordinator-conversation-card';
import { ChatComposer } from '@/components/chat/chat-composer';
import {
  routeCoordinatorConversationToggle,
  stopConversationBeforeCoordinatorOpen,
} from '@/components/chat/coordinator-voice-routing';
import {
  MobileCoordinatorConversationController,
  type MobileCoordinatorViewState,
} from '@/providers/coordinator-conversation-controller';
import {
  createMemoryMobileCoordinatorJournal,
  createMobileCoordinatorJournal,
} from '@/providers/coordinator-conversation-journal';
import { createSessionDraftStore } from '@/components/chat/chat-drafts';
import {
  isDedicatedCoordinatorSchema,
  createPairedCoordinatorConversationGateway,
  parseMobileCoordinatorHistoryResult,
  parseMobileCoordinatorPlanResult,
  parseMobileCoordinatorResolveResult,
  parseMobileCoordinatorResult,
  parseMobileCoordinatorSetupResult,
  type MobileCoordinatorConversation,
  type MobileCoordinatorGateway,
  type MobileCoordinatorResult,
} from '@/providers/services/coordinator-conversations-service';
import { mapMobileCoordinatorHistory } from '@/providers/services/coordinator-history-transcript';
import { Colors } from '@/constants/theme';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

const binding: MobileCoordinatorBinding = {
  actorKey: 'user:7:host:mac-1',
  uiSessionId: 'sdk-session-a',
  sessionId: 'local-root-a',
  projectId: 'project-a',
};
const pairedClient = {} as never;

function currentScopeProof(overrides: Partial<{
  actorKey: string;
  localSessionId: string;
  pairedClient: object;
  projectId: string;
  uiSessionId: string;
}> = {}) {
  return {
    actorKey: binding.actorKey,
    localSessionId: binding.sessionId,
    pairedClient,
    projectId: binding.projectId,
    uiSessionId: binding.uiSessionId,
    ...overrides,
  };
}

function conversation(revision = 1, goals: MobileCoordinatorConversation['goals'] = []): MobileCoordinatorConversation {
  return {
    schemaVersion: 1,
    id: 'conversation-a',
    sessionId: 'local-root-a',
    projectId: 'project-a',
    controlRevision: revision,
    goals,
  };
}

function c2Conversation(revision = 1): MobileCoordinatorConversation {
  return {
    ...conversation(revision, [{
      id: 'goal-a', commandKey: 'goal-command-a', objective: 'Prepare a finite plan',
      state: 'captured', linkedWorkstreamId: null, revision: 1,
    }]),
    schemaVersion: 3,
    primaryOwnerRoot: true,
    ownerUserId: 7,
    commandDedupe: [],
    continuations: [{
      authorizationId: 'authority-a', goalId: 'goal-a', workstreamId: 'workstream-a',
      status: 'consumed', maxTurns: 2, consumedTurns: 1, expiresAt: '2026-10-05T01:00:00.000Z',
    }],
  };
}

function plannedWorkstream() {
  return {
    workstream: { id: 'workstream-a', state: 'queued' as const },
    readiness: { available: true },
    jobs: [{ state: 'queued' }],
    budget: { actualTokens: 120, authorizedTokens: 20000, holdReason: null },
  };
}

function context() {
  return {
    timeZone: 'America/Los_Angeles' as const,
    asOf: '2026-10-05T00:00:00.000Z',
    today: '2026-10-05',
    yesterday: '2026-10-04',
    availability: {
      tasks: { state: 'available' as const },
      schedules: { state: 'available' as const },
      workstreams: { state: 'available' as const },
      receipts: { state: 'available' as const },
      manualActivity: { state: 'not_configured' as const },
    },
    todayTasks: [],
    waitingForReply: [],
    doneWithUnknownCompletionDate: [],
    scheduledPriorities: [],
    activeWorkstreams: [],
    executionSucceededGoalUnverified: [],
    staleExecutions: [],
    verifiedYesterday: [],
    usageHolds: [],
    receipts: [],
  };
}

function statusResult(revision = 1): MobileCoordinatorResult {
  return { kind: 'status', conversation: conversation(revision), context: context() };
}

function gateway(overrides: Partial<MobileCoordinatorGateway> = {}): MobileCoordinatorGateway {
  return {
    open: async () => ({ kind: 'replay', conversation: conversation() }),
    status: async () => statusResult(),
    message: async () => ({ kind: 'status', conversation: conversation(), context: context() }),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function actualCoordinatorSendHandler() {
  const file = resolve(process.cwd(), 'components/chat/chat-view.tsx');
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleSendPrompt') {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!initializer) throw new Error('ChatView coordinator send handler is unavailable.');
  const compiled = ts.transpileModule('const action = ' + initializer.getText(ast) + ';', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // The extracted callback is the real ChatView handler; the environment only
  // supplies its React closure values and a synthetic delayed coordinator ACK.
  return (environment: Record<string, unknown>) => new Function(
    'environment',
    'with (environment) { ' + compiled + '; return action; }',
  )(environment) as (promptOverride?: string) => Promise<void>;
}

describe('coordinator conversation mobile transport and view journal', () => {
  test('uses only canonical paired identities and rejects SDK/path/child fallbacks', () => {
    const selectedSession = {
      id: 'sdk-session-a',
      projectId: 'project-a',
      // Engine sessions can retain an unrelated projectID/hash.
      projectID: 'engine-project-hash',
      parentID: undefined,
      rhythm: { localSessionId: 'local-root-a' },
    };
    const base = {
      actorKey: 'user:7:host:mac-1',
      pairedClient,
      currentSessionId: 'sdk-session-a',
      selectedSession: selectedSession as never,
      activeProjectPath: 'project-a',
      activeProject: { id: 'project-a', path: 'project-a', label: 'A', source: 'server' as const },
      openProjectSessionState: { kind: 'idle' as const },
      registeredGatewayProjectIds: new Set(['project-a']),
      coordinatorSessionProvenance: currentScopeProof(),
    };
    expect(resolveMobileCoordinatorBinding(base)).toEqual({
      available: true,
      binding: { ...binding, source: 'paired_catalog' },
    });
    // A direct-mode path is never accepted as an opaque paired catalog ID.
    expect(resolveMobileCoordinatorBinding({
      ...base,
      activeProjectPath: '/filesystem/project-a',
      activeProject: { ...base.activeProject, id: '/filesystem/project-a', path: '/filesystem/project-a' },
    }).available).toBe(false);
    expect(resolveMobileCoordinatorBinding({
      ...base,
      selectedSession: { ...selectedSession, rhythm: undefined } as never,
    }).available).toBe(false);
    expect(resolveMobileCoordinatorBinding({
      ...base,
      selectedSession: { ...selectedSession, parentID: 'sdk-parent' } as never,
    }).available).toBe(false);
    expect(resolveMobileCoordinatorBinding({ ...base, pairedClient: null }).available).toBe(false);
  });

  test('accepts actual paired mirror and engine-projectID catalog shapes only with current scope proof', () => {
    const shared = {
      actorKey: 'user:7:host:mac-1',
      pairedClient,
      currentSessionId: 'sdk-session-a',
      activeProjectPath: 'project-a',
      activeProject: { id: 'project-a', path: 'project-a', label: 'A', source: 'server' as const },
      registeredGatewayProjectIds: new Set(['project-a']),
      coordinatorSessionProvenance: currentScopeProof(),
    };
    expect(resolveMobileCoordinatorBinding({
      ...shared,
      selectedSession: {
        id: 'sdk-session-a', projectId: 'project-a', parentID: undefined,
        rhythm: { localSessionId: 'local-root-a' },
      } as never,
      openProjectSessionState: { kind: 'idle' },
    }).available).toBe(true);
    expect(resolveMobileCoordinatorBinding({
      ...shared,
      selectedSession: {
        id: 'sdk-session-a', projectID: 'engine-project-hash', parentID: undefined,
        rhythm: { localSessionId: 'local-root-a' },
      } as never,
      openProjectSessionState: {
        kind: 'ready', generation: 3, projectId: 'project-a', sessionId: 'sdk-session-a',
      },
    }).available).toBe(true);
    expect(resolveMobileCoordinatorBinding({
      ...shared,
      selectedSession: {
        id: 'sdk-session-a', projectId: 'foreign-project', parentID: undefined,
        rhythm: { localSessionId: 'local-root-a' },
      } as never,
      openProjectSessionState: { kind: 'idle' },
    }).available).toBe(false);
    expect(resolveMobileCoordinatorBinding({
      ...shared,
      coordinatorSessionProvenance: currentScopeProof({ actorKey: 'user:other:host:mac-1' }),
      selectedSession: {
        id: 'sdk-session-a', projectId: 'project-a', parentID: undefined,
        rhythm: { localSessionId: 'local-root-a' },
      } as never,
      openProjectSessionState: { kind: 'ready', generation: 5, projectId: 'project-a', sessionId: 'sdk-session-a' },
    }).available).toBe(false);
    expect(resolveMobileCoordinatorBinding({
      ...shared,
      coordinatorSessionProvenance: undefined,
      selectedSession: {
        id: 'sdk-session-a', projectID: 'engine-project-hash', parentID: undefined,
        rhythm: { localSessionId: 'local-root-a' },
      } as never,
      // A stale ready selection alone cannot promote cached data to a paired
      // coordinator binding after an owner or host change.
      openProjectSessionState: { kind: 'ready', generation: 6, projectId: 'project-a', sessionId: 'sdk-session-a' },
    }).available).toBe(false);
    expect(resolveMobileCoordinatorBinding({
      ...shared,
      selectedSession: {
        id: 'sdk-session-a', projectID: 'engine-project-hash', parentID: undefined,
        rhythm: { localSessionId: 'local-root-a' },
      } as never,
      openProjectSessionState: {
        kind: 'ready', generation: 4, projectId: 'foreign-project', sessionId: 'sdk-session-a',
      },
    }).available).toBe(false);
  });

  test('serializes exact paired C1 fields, project scope, and no caller auth/actor fields', async () => {
    const requests: { path: string; init: RequestInit }[] = [];
    const client = {
      fetchResponse: async (path: string, init: RequestInit) => {
        requests.push({ path, init });
        return {
          status: 201,
          json: async () => ({ kind: 'created', conversation: conversation() }),
        } as Response;
      },
    };
    const transport = createPairedCoordinatorConversationGateway(client as never);
    await transport.open({ sessionId: binding.sessionId, projectId: binding.projectId });
    await transport.message({
      sessionId: binding.sessionId,
      projectId: binding.projectId,
      expectedControlRevision: 1,
      commandKey: 'command-1',
      message: 'Add a workstream: keep the first goal',
    });

    expect(requests.map((request) => request.path)).toEqual([
      '/mobile-gateway/coordinator-conversations/open',
      '/mobile-gateway/coordinator-conversations/message',
    ]);
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      sessionId: 'local-root-a',
      projectId: 'project-a',
    });
    expect(JSON.parse(String(requests[1].init.body))).toEqual({
      sessionId: 'local-root-a',
      projectId: 'project-a',
      expectedControlRevision: 1,
      commandKey: 'command-1',
      message: 'Add a workstream: keep the first goal',
    });
    expect(requests.every((request) => {
      const headers = request.init.headers as Record<string, string> | undefined;
      return headers?.['X-Rhythm-Project-ID'] === 'project-a';
    })).toBe(true);
    expect(requests.every((request) => {
      const headers = request.init.headers as Record<string, string> | undefined;
      return !headers || !('Authorization' in headers);
    })).toBe(true);
    expect(JSON.stringify(requests.map((request) => request.init.body))).not.toContain('actorKey');
  });

  test('rejects malformed, wrong-status, and foreign conversation responses before view state', () => {
    const foreign = {
      kind: 'created',
      conversation: { ...conversation(), sessionId: 'another-root' },
    };
    expect(parseMobileCoordinatorResult(foreign, binding, 201)).toBeUndefined();
    expect(parseMobileCoordinatorResult({ kind: 'created', conversation: conversation() }, binding, 200)).toBeUndefined();
    expect(parseMobileCoordinatorResult({ kind: 'status', conversation: conversation() }, binding, 200)).toBeUndefined();
  });

  test('uses the paired C2 resolve and finite-plan contracts without bearer, actor, or reasoning fields', async () => {
    const requests: { path: string; init: RequestInit }[] = [];
    const client = {
      fetchResponse: async (path: string, init: RequestInit) => {
        requests.push({ path, init });
        if (path.endsWith('/resolve')) {
          return {
            status: 200,
            json: async () => ({
              kind: 'resolved', created: false, sessionId: binding.sessionId,
              projectId: binding.projectId, conversation: c2Conversation(),
            }),
          } as Response;
        }
        if (path.endsWith('/prepare-plan')) {
          return {
            status: 200,
            json: async () => ({ kind: 'planned', conversation: c2Conversation(2), workstream: plannedWorkstream() }),
          } as Response;
        }
        return {
          status: 200,
          json: async () => ({ kind: 'continuation_available', conversation: c2Conversation(3), workstreamId: 'workstream-a', remainingTurns: 1 }),
        } as Response;
      },
    };
    const transport = createPairedCoordinatorConversationGateway(client as never);
    await expect(transport.resolve?.({ projectId: binding.projectId })).resolves.toMatchObject({ kind: 'resolved' });
    const admission = {
      commandKey: 'finite-command-a', totalTokenAuthorization: 20000, maxTurns: 2 as const,
      maxWallTimeSeconds: 90, expiresInSeconds: 900,
      acknowledgesSoftTotalTokenAuthorization: true as const, purpose: 'decompose' as const,
    };
    await expect(transport.preparePlan?.({
      sessionId: binding.sessionId, projectId: binding.projectId, expectedControlRevision: 1, goalId: 'goal-a', admission,
    })).resolves.toMatchObject({ kind: 'planned' });
    const executionAdmission = {
      ...admission,
      commandKey: 'finite-command-execute',
      purpose: 'execute' as const,
      acknowledgesScopedWorkspaceExecution: true as const,
    };
    await expect(transport.preparePlan?.({
      sessionId: binding.sessionId, projectId: binding.projectId, expectedControlRevision: 2, goalId: 'goal-a', admission: executionAdmission,
    })).resolves.toMatchObject({ kind: 'planned' });
    await expect(transport.continuePlan?.({
      sessionId: binding.sessionId, projectId: binding.projectId, expectedControlRevision: 3, goalId: 'goal-a', authorizationId: 'authority-a',
    })).resolves.toMatchObject({ kind: 'continuation_available' });
    expect(requests.map((request) => JSON.parse(String(request.init.body)))).toEqual([
      { projectId: 'project-a' },
      { sessionId: 'local-root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a', admission },
      { sessionId: 'local-root-a', projectId: 'project-a', expectedControlRevision: 2, goalId: 'goal-a', admission: executionAdmission },
      { sessionId: 'local-root-a', projectId: 'project-a', expectedControlRevision: 3, goalId: 'goal-a', authorizationId: 'authority-a' },
    ]);
    expect(requests.every((request) => {
      const headers = request.init.headers as Record<string, string> | undefined;
      return headers?.['X-Rhythm-Project-ID'] === 'project-a' && !headers?.Authorization;
    })).toBe(true);
    expect(JSON.stringify(requests.map((request) => request.init.body))).not.toMatch(/actorKey|thinkingBudget|Bearer/);
  });

  test('uses the device-authenticated setup route before a project scope and retains one opaque profile choice key', async () => {
    const requests: { path: string; init: RequestInit }[] = [];
    const client = {
      fetchResponse: async (path: string, init: RequestInit) => {
        requests.push({ path, init });
        const body = JSON.parse(String(init.body));
        if (body.profileId === undefined) {
          return {
            status: 200,
            json: async () => ({ kind: 'setup_profile_choice_required', profileChoices: [{ id: 'profile-b', label: 'Profile B' }] }),
          } as Response;
        }
        return {
          status: 201,
          json: async () => ({
            kind: 'setup_created', sessionId: binding.sessionId, projectId: binding.projectId,
            profileId: 'profile-b', workspaceGeneration: 1, conversation: c2Conversation(),
          }),
        } as Response;
      },
    };
    const transport = createPairedCoordinatorConversationGateway(client as never);
    await expect(transport.setup?.({ commandKey: 'setup-command-a' })).resolves.toEqual({
      kind: 'setup_profile_choice_required', profileChoices: [{ id: 'profile-b', label: 'Profile B' }],
    });
    await expect(transport.setup?.({ commandKey: 'setup-command-a', profileId: 'profile-b' })).resolves.toMatchObject({ kind: 'setup_created' });
    expect(requests.map((request) => JSON.parse(String(request.init.body)))).toEqual([
      { commandKey: 'setup-command-a' },
      { commandKey: 'setup-command-a', profileId: 'profile-b' },
    ]);
    expect(requests.every((request) => new Headers(request.init.headers).get('x-rhythm-project-id') === null)).toBe(true);
    expect(JSON.stringify(requests.map((request) => request.init.body))).not.toMatch(/actorKey|projectId|model|grant|Bearer/);
    expect(parseMobileCoordinatorSetupResult({
      kind: 'setup_created', sessionId: 'foreign-root', projectId: binding.projectId,
      profileId: 'profile-b', workspaceGeneration: 1, conversation: c2Conversation(),
    }, 201)).toBeUndefined();
  });

  test('rejects foreign C2 root and non-status-view planning envelopes', () => {
    expect(parseMobileCoordinatorResolveResult({
      kind: 'resolved', created: false, sessionId: binding.sessionId, projectId: binding.projectId,
      conversation: { ...c2Conversation(), sessionId: 'foreign-root' },
    }, 200)).toBeUndefined();
    expect(parseMobileCoordinatorResolveResult({
      kind: 'resolved', created: false, sessionId: binding.sessionId, projectId: binding.projectId,
      conversation: { ...c2Conversation(), primaryOwnerRoot: false },
    }, 200)).toBeUndefined();
    expect(parseMobileCoordinatorPlanResult({
      kind: 'planned', conversation: c2Conversation(), workstream: { id: 'workstream-a', state: 'queued' },
    }, { sessionId: binding.sessionId, projectId: binding.projectId }, 200)).toBeUndefined();
    expect(parseMobileCoordinatorPlanResult({ kind: 'status', conversation: c2Conversation(), context: context() }, binding, 200)).toBeUndefined();
  });

  test('keeps foreground acknowledgement separate from canonical history and replays paired project selection first', async () => {
    const requests: { path: string; body: Record<string, unknown> }[] = [];
    const client = {
      fetchResponse: async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ path, body });
        if (path.endsWith('/resolve')) {
          return {
            status: 200,
            json: async () => ({
              kind: 'canonical_project_switch_required',
              projectId: 'project-b', sessionId: binding.sessionId, controlRevision: 3,
            }),
          } as Response;
        }
        if (path.endsWith('/history')) {
          return {
            status: 200,
            json: async () => ({
              kind: 'history', conversation: c2Conversation(), messages: [{
                id: 12, sessionId: binding.sessionId, role: 'output', rawText: 'Persisted reply',
                strippedText: 'Persisted reply', createdAt: '2026-10-05T00:00:00.000Z',
                sdkMessageId: 'sdk-12', parts: [{ type: 'text', text: 'Persisted reply' }], tokens: null, cost: null,
              }], nextCursor: null, hasMore: false,
            }),
          } as Response;
        }
        return { status: 200, json: async () => ({ kind: 'foreground_accepted', conversation: c2Conversation() }) } as Response;
      },
    };
    const transport = createPairedCoordinatorConversationGateway(client as never);
    await expect(transport.resolve?.({ projectId: binding.projectId })).resolves.toEqual({
      kind: 'canonical_project_switch_required', projectId: 'project-b', sessionId: binding.sessionId, controlRevision: 3,
    });
    const accepted = await transport.message({
      ...binding, expectedControlRevision: 1, commandKey: 'foreground-a', message: 'What should I do today?',
    });
    const history = await transport.history?.({ ...binding, limit: 50 });
    expect(accepted.kind).toBe('foreground_accepted');
    expect(history?.messages).toHaveLength(1);
    expect(requests.map((request) => request.body)).toEqual([
      { projectId: 'project-a' },
      {
        sessionId: 'local-root-a', projectId: 'project-a', expectedControlRevision: 1,
        commandKey: 'foreground-a', message: 'What should I do today?',
      },
      { sessionId: 'local-root-a', projectId: 'project-a', limit: 50 },
    ]);
    expect(parseMobileCoordinatorHistoryResult({
      kind: 'history', conversation: c2Conversation(), messages: [{
        id: 12, sessionId: 'foreign-root', role: 'output', rawText: 'no', strippedText: 'no',
        createdAt: '2026-10-05T00:00:00.000Z', sdkMessageId: null, parts: [], tokens: null, cost: null,
      }], nextCursor: null, hasMore: false,
    }, binding, 200)).toBeUndefined();
  });

  test('foreground uncertainty retains its exact command without fabricating an assistant result', async () => {
    let calls = 0;
    const controller = new MobileCoordinatorConversationController(() => gateway({
      open: async () => ({ kind: 'replay', conversation: c2Conversation() }),
      message: async () => {
        calls += 1;
        return { kind: 'foreground_uncertain', conversation: c2Conversation() };
      },
    }));
    await controller.open(binding);
    const result = await controller.send(binding, 'Tell me what changed yesterday');
    expect(result.accepted).toBe(false);
    expect(calls).toBe(1);
    expect(controller.get(binding).pendingCommand?.message).toBe('Tell me what changed yesterday');
    expect(controller.get(binding).notice?.message).toMatch(/not resent automatically/i);
  });

  test('retains actual bounded canonical rows after opening without manufacturing an acknowledgement', async () => {
    const historyCalls: { sessionId: string; projectId: string; limit: number }[] = [];
    const controller = new MobileCoordinatorConversationController(() => gateway({
      history: async (input) => {
        historyCalls.push(input);
        return {
          kind: 'history',
          conversation: conversation(),
          messages: [{
            id: 12,
            sessionId: binding.sessionId,
            role: 'output',
            rawText: 'Existing canonical reply',
            strippedText: 'Existing canonical reply',
            createdAt: '2026-10-05T00:00:00.000Z',
            sdkMessageId: 'sdk-message-12',
            parts: [],
            tokens: null,
            cost: null,
          }],
          nextCursor: '11',
          hasMore: true,
        };
      },
    }));

    await controller.open(binding);
    await flush();

    expect(historyCalls).toEqual([{
      sessionId: binding.sessionId,
      projectId: binding.projectId,
      limit: 50,
    }]);
    expect(controller.get(binding).canonicalHistory).toMatchObject({
      kind: 'history',
      hasMore: true,
      messages: [{
        id: 12,
        sessionId: binding.sessionId,
        role: 'output',
        sdkMessageId: 'sdk-message-12',
        rawText: 'Existing canonical reply',
      }],
    });
  });

  test('maps persisted canonical roles and parts through the normal mobile transcript formatter', () => {
    const entries = mapMobileCoordinatorHistory([
      {
        id: 9,
        sessionId: binding.sessionId,
        role: 'input',
        rawText: 'Ask what to do today',
        strippedText: 'Ask what to do today',
        createdAt: '2026-10-05T00:00:00.000Z',
        sdkMessageId: 'sdk-user-9',
        parts: [{ type: 'text', text: 'Ask what to do today' }],
        tokens: null,
        cost: null,
      },
      {
        id: 10,
        sessionId: binding.sessionId,
        role: 'output',
        rawText: 'A stored response',
        strippedText: 'A stored response',
        createdAt: '2026-10-05T00:00:01.000Z',
        sdkMessageId: 'sdk-agent-10',
        parts: [{ type: 'text', text: 'A stored response' }],
        tokens: null,
        cost: 0.02,
      },
    ]);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sdk-user-9', role: 'user', text: 'Ask what to do today', origin: 'coordinator' }),
      expect.objectContaining({ id: 'sdk-agent-10', role: 'assistant', text: 'A stored response', origin: 'coordinator' }),
    ]));
  });

  test('merges the next older canonical page without duplicating a persisted row', async () => {
    const historyCalls: { beforeId?: number }[] = [];
    const row = (id: number, text: string) => ({
      id, sessionId: binding.sessionId, role: 'output' as const, rawText: text, strippedText: text,
      createdAt: '2026-10-05T00:00:00.000Z', sdkMessageId: `sdk-${id}`,
      parts: [{ type: 'text', text }], tokens: null, cost: null,
    });
    const controller = new MobileCoordinatorConversationController(() => gateway({
      history: async (input) => {
        historyCalls.push(input);
        return input.beforeId === undefined
          ? { kind: 'history' as const, conversation: conversation(), messages: [row(11, 'current'), row(12, 'newer')], nextCursor: '11', hasMore: true }
          : { kind: 'history' as const, conversation: conversation(), messages: [row(9, 'older'), row(11, 'current')], nextCursor: null, hasMore: false };
      },
    }));
    await controller.open(binding);
    await flush();
    expect(await controller.loadOlderHistory(binding)).toBe(true);
    expect(historyCalls.at(-1)).toEqual(expect.objectContaining({ beforeId: 11 }));
    expect(controller.get(binding).canonicalHistory?.messages.map((message) => message.id)).toEqual([9, 11, 12]);
  });

  test('adds first and second durable goals in the same scoped chat', async () => {
    const calls: string[] = [];
    const controller = new MobileCoordinatorConversationController(() => gateway({
      message: async (input) => {
        calls.push(input.message);
        const goals = calls.map((message, index) => ({
          id: 'goal-' + (index + 1),
          commandKey: 'command-' + (index + 1),
          objective: message.replace(/^Add a workstream:\s*/, ''),
          state: 'captured' as const,
          linkedWorkstreamId: null,
        }));
        return { kind: 'created', conversation: conversation(calls.length + 1, goals), goal: goals.at(-1) };
      },
    }));
    await controller.open(binding);
    await flush();
    expect((await controller.send(binding, 'Add a workstream: first idea')).accepted).toBe(true);
    expect((await controller.send(binding, 'I have another idea: second idea')).accepted).toBe(true);
    expect(controller.get(binding).conversation?.goals.map((goal) => goal.objective)).toEqual([
      'first idea',
      'I have another idea: second idea',
    ]);
    expect(calls).toEqual(['Add a workstream: first idea', 'I have another idea: second idea']);
  });

  test('keeps one explicit C2 finite consent request across an interrupted acknowledgement', async () => {
    const attempts: Record<string, unknown>[] = [];
    let call = 0;
    const controller = new MobileCoordinatorConversationController(() => gateway({
      open: async () => ({ kind: 'replay', conversation: c2Conversation() }),
      status: async () => ({ kind: 'status', conversation: c2Conversation(), context: context() }),
      preparePlan: async (input) => {
        attempts.push(input as unknown as Record<string, unknown>);
        call += 1;
        if (call === 1) throw new Error('invented interrupted acknowledgement');
        return { kind: 'planned', conversation: c2Conversation(2), workstream: plannedWorkstream() };
      },
      message: async () => { throw new Error('ordinary SDK/coordinator message path is not a planning fallback'); },
    }), createMemoryMobileCoordinatorJournal());
    await controller.open(binding);
    await flush();
    const consent = {
      totalTokenAuthorization: 20000,
      maxTurns: 2 as const,
      maxWallTimeSeconds: 90,
      expiresInSeconds: 900,
      acknowledgesSoftTotalTokenAuthorization: true as const,
      purpose: 'decompose' as const,
    };
    expect(await controller.preparePlan(binding, 'goal-a', consent)).toBe(false);
    expect(controller.get(binding).pendingPlan).toEqual({ goalId: 'goal-a', kind: 'prepare' });
    expect(controller.get(binding).notice?.retryable).toBe(true);
    expect(await controller.retryPlan(binding)).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]).not.toHaveProperty('thinkingBudget');
    expect(String(controller.get(binding).notice?.message)).toMatch(/not verification/i);
    expect(controller.get(binding).plannedWorkstream).toEqual(plannedWorkstream());
  });

  test('returning to normal before queued finite planning reaches the paired wire blocks prepare and continue', async () => {
    const consent = {
      totalTokenAuthorization: 20000,
      maxTurns: 2 as const,
      maxWallTimeSeconds: 90,
      expiresInSeconds: 900,
      acknowledgesSoftTotalTokenAuthorization: true as const,
      purpose: 'decompose' as const,
    };
    for (const operation of ['prepare', 'continue'] as const) {
      const calls: string[] = [];
      const controller = new MobileCoordinatorConversationController(() => gateway({
        open: async () => ({ kind: 'replay', conversation: c2Conversation() }),
        status: async () => ({ kind: 'status', conversation: c2Conversation(), context: context() }),
        message: async () => { throw new Error('ordinary message must not run'); },
        preparePlan: async () => { calls.push('prepare'); throw new Error('must not reach prepare wire'); },
        continuePlan: async () => { calls.push('continue'); throw new Error('must not reach continue wire'); },
      }), createMemoryMobileCoordinatorJournal());
      await controller.open(binding);
      await flush();
      const pending = operation === 'prepare'
        ? controller.preparePlan(binding, 'goal-a', consent)
        : controller.continuePlan(binding, 'goal-a', 'authority-a');
      controller.returnToNormal(binding);
      expect(await pending).toBe(false);
      expect(calls).toEqual([]);
      expect(controller.get(binding).enabled).toBe(false);
      const staleCallback = operation === 'prepare'
        ? controller.preparePlan(binding, 'goal-a', consent)
        : controller.continuePlan(binding, 'goal-a', 'authority-a');
      expect(await staleCallback).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  test('keeps the exact uncertain command across retry, normal-mode exit, and reopen', async () => {
    const sent: { commandKey: string; expectedControlRevision: number; message: string }[] = [];
    let attempt = 0;
    const controller = new MobileCoordinatorConversationController(() => gateway({
      message: async (input) => {
        sent.push(input);
        attempt += 1;
        if (attempt === 1) throw new Error('network down');
        return { kind: 'created', conversation: conversation(2, [{
          id: 'goal-1',
          commandKey: input.commandKey,
          objective: 'durable idea',
          state: 'captured',
          linkedWorkstreamId: null,
        }]) };
      },
    }));
    await controller.open(binding);
    await flush();
    expect((await controller.send(binding, 'Add a workstream: durable idea')).accepted).toBe(false);
    const pending = controller.get(binding).pendingCommand;
    expect(pending).toMatchObject({ expectedControlRevision: 1, message: 'Add a workstream: durable idea' });
    controller.returnToNormal(binding);
    controller.activate({ ...binding, uiSessionId: 'sdk-session-b', sessionId: 'local-root-b' });
    controller.activate(binding);
    await controller.open(binding);
    await flush();
    expect(controller.get(binding).pendingCommand).toEqual(pending);
    expect(await controller.retry(binding)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  test('ignores A to B to A late acknowledgements and admits only one in-flight command', async () => {
    const late = deferred<MobileCoordinatorResult>();
    let messageCalls = 0;
    let openCalls = 0;
    const controller = new MobileCoordinatorConversationController(() => gateway({
      open: async () => {
        openCalls += 1;
        return { kind: 'replay', conversation: conversation() };
      },
      message: async () => {
        messageCalls += 1;
        return late.promise;
      },
    }));
    await controller.open(binding);
    await flush();
    const first = controller.send(binding, 'Add a workstream: wait');
    const second = controller.send(binding, 'Add a workstream: wait');
    await flush();
    expect(messageCalls).toBe(1);
    controller.activate({ ...binding, uiSessionId: 'sdk-session-b', sessionId: 'local-root-b' });
    controller.activate(binding);
    await controller.open(binding);
    late.resolve({
      kind: 'created',
      conversation: conversation(2, [{
        id: 'stale-goal',
        commandKey: 'stale-command',
        objective: 'should not install',
        state: 'captured',
        linkedWorkstreamId: null,
      }]),
    });
    await Promise.all([first, second]);
    expect(openCalls).toBeGreaterThanOrEqual(2);
    expect(controller.get(binding).conversation?.goals).toEqual([]);
  });

  test('a 409 requires explicit refresh/review and a separate new-message action', async () => {
    const sent: { commandKey: string; expectedControlRevision: number }[] = [];
    let messageResult: MobileCoordinatorResult = {
      kind: 'revision_conflict',
      conversation: conversation(2),
    };
    const controller = new MobileCoordinatorConversationController(() => gateway({
      status: async () => statusResult(3),
      message: async (input) => {
        sent.push({ commandKey: input.commandKey, expectedControlRevision: input.expectedControlRevision });
        return messageResult;
      },
    }));
    await controller.open(binding);
    await flush();
    expect((await controller.send(binding, 'Add a workstream: conflict')).accepted).toBe(false);
    expect(controller.get(binding).phase).toBe('review');
    expect(sent).toHaveLength(1);
    expect(await controller.reviewConflict(binding)).toBe(true);
    expect(controller.get(binding).reviewedConflictRevision).toBe(3);
    expect(await controller.beginNewMessageAfterReview(binding)).toBe(true);
    expect(sent).toHaveLength(1);
    messageResult = { kind: 'created', conversation: conversation(4, [{
      id: 'goal-2',
      commandKey: 'new-command',
      objective: 'conflict resolved',
      state: 'captured',
      linkedWorkstreamId: null,
    }]) };
    await controller.send(binding, 'Add a workstream: conflict resolved');
    expect(sent).toHaveLength(2);
    expect(sent[1].commandKey).not.toBe(sent[0].commandKey);
    expect(sent[1].expectedControlRevision).toBe(3);
  });

  test('only a direct 409 is persisted as rejection; local review and status refresh keep an uncertain command', async () => {
    const journal = createMemoryMobileCoordinatorJournal();
    const first = new MobileCoordinatorConversationController(() => gateway({
      message: async () => { throw new Error('response lost after possible admission'); },
      status: async () => statusResult(2),
    }), journal);
    await first.open(binding);
    await flush();
    expect((await first.send(binding, 'Add a workstream: immutable uncertain command')).accepted).toBe(false);
    const pending = first.get(binding).pendingCommand;
    // Editing toward a second idea and reading status are local/view actions,
    // not server evidence that the first write was rejected.
    await first.send(binding, 'Add a workstream: edited idea');
    await first.reviewConflict(binding);
    expect(await first.beginNewMessageAfterReview(binding)).toBe(false);
    await flush();
    first.dispose();

    const recreated = new MobileCoordinatorConversationController(() => gateway({
      message: async () => { throw new Error('must reuse original command'); },
      status: async () => statusResult(2),
    }), journal);
    await recreated.open(binding);
    await flush();
    expect(recreated.get(binding).pendingCommand).toEqual(pending);
    expect(recreated.get(binding).pendingProvenance).toBe('uncertain');
  });

  test('serializes whole-map journal writes and never overwrites corrupt command bytes', async () => {
    let raw: string | null = null;
    const storage = {
      getItem: jest.fn(async () => raw),
      setItem: jest.fn(async (_key: string, next: string) => { raw = next; }),
    };
    const journal = createMobileCoordinatorJournal(storage as never);
    const bindingB = { ...binding, uiSessionId: 'sdk-session-b', sessionId: 'local-root-b' };
    const snapshot = {
      viewEnabled: true,
      pendingCommand: { commandKey: 'command-a', expectedControlRevision: 1, message: 'first exact command' },
      pendingProvenance: 'uncertain' as const,
      writeRevision: 2,
    };
    await Promise.all([journal.save(binding, snapshot), journal.save(bindingB, {
      ...snapshot,
      pendingCommand: { commandKey: 'command-b', expectedControlRevision: 1, message: 'second exact command' },
    })]);
    expect((await journal.load(binding))?.pendingCommand?.commandKey).toBe('command-a');
    expect((await journal.load(bindingB))?.pendingCommand?.commandKey).toBe('command-b');

    const delayedRead = deferred<string | null>();
    let delayedRaw: string | null = null;
    let reads = 0;
    const orderedJournal = createMobileCoordinatorJournal({
      getItem: async () => {
        reads += 1;
        return reads === 1 ? delayedRead.promise : delayedRaw;
      },
      setItem: async (_key: string, next: string) => { delayedRaw = next; },
    } as never);
    const olderViewOnly = orderedJournal.save(binding, { viewEnabled: true, writeRevision: 1 });
    const newerCommand = orderedJournal.save(binding, snapshot);
    await flush();
    delayedRead.resolve(null);
    await Promise.all([olderViewOnly, newerCommand]);
    expect((await orderedJournal.load(binding))?.pendingCommand?.commandKey).toBe('command-a');

    raw = 'not valid coordinator journal json';
    expect(await journal.save(binding, snapshot)).toBe(false);
    expect(raw).toBe('not valid coordinator journal json');
    let messageCalls = 0;
    const blocked = new MobileCoordinatorConversationController(() => gateway({
      message: async () => {
        messageCalls += 1;
        return { kind: 'created', conversation: conversation(2) };
      },
    }), journal);
    expect(await blocked.open(binding)).toBe(false);
    expect((await blocked.send(binding, 'Add a workstream: must not reach wire')).accepted).toBe(false);
    expect(messageCalls).toBe(0);
    expect(raw).toBe('not valid coordinator journal json');

    const unknownRaw = JSON.stringify({
      [JSON.stringify([binding.actorKey, binding.projectId, binding.sessionId, binding.uiSessionId])]: {
        version: 1,
        actorKey: binding.actorKey,
        projectId: binding.projectId,
        sessionId: binding.sessionId,
        uiSessionId: binding.uiSessionId,
        viewEnabled: true,
        unrecognizedFutureControl: true,
      },
    });
    raw = unknownRaw;
    expect(await journal.save(binding, snapshot)).toBe(false);
    expect(raw).toBe(unknownRaw);
    let unknownMessageCalls = 0;
    const unknownBlocked = new MobileCoordinatorConversationController(() => gateway({
      message: async () => {
        unknownMessageCalls += 1;
        return { kind: 'created', conversation: conversation(2) };
      },
    }), journal);
    expect(await unknownBlocked.open(binding)).toBe(false);
    expect((await unknownBlocked.send(binding, 'Add a workstream: unknown bytes must not reach wire')).accepted).toBe(false);
    expect(unknownMessageCalls).toBe(0);
    expect(raw).toBe(unknownRaw);
  });

  test('shares the AsyncStorage journal queue across remounted factories', async () => {
    let raw: string | null = null;
    const staleReadEntered = deferred<void>();
    const releaseStaleRead = deferred<void>();
    let holdNextRead = false;
    const storage = {
      getItem: async () => {
        if (!holdNextRead) return raw;
        holdNextRead = false;
        const captured = raw;
        staleReadEntered.resolve();
        await releaseStaleRead.promise;
        return captured;
      },
      setItem: async (_key: string, next: string) => { raw = next; },
    };
    const staleFactory = createMobileCoordinatorJournal(storage as never);
    const newerFactory = createMobileCoordinatorJournal(storage as never);
    const remountedFactory = createMobileCoordinatorJournal(storage as never);
    const original = {
      viewEnabled: true,
      pendingCommand: {
        commandKey: 'cross-factory-original',
        expectedControlRevision: 1,
        message: 'Keep the original durable command',
      },
      pendingProvenance: 'uncertain' as const,
      pendingState: 'retry' as const,
      writeRevision: 13,
    };

    holdNextRead = true;
    const lateStaleViewWrite = staleFactory.save(binding, { viewEnabled: true, writeRevision: 7 });
    await staleReadEntered.promise;
    const newerAdmission = newerFactory.save(binding, original);
    await flush();
    releaseStaleRead.resolve();
    await Promise.all([lateStaleViewWrite, newerAdmission]);

    expect((await remountedFactory.load(binding))?.pendingCommand).toEqual(original.pendingCommand);
    expect(await remountedFactory.save(binding, {
      ...original,
      pendingCommand: {
        commandKey: 'cross-factory-competing',
        expectedControlRevision: 1,
        message: 'Must not replace the original command',
      },
      writeRevision: 99,
    })).toBe(false);
    expect((await remountedFactory.load(binding))?.pendingCommand).toEqual(original.pendingCommand);
  });

  test('keeps a canonical-root command across server-primary and catalog UI pointers', async () => {
    const pending = {
      viewEnabled: true,
      pendingCommand: {
        commandKey: 'server-primary-command',
        expectedControlRevision: 1,
        message: 'Keep this exact server-root message',
      },
      pendingProvenance: 'uncertain' as const,
      pendingState: 'retry' as const,
      writeRevision: 5,
    };
    const serverPrimary = {
      ...binding,
      uiSessionId: 'server-primary:local-root-a',
      source: 'server_primary' as const,
    };
    const catalogRoot = { ...binding, uiSessionId: 'sdk-row-after-catalog-refresh' };
    const memoryJournal = createMemoryMobileCoordinatorJournal();
    expect(await memoryJournal.save(serverPrimary, pending)).toBe(true);
    expect((await memoryJournal.load(catalogRoot))?.pendingCommand).toEqual(pending.pendingCommand);
    expect(await memoryJournal.save(catalogRoot, {
      ...pending,
      pendingCommand: {
        commandKey: 'different-command',
        expectedControlRevision: 1,
        message: 'Must not replace the uncertain command',
      },
      writeRevision: 99,
    })).toBe(false);

    let raw = JSON.stringify({
      [JSON.stringify([binding.actorKey, binding.projectId, binding.sessionId, 'legacy-sdk-row'])]: {
        version: 1,
        actorKey: binding.actorKey,
        projectId: binding.projectId,
        sessionId: binding.sessionId,
        uiSessionId: 'legacy-sdk-row',
        ...pending,
      },
    });
    const durableJournal = createMobileCoordinatorJournal({
      getItem: async () => raw,
      setItem: async (_key: string, next: string) => { raw = next; },
    } as never);
    expect((await durableJournal.load(serverPrimary))?.pendingCommand).toEqual(pending.pendingCommand);
    expect(await durableJournal.save(catalogRoot, {
      ...pending,
      pendingCommand: {
        commandKey: 'different-legacy-command',
        expectedControlRevision: 1,
        message: 'Must not displace a legacy uncertain command',
      },
      writeRevision: 100,
    })).toBe(false);
    expect((await durableJournal.load(catalogRoot))?.pendingCommand).toEqual(pending.pendingCommand);
  });

  test('keeps an explicit server-primary draft separate from the ordinary catalog chat beneath it', () => {
    expect(coordinatorDraftScope({
      currentSessionId: 'ordinary-sdk-chat',
      serverPrimaryUiSessionId: 'server-primary:local-root-a',
    })).toBe('server-primary:local-root-a');
    expect(coordinatorDraftScope({ currentSessionId: 'ordinary-sdk-chat' })).toBe('ordinary-sdk-chat');
  });

  test('does not admit a different command when the serialized journal retains an older immutable one', async () => {
    const retained = {
      viewEnabled: true,
      pendingCommand: {
        commandKey: 'retained-command',
        expectedControlRevision: 1,
        message: 'Add a workstream: retained immutable command',
      },
      pendingProvenance: 'uncertain' as const,
      pendingState: 'retry' as const,
      writeRevision: 100,
    };
    const attempted = {
      ...retained,
      pendingCommand: {
        commandKey: 'different-command',
        expectedControlRevision: 1,
        message: 'Add a workstream: must not reach wire',
      },
      writeRevision: 1,
    };
    let raw: string | null = null;
    const journal = createMobileCoordinatorJournal({
      getItem: async () => raw,
      setItem: async (_key: string, next: string) => { raw = next; },
    } as never);
    expect(await journal.save(binding, retained)).toBe(true);
    expect(await journal.save(binding, attempted)).toBe(false);
    expect((await journal.load(binding))?.pendingCommand).toEqual(retained.pendingCommand);

    let messageCalls = 0;
    let controllerRaw: string | null = null;
    const controllerJournal = createMobileCoordinatorJournal({
      getItem: async () => controllerRaw,
      setItem: async (_key: string, next: string) => { controllerRaw = next; },
    } as never);
    const controller = new MobileCoordinatorConversationController(() => gateway({
      message: async () => {
        messageCalls += 1;
        return { kind: 'created', conversation: conversation(2) };
      },
    }), controllerJournal);
    // Open before another same-scope controller writes the retained entry so
    // this reaches the actual pre-wire save/adoption branch.
    await controller.open(binding);
    await flush();
    expect(await controllerJournal.save(binding, retained)).toBe(true);
    expect((await controller.send(binding, attempted.pendingCommand.message)).accepted).toBe(false);
    expect(messageCalls).toBe(0);
    expect(controller.get(binding).pendingCommand).toEqual(retained.pendingCommand);
  });

  test('stale view-only refreshes cannot retire another controller’s uncertain command', async () => {
    let raw: string | null = null;
    const journal = createMobileCoordinatorJournal({
      getItem: async () => raw,
      setItem: async (_key: string, value: string) => { raw = value; },
    } as never);
    const wires: { commandKey: string; expectedControlRevision: number; message: string }[] = [];
    const sharedGateway = gateway({
      message: async (input) => {
        wires.push(input);
        throw new Error('invented uncertain acknowledgement');
      },
    });
    const stale = new MobileCoordinatorConversationController(() => sharedGateway, journal);
    const owner = new MobileCoordinatorConversationController(() => sharedGateway, journal);

    await stale.open(binding);
    await flush();
    await owner.open(binding);
    await flush();
    expect((await owner.send(binding, 'Add a workstream: durable command from another controller')).accepted).toBe(false);
    await flush();
    const original = (await journal.load(binding))?.pendingCommand;
    expect(original).toBeTruthy();

    // The stale controller's view revision can grow beyond the durable one,
    // but a status-only snapshot has no evidence to replace this command.
    for (let index = 0; index < 20; index += 1) {
      await stale.refresh(binding);
      await flush();
    }
    expect((await journal.load(binding))?.pendingCommand).toEqual(original);

    expect((await stale.send(binding, 'Add a workstream: competing stale command')).accepted).toBe(false);
    await flush();
    expect(wires).toHaveLength(1);
    expect((await journal.load(binding))?.pendingCommand).toEqual(original);
    expect(stale.get(binding).pendingCommand).toEqual(original);
  });

  test('returning to normal while async journal admission is pending blocks the old wire', async () => {
    const admitted = deferred<void>();
    const release = deferred<void>();
    let held = false;
    let messageCalls = 0;
    const journal = {
      clearActor: async () => true,
      load: async () => undefined,
      remove: async () => true,
      save: async (_binding: MobileCoordinatorBinding, snapshot: { pendingCommand?: unknown }) => {
        if (snapshot.pendingCommand && !held) {
          held = true;
          admitted.resolve();
          await release.promise;
        }
        return true;
      },
    };
    const controller = new MobileCoordinatorConversationController(() => gateway({
      message: async () => {
        messageCalls += 1;
        return { kind: 'created', conversation: conversation(2) };
      },
    }), journal);
    await controller.open(binding);
    await flush();
    const pending = controller.send(binding, 'Add a workstream: exit before durable admission');
    await admitted.promise;
    controller.returnToNormal(binding);
    release.resolve();

    expect(await pending).toEqual({ accepted: false });
    expect(messageCalls).toBe(0);
    expect(controller.get(binding).enabled).toBe(false);
  });

  test('coordinator routing handles failures without normal SDK fallback and inactive chat makes no request', async () => {
    const send = jest.fn(async () => ({ accepted: false }));
    expect(await routeCoordinatorComposerInput({
      active: false,
      attachmentCount: 0,
      message: 'ordinary chat',
      send,
    })).toEqual({ handled: false, accepted: false });
    expect(send).not.toHaveBeenCalled();
    expect(await routeCoordinatorComposerInput({
      active: true,
      attachmentCount: 0,
      message: 'ambiguous coordinator idea',
      send,
    })).toEqual({ handled: true, accepted: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await routeCoordinatorComposerInput({
      active: true,
      attachmentCount: 1,
      message: 'with file',
      send,
    })).toMatchObject({ handled: true, accepted: false, reason: expect.stringMatching(/plaintext/i) });
  });

  test('keeps an indeterminate 201 acknowledgement retryable through the actual paired transport', async () => {
    const bodies: Record<string, unknown>[] = [];
    let messageAttempt = 0;
    const client = {
      fetchResponse: async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        if (path.endsWith('/open')) {
          return { status: 201, json: async () => ({ kind: 'created', conversation: conversation() }) } as Response;
        }
        if (path.endsWith('/status')) {
          return { status: 200, json: async () => statusResult() } as Response;
        }
        if (path.endsWith('/history')) {
          return {
            status: 200,
            json: async () => ({
              kind: 'history', conversation: conversation(), messages: [], nextCursor: null, hasMore: false,
            }),
          } as Response;
        }
        messageAttempt += 1;
        if (messageAttempt === 1) {
          return {
            status: 201,
            json: async () => ({ kind: 'created', conversation: { ...conversation(), sessionId: 'foreign-root' } }),
          } as Response;
        }
        return {
          status: 201,
          json: async () => ({ kind: 'created', conversation: conversation(2) }),
        } as Response;
      },
    };
    const controller = new MobileCoordinatorConversationController(
      () => createPairedCoordinatorConversationGateway(client as never),
      createMemoryMobileCoordinatorJournal(),
    );
    await controller.open(binding);
    await flush();
    expect((await controller.send(binding, 'Add a workstream: uncertain acknowledgement')).accepted).toBe(false);
    const pending = controller.get(binding).pendingCommand;
    expect(controller.get(binding).notice?.retryable).toBe(true);
    expect(await controller.retry(binding)).toBe(true);
    const messageBodies = bodies.filter((body) => body.message === 'Add a workstream: uncertain acknowledgement');
    expect(messageBodies).toHaveLength(2);
    expect(messageBodies[1]).toEqual(messageBodies[0]);
    expect(controller.get(binding).pendingCommand).toBeUndefined();
    expect(pending?.commandKey).toBe(String(messageBodies[0].commandKey));
  });

  test('persists an uncertain command across temporary ineligibility and controller recreation', async () => {
    const journal = createMemoryMobileCoordinatorJournal();
    const sent: { commandKey: string; expectedControlRevision: number; message: string }[] = [];
    let succeeds = false;
    const makeController = () => new MobileCoordinatorConversationController(() => gateway({
      message: async (input) => {
        sent.push(input);
        if (!succeeds) throw new Error('temporary network failure');
        return { kind: 'created', conversation: conversation(2) };
      },
    }), journal);
    const first = makeController();
    await first.open(binding);
    await flush();
    expect((await first.send(binding, 'Add a workstream: retain this exact command')).accepted).toBe(false);
    const pending = first.get(binding).pendingCommand;
    first.activate(null);
    first.activate(binding);
    await first.open(binding);
    await flush();
    expect(first.get(binding).pendingCommand).toEqual(pending);
    first.returnToNormal(binding);
    first.dispose();

    const recreated = makeController();
    await recreated.open(binding);
    await flush();
    expect(recreated.get(binding).pendingCommand).toEqual(pending);
    succeeds = true;
    expect(await recreated.retry(binding)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  test('a missing paired gateway releases its operation slot when the connection returns', async () => {
    let currentGateway: MobileCoordinatorGateway | undefined;
    let openCalls = 0;
    const controller = new MobileCoordinatorConversationController(
      () => currentGateway,
      createMemoryMobileCoordinatorJournal(),
    );
    expect(await controller.open(binding)).toBe(false);
    currentGateway = gateway({
      open: async () => {
        openCalls += 1;
        return { kind: 'replay', conversation: conversation() };
      },
    });
    expect(await controller.open(binding)).toBe(true);
    expect(openCalls).toBe(1);
  });

  test('holds a draft locally when command-journal persistence fails before wire exposure', async () => {
    let messageCalls = 0;
    const unavailableJournal = {
      clearActor: async () => true,
      load: async () => undefined,
      remove: async () => true,
      save: async () => false,
    };
    const controller = new MobileCoordinatorConversationController(
      () => gateway({ message: async () => {
        messageCalls += 1;
        return { kind: 'created', conversation: conversation(2) };
      } }),
      unavailableJournal,
    );
    await controller.open(binding);
    await flush();
    expect((await controller.send(binding, 'Add a workstream: do not expose')).accepted).toBe(false);
    expect(messageCalls).toBe(0);
    expect(controller.get(binding).pendingCommand?.message).toBe('Add a workstream: do not expose');
    expect(controller.get(binding).notice?.retryable).toBe(true);
  });

  test('blocks SDK continuous conversation while coordinating but leaves plaintext dictation available', async () => {
    const toggle = jest.fn(async () => undefined);
    await expect(routeCoordinatorConversationToggle({
      coordinatorActive: true,
      conversationActive: false,
      toggleConversationMode: toggle,
    })).resolves.toBe('blocked');
    expect(toggle).not.toHaveBeenCalled();
    await expect(routeCoordinatorConversationToggle({
      coordinatorActive: true,
      conversationActive: true,
      toggleConversationMode: toggle,
    })).resolves.toBe('stopped');
    expect(toggle).toHaveBeenCalledTimes(1);
    await stopConversationBeforeCoordinatorOpen({
      conversationActive: true,
      toggleConversationMode: toggle,
    });
    expect(toggle).toHaveBeenCalledTimes(2);

    const onToggleRecording = jest.fn();
    const screen = render(createElement(
      PaperProvider,
      undefined,
      createElement(ChatComposer, {
        attachments: [],
        connectionStatus: 'connected',
        conversation: { active: false, isListening: false, phase: 'off' },
        commands: [],
        coordinatorActive: true,
        currentSessionId: 'sdk-session-a',
        draft: '',
        insetsBottom: 0,
        isCreatingSession: false,
        isSpeechInputAvailable: true,
        isSpeechInputListening: false,
        isStoppingSession: false,
        onAttach: jest.fn(),
        onCommandSelect: jest.fn(),
        onDraftChange: jest.fn(),
        onRemoveAttachment: jest.fn(),
        onSend: jest.fn(),
        onToggleRecording,
        palette: Colors.light,
        showSendAction: true,
      }),
    ));
    fireEvent.press(screen.getByTestId('chat-secondary-button'));
    expect(onToggleRecording).toHaveBeenCalledTimes(1);
  });

  test('late coordinator acknowledgements cannot clear a newer draft or another chat', () => {
    const shared = {
      accepted: true,
      currentDraft: 'submitted text',
      latestSessionId: 'sdk-session-a',
      latestSessionGeneration: 4,
      submittedDraft: 'submitted text',
      submittedSessionGeneration: 4,
      submittedSessionId: 'sdk-session-a',
    };
    expect(shouldApplyCoordinatorAcknowledgement(shared)).toBe(true);
    expect(shouldApplyCoordinatorAcknowledgement({
      ...shared,
      currentDraft: 'new text typed while waiting',
    })).toBe(false);
    expect(shouldApplyCoordinatorAcknowledgement({
      ...shared,
      latestSessionId: 'sdk-session-b',
      latestSessionGeneration: 5,
    })).toBe(false);
    const drafts = createSessionDraftStore();
    drafts.updateDraft('sdk-session-a', 'submitted text');
    const submittedRevision = drafts.getRevision('sdk-session-a');
    drafts.updateDraft('sdk-session-a', 'intervening edit');
    drafts.updateDraft('sdk-session-a', 'submitted text');
    expect(shouldApplyCoordinatorAcknowledgement({
      ...shared,
      currentDraftRevision: drafts.getRevision('sdk-session-a'),
      submittedDraftRevision: submittedRevision,
    })).toBe(false);
    expect(drafts.get('sdk-session-a').draft).toBe('submitted text');

    expect(shouldApplyCoordinatorAcknowledgement({
      accepted: true,
      currentDraft: 'server-root draft',
      currentDraftRevision: 3,
      latestDraftScope: 'server-primary:root-a',
      latestDraftGeneration: 2,
      latestSessionId: undefined,
      latestSessionGeneration: 0,
      submittedDraft: 'server-root draft',
      submittedDraftRevision: 3,
      submittedDraftScope: 'server-primary:root-a',
      submittedDraftGeneration: 2,
      submittedSessionGeneration: 0,
      submittedSessionId: undefined,
    })).toBe(true);
    expect(shouldApplyCoordinatorAcknowledgement({
      accepted: true,
      currentDraft: 'server-root draft',
      currentDraftRevision: 3,
      latestDraftScope: 'server-primary:other-root',
      latestDraftGeneration: 3,
      latestSessionId: undefined,
      latestSessionGeneration: 0,
      submittedDraft: 'server-root draft',
      submittedDraftRevision: 3,
      submittedDraftScope: 'server-primary:root-a',
      submittedDraftGeneration: 2,
      submittedSessionGeneration: 0,
      submittedSessionId: undefined,
    })).toBe(false);
  });

  test('the real ChatView coordinator handler preserves an A-to-B-to-A replacement draft', async () => {
    const drafts = createSessionDraftStore();
    drafts.updateDraft(binding.uiSessionId, 'submitted text');
    const acknowledgement = deferred<{ accepted: boolean }>();
    const setDraftRevision = jest.fn();
    const handler = actualCoordinatorSendHandler()({
      attachmentsRef: { current: [] },
      commands: [],
      connection: { status: 'connected' },
      coordinatorDraftScope,
      coordinator: { state: { enabled: true }, send: async () => acknowledgement.promise },
      currentSessionId: binding.uiSessionId,
      currentSessionIdRef: { current: binding.uiSessionId },
      draftRef: { current: 'submitted text' },
      draftSessionId: binding.uiSessionId,
      draftStoreRef: { current: drafts },
      ensureActiveSession: async () => binding.uiSessionId,
      executeCommand: async () => undefined,
      lastSentAttachmentsRef: { current: [] },
      routeCoordinatorComposerInput,
      sessionGenerationRef: { current: 1 },
      restoreSendAttempt: () => undefined,
      sendPrompt: async () => true,
      setDraftRevision,
      setSendFeedback: jest.fn(),
      shouldApplyCoordinatorAcknowledgement,
      useCallback: <T,>(callback: T) => callback,
    });
    const sending = handler();
    await flush();
    drafts.updateDraft(binding.uiSessionId, 'intervening edit');
    drafts.updateDraft(binding.uiSessionId, 'submitted text');
    acknowledgement.resolve({ accepted: true });
    await sending;
    expect(drafts.get(binding.uiSessionId).draft).toBe('submitted text');
    expect(setDraftRevision).not.toHaveBeenCalled();
  });

  test('the real ChatView coordinator handler clears only the server-primary draft over an ordinary selection', async () => {
    const ordinarySessionId = 'ordinary-sdk-chat';
    const serverPrimaryScope = 'server-primary:local-root-a';
    const drafts = createSessionDraftStore();
    drafts.updateDraft(ordinarySessionId, 'ordinary chat draft stays here');
    drafts.updateDraft(serverPrimaryScope, 'coordinator message');
    const handler = actualCoordinatorSendHandler()({
      attachmentsRef: { current: [] },
      commands: [],
      connection: { status: 'connected' },
      coordinatorDraftScope,
      coordinator: {
        binding: { source: 'server_primary', uiSessionId: serverPrimaryScope },
        state: { enabled: true },
        send: async () => ({ accepted: true }),
      },
      currentSessionId: ordinarySessionId,
      currentSessionIdRef: { current: ordinarySessionId },
      draftRef: { current: 'coordinator message' },
      draftSessionId: serverPrimaryScope,
      draftStoreRef: { current: drafts },
      ensureActiveSession: async () => ordinarySessionId,
      executeCommand: async () => undefined,
      lastSentAttachmentsRef: { current: [] },
      routeCoordinatorComposerInput,
      sessionGenerationRef: { current: 1 },
      restoreSendAttempt: () => undefined,
      sendPrompt: async () => true,
      setDraftRevision: jest.fn(),
      setSendFeedback: jest.fn(),
      shouldApplyCoordinatorAcknowledgement,
      useCallback: <T,>(callback: T) => callback,
    });
    await handler();
    expect(drafts.get(serverPrimaryScope).draft).toBe('');
    expect(drafts.get(ordinarySessionId).draft).toBe('ordinary chat draft stays here');
  });

  test('keeps exact same-command retry visible after a refresh without exposing dense context', () => {
    const screen = render(createElement(
      PaperProvider,
      undefined,
      createElement(CoordinatorConversationCard, {
        state: {
          enabled: true,
          phase: 'ready',
          conversation: conversation(),
          pendingCommand: { commandKey: 'uncertain-key', expectedControlRevision: 1, message: 'same immutable command' },
          pendingProvenance: 'uncertain',
          context: context(),
        },
        palette: Colors.light,
        onRefresh: jest.fn(),
        onRetry: jest.fn(),
        onReviewConflict: jest.fn(),
        onBeginNewMessageAfterReview: jest.fn(),
        onReturnToNormal: jest.fn(),
        onInspectWorkstream: jest.fn(),
      }),
    ));
    expect(screen.getByTestId('coordinator-retry')).toBeTruthy();
    expect(screen.queryByText(/Tasks: available/i)).toBeNull();
  });

  test('exposes finite managed-work controls only for the current server-owned schema v3 root', () => {
    const actions = {
      inspect: jest.fn(),
      prepare: jest.fn(),
      continue: jest.fn(),
    };
    const props = {
      palette: Colors.light,
      onRefresh: jest.fn(),
      onRetry: jest.fn(),
      onReviewConflict: jest.fn(),
      onBeginNewMessageAfterReview: jest.fn(),
      onReturnToNormal: jest.fn(),
      onInspectWorkstream: actions.inspect,
      onPreparePlan: actions.prepare,
      onContinuePlan: actions.continue,
    };
    const current = render(createElement(
      PaperProvider,
      undefined,
      createElement(CoordinatorConversationCard, {
        ...props,
        state: { enabled: true, phase: 'ready', conversation: c2Conversation() },
      }),
    ));
    expect(current.getByText('Plan this goal')).toBeTruthy();
    expect(current.getByText('Continue managed work')).toBeTruthy();
    fireEvent.press(current.getByText('Plan this goal'));
    expect(current.getByLabelText('Managed work consent')).toBeTruthy();

    const retained = render(createElement(
      PaperProvider,
      undefined,
      createElement(CoordinatorConversationCard, {
        ...props,
        state: {
          enabled: true,
          phase: 'ready',
          conversation: { ...c2Conversation(), schemaVersion: 2 },
        },
      }),
    ));
    expect(retained.queryByText('Plan this goal')).toBeNull();
    expect(retained.queryByText('Continue managed work')).toBeNull();
  });

  test('renders execution, verification, source availability, and unknown/overshoot holds distinctly', () => {
    const state: MobileCoordinatorViewState = {
      enabled: true,
      phase: 'ready',
      conversation: conversation(),
      plannedWorkstream: plannedWorkstream(),
      context: {
        ...context(),
        availability: {
          ...context().availability,
          schedules: { state: 'not_configured' },
          manualActivity: { state: 'unavailable' },
        },
        waitingForReply: [{ id: 'task-1', title: 'Reply to team', status: 'waiting_for_reply' }],
        scheduledPriorities: [{ id: 'schedule-1', name: 'Morning review', enabled: true }],
        executionSucceededGoalUnverified: [{ id: 'receipt-1', workstreamId: 'work-1', jobId: 'job-1' }],
        verifiedYesterday: [{ id: 'receipt-2', workstreamId: 'work-2', jobId: 'job-2' }],
        usageHolds: [
          { id: 'hold-1', workstreamId: 'work-3', jobId: 'job-3', actualUsage: { state: 'unknown' } },
          { id: 'hold-2', workstreamId: 'work-4', jobId: 'job-4', actualUsage: { state: 'overshoot' } },
        ],
      },
    };
    const screen = render(createElement(
      PaperProvider,
      undefined,
      createElement(CoordinatorConversationCard, {
        state,
        palette: Colors.light,
        onRefresh: jest.fn(),
        onRetry: jest.fn(),
        onReviewConflict: jest.fn(),
        onBeginNewMessageAfterReview: jest.fn(),
        onReturnToNormal: jest.fn(),
        onInspectWorkstream: jest.fn(),
      }),
    ));
    // Dense context stays collapsed until the user asks for it, while real
    // holds remain visible and opaque workstream IDs never leak into the card.
    expect(screen.queryByText(/Waiting for reply: Reply to team/i)).toBeNull();
    expect(screen.getByText(/Unknown usage — hold needs review/i)).toBeTruthy();
    expect(screen.getByText(/Usage overshoot — hold needs review/i)).toBeTruthy();
    expect(screen.queryByText(/work-3|work-4/i)).toBeNull();
    fireEvent.press(screen.getByTestId('coordinator-context-toggle'));
    expect(screen.getByText(/Waiting for reply: Reply to team/i)).toBeTruthy();
    expect(screen.getByText(/Scheduled priorities: Morning review/i)).toBeTruthy();
    expect(screen.getByText(/Execution succeeded — verification pending for 1 workstream/i)).toBeTruthy();
    expect(screen.getByText(/Verified yesterday .*1 verified receipt/i)).toBeTruthy();
    expect(screen.getByText(/Schedules: not configured/i)).toBeTruthy();
    expect(screen.getByText(/Dayflow activity: unavailable/i)).toBeTruthy();
    expect(screen.getByText('Latest managed-work response')).toBeTruthy();
    expect(screen.getByText(/Server job status: queued/i)).toBeTruthy();
    expect(screen.getByText(/120 actual of 20,000 authorized tokens/i)).toBeTruthy();
    expect(screen.getByText(/paired Mac setup.*does not change/i)).toBeTruthy();
    expect(screen.queryByText(/workstream-a/i)).toBeNull();
  });
});

// Known conversation schema 4 (installed f77): same top-level DTO as 3; the only addition is server command metadata.
describe('known coordinator conversation schema 4 compatibility', () => {
  const delegation = {
    key: 'synthetic-command', intentHash: 'a'.repeat(64), kind: 'delegate_goal', goalId: 'goal-a',
    parentSdkSessionId: 'synthetic-sdk', targetAgentConfigId: 'workflow-orchestrator', state: 'dispatched',
    delegationId: 'synthetic-delegation', childSessionId: 'synthetic-child',
  };
  const v4 = (revision = 1, overrides: Record<string, unknown> = {}): MobileCoordinatorConversation => ({
    ...c2Conversation(revision),
    schemaVersion: 4,
    commandDedupe: [delegation],
    createdAt: '2026-10-06T04:00:00.000Z',
    updatedAt: '2026-10-06T04:00:00.000Z',
    ...overrides,
  } as never);
  const completeContext = () => ({
    ...context(),
    availability: { ...context().availability, rhythms: { state: 'available' as const } },
    coverage: {}, activeRhythms: [], manualActivity: [], manualActivityDependency: null, modelContext: {},
  });
  const v4Status = (value: MobileCoordinatorConversation) => ({ kind: 'status', conversation: value, context: completeContext() });
  const rootIds = { sessionId: binding.sessionId, projectId: binding.projectId };

  test('decodes every dedicated envelope and keeps schemas 1-3 readable', () => {
    expect(parseMobileCoordinatorResult({ kind: 'replay', conversation: v4() }, binding, 200)).toMatchObject({ kind: 'replay' });
    expect(parseMobileCoordinatorResult({ kind: 'created', conversation: v4() }, binding, 201)).toMatchObject({ kind: 'created' });
    expect(parseMobileCoordinatorResult({ kind: 'foreground_accepted', conversation: v4() }, binding, 200)).toMatchObject({ kind: 'foreground_accepted' });
    expect(parseMobileCoordinatorResult(v4Status(v4()), binding, 200)).toMatchObject({ kind: 'status' });
    expect(parseMobileCoordinatorResolveResult({ kind: 'resolved', created: false, ...rootIds, conversation: v4() }, 200)).toMatchObject({ kind: 'resolved' });
    expect(parseMobileCoordinatorSetupResult({
      kind: 'setup_replay', ...rootIds, profileId: 'profile-a', workspaceGeneration: 1, conversation: v4(),
    }, 200)).toMatchObject({ kind: 'setup_replay' });
    expect(parseMobileCoordinatorHistoryResult({
      kind: 'history', conversation: v4(), messages: [], nextCursor: null, hasMore: false,
    }, binding, 200)).toMatchObject({ kind: 'history' });
    expect(parseMobileCoordinatorPlanResult({
      kind: 'planned', conversation: v4(), workstream: plannedWorkstream(),
    }, binding, 200)).toMatchObject({ kind: 'planned' });
    // Legacy and current v3 behavior is unchanged.
    expect(parseMobileCoordinatorResult({ kind: 'replay', conversation: conversation() }, binding, 200)).toMatchObject({ kind: 'replay' });
    expect(parseMobileCoordinatorResolveResult({ kind: 'resolved', created: false, ...rootIds, conversation: c2Conversation() }, 200)).toMatchObject({ kind: 'resolved' });
  });

  test('holds unknown versions, malformed required fields, foreign identity and non-primary dedicated roots', () => {
    const mutations: Record<string, unknown>[] = [
      { schemaVersion: 5 }, { schemaVersion: 99 }, { schemaVersion: '4' }, { schemaVersion: 4.5 },
      { ownerUserId: '7' }, { ownerUserId: 0 }, { ownerUserId: undefined },
      { primaryOwnerRoot: 'true' }, { primaryOwnerRoot: undefined },
      { controlRevision: 0 }, { sessionId: 'foreign-root' }, { projectId: 'foreign-project' },
      { goals: {} }, { commandDedupe: {} }, { commandDedupe: undefined }, { continuations: {} }, { continuations: undefined },
      { createdAt: false }, { createdAt: '' }, { createdAt: 'not a date' }, { updatedAt: undefined },
      // Date.parse-valid but noncanonical: the backend requires new Date(v).toISOString() === v.
      { createdAt: '1' }, { createdAt: 'January 1, 2026' }, { updatedAt: '1' }, { updatedAt: 'January 1, 2026' },
      { createdAt: '2026-10-06T04:00:00Z' }, { updatedAt: '2026-10-06' },
      { commandDedupe: Array.from({ length: 101 }, () => delegation) },
      { goals: [{ ...c2Conversation().goals[0], objective: 'x'.repeat(4001) }] },
    ];
    for (const mutation of mutations) {
      expect(parseMobileCoordinatorResult({ kind: 'replay', conversation: v4(1, mutation) }, binding, 200)).toBeUndefined();
    }
    expect(parseMobileCoordinatorResolveResult({
      kind: 'resolved', created: false, ...rootIds, conversation: v4(1, { primaryOwnerRoot: false }),
    }, 200)).toBeUndefined();
    expect(parseMobileCoordinatorSetupResult({
      kind: 'setup_created', ...rootIds, profileId: 'profile-a', workspaceGeneration: 1, conversation: v4(1, { primaryOwnerRoot: false }),
    }, 201)).toBeUndefined();
    expect(parseMobileCoordinatorResolveResult({
      kind: 'resolved', created: false, ...rootIds, conversation: v4(1, { schemaVersion: 5 }),
    }, 200)).toBeUndefined();
    expect(parseMobileCoordinatorResolveResult({
      kind: 'resolved', created: false, ...rootIds, conversation: conversation(),
    }, 200)).toBeUndefined();
    const { coverage: _coverage, ...incomplete } = completeContext();
    expect(parseMobileCoordinatorResult({ kind: 'status', conversation: v4(), context: incomplete }, binding, 200)).toBeUndefined();
    expect(parseMobileCoordinatorResult({ kind: 'status', conversation: v4(), context: { ...completeContext(), modelContext: null } }, binding, 200)).toBeUndefined();
    expect(isDedicatedCoordinatorSchema(4)).toBe(true);
    expect(isDedicatedCoordinatorSchema(3)).toBe(true);
    for (const version of [1, 2, 5, '3', '4', undefined]) expect(isDedicatedCoordinatorSchema(version)).toBe(false);
  });

  function pairedV4Client(log: { path: string; body: Record<string, unknown> }[], conversationValue = v4()) {
    return {
      fetchResponse: async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        log.push({ path, body });
        const respond = (status: number, json: unknown) => ({ status, json: async () => json } as Response);
        if (path.endsWith('/open')) return respond(200, { kind: 'replay', conversation: conversationValue });
        if (path.endsWith('/status')) return respond(200, v4Status(conversationValue));
        if (path.endsWith('/history')) return respond(200, { kind: 'history', conversation: conversationValue, messages: [], nextCursor: null, hasMore: false });
        if (path.endsWith('/message')) return respond(200, { kind: 'foreground_accepted', conversation: v4(2) });
        return respond(503, { kind: 'schema_unavailable' });
      },
    };
  }

  test('the real decoder feeds the real controller through open, status, history and a foreground acknowledgement', async () => {
    const log: { path: string; body: Record<string, unknown> }[] = [];
    const transport = createPairedCoordinatorConversationGateway(pairedV4Client(log) as never);
    const controller = new MobileCoordinatorConversationController(() => transport, createMemoryMobileCoordinatorJournal());
    expect(await controller.open(binding)).toBe(true);
    await flush();
    const state = controller.get(binding);
    expect(state.phase).toBe('ready');
    expect(state.conversation?.schemaVersion).toBe(4);
    expect(state.canonicalHistory?.messages).toEqual([]);
    expect((await controller.send(binding, 'Ask Rhythm what to do today')).accepted).toBe(true);
    await flush();
    const message = log.find((entry) => entry.path.endsWith('/message'));
    expect(Object.keys(message?.body ?? {}).sort()).toEqual(['commandKey', 'expectedControlRevision', 'message', 'projectId', 'sessionId']);
    expect(message?.body.expectedControlRevision).toBe(1);
    expect(controller.get(binding).pendingCommand).toBeUndefined();
    expect(controller.get(binding).conversation?.controlRevision).toBe(2);
  });

  test('a malformed or unknown-version v4 response holds the view and never reaches the message wire', async () => {
    for (const overrides of [{ schemaVersion: '4' }, { schemaVersion: 5 }, { ownerUserId: undefined }, { commandDedupe: {} }, { sessionId: 'foreign-root' }]) {
      const log: { path: string; body: Record<string, unknown> }[] = [];
      const transport = createPairedCoordinatorConversationGateway(pairedV4Client(log, v4(1, overrides)) as never);
      const controller = new MobileCoordinatorConversationController(() => transport, createMemoryMobileCoordinatorJournal());
      expect(await controller.open(binding)).toBe(false);
      await flush();
      expect(controller.get(binding).conversation).toBeUndefined();
      expect((await controller.send(binding, 'must not send')).accepted).toBe(false);
      expect(log.some((entry) => entry.path.endsWith('/message'))).toBe(false);
    }
  });

  test('a stale v4 response after the root changes does not retarget the new view or send anything', async () => {
    const log: { path: string; body: Record<string, unknown> }[] = [];
    const release = deferred<void>();
    const base = pairedV4Client(log);
    const client = {
      fetchResponse: async (path: string, init: RequestInit) => {
        if (path.endsWith('/open')) await release.promise;
        return base.fetchResponse(path, init);
      },
    };
    const transport = createPairedCoordinatorConversationGateway(client as never);
    const controller = new MobileCoordinatorConversationController(() => transport, createMemoryMobileCoordinatorJournal());
    const opening = controller.open(binding);
    await flush();
    const other = { ...binding, sessionId: 'local-root-b', uiSessionId: 'sdk-session-b' };
    controller.activate(other);
    release.resolve();
    await opening;
    await flush();
    expect(controller.get(binding).conversation).toBeUndefined();
    expect(controller.get(other).conversation).toBeUndefined();
    expect(log.some((entry) => entry.path.endsWith('/message'))).toBe(false);
  });

  test('finite planning on v4 stays behind exact consent and the primary gate', async () => {
    const consent = {
      totalTokenAuthorization: 20000, maxTurns: 2 as const, maxWallTimeSeconds: 90, expiresInSeconds: 900,
      acknowledgesSoftTotalTokenAuthorization: true as const, purpose: 'decompose' as const,
    };
    const attempts: unknown[] = [];
    const controller = new MobileCoordinatorConversationController(() => gateway({
      open: async () => ({ kind: 'replay', conversation: v4() }),
      status: async () => v4Status(v4()) as MobileCoordinatorResult,
      preparePlan: async (input) => {
        attempts.push(input);
        return { kind: 'planned', conversation: v4(2), workstream: plannedWorkstream() } as never;
      },
    }), createMemoryMobileCoordinatorJournal());
    await controller.open(binding);
    await flush();
    expect(await controller.preparePlan(binding, 'goal-a', { ...consent, acknowledgesSoftTotalTokenAuthorization: false as never })).toBe(false);
    expect(attempts).toHaveLength(0);
    expect(await controller.preparePlan(binding, 'goal-a', consent)).toBe(true);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).not.toHaveProperty('schemaVersion');
    const nonPrimary = new MobileCoordinatorConversationController(() => gateway({
      open: async () => ({ kind: 'replay', conversation: v4(1, { primaryOwnerRoot: false }) }),
      status: async () => v4Status(v4(1, { primaryOwnerRoot: false })) as MobileCoordinatorResult,
      preparePlan: async () => { throw new Error('must not reach prepare wire'); },
    }), createMemoryMobileCoordinatorJournal());
    await nonPrimary.open(binding);
    await flush();
    expect(await nonPrimary.preparePlan(binding, 'goal-a', consent)).toBe(false);
  });
});
