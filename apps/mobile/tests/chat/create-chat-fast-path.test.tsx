import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import React, { useEffect } from 'react';

import {
  AgentChatProvider,
  useAgentChat,
} from '@/providers/agent-chat-provider';
import type { ChatPreferences } from '@/providers/opencode-provider';

const PROJECT_ID = '/projects/target';
const CREATED = {
  id: 'session-created-empty',
  projectId: PROJECT_ID,
  status: 'idle',
  title: 'New chat',
  time: { created: 1, updated: 1 },
};

const mockCreateSession = jest.fn();
const mockListSessionsAcrossProjects = jest.fn();
const mockRefreshCurrentSession = jest.fn(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    activeProjectPath: '/projects/active',
    buildScopedClient: jest.fn(),
    connection: { status: 'connected' },
    createSession: mockCreateSession,
    eventStreamStatus: 'connected',
    projects: [{ path: PROJECT_ID }],
    refreshCurrentSession: mockRefreshCurrentSession,
  }),
}));

jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({ host: null, state: 'connected' }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => ({ user: { id: 1585 } }),
}));

jest.mock('@/providers/services/session-service', () => ({
  archiveSession: jest.fn(),
  deleteSession: jest.fn(),
  forkSession: jest.fn(),
  listSessionsAcrossProjects: (...args: unknown[]) =>
    mockListSessionsAcrossProjects(...args),
  restoreSession: jest.fn(),
  updateSessionTitle: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

let latestChat: ReturnType<typeof useAgentChat> | undefined;

function Probe() {
  const chat = useAgentChat();
  useEffect(() => {
    latestChat = chat;
  }, [chat]);
  return null;
}

describe('PR #1585 new-chat critical path', () => {
  beforeEach(() => {
    latestChat = undefined;
    mockCreateSession.mockReset().mockResolvedValue(CREATED);
    mockListSessionsAcrossProjects.mockReset().mockResolvedValue([]);
    mockRefreshCurrentSession.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  test('NC-1: durable create returns before the catalog sweep and converges to one row', async () => {
    // Regression caught: createChat awaited the full catalog sweep, so the
    // returned record/navigation could not happen while that sweep was slow.
    const sweep = deferred<(typeof CREATED)[]>();
    mockListSessionsAcrossProjects
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => sweep.promise);
    render(
      <AgentChatProvider>
        <Probe />
      </AgentChatProvider>,
    );
    await waitFor(() => expect(latestChat).toBeDefined());

    let created: { id: string } | undefined;
    await act(async () => {
      void latestChat!.createChat(PROJECT_ID, CREATED.title, {
        profileId: 'profile-target',
        mode: 'build',
        providerId: 'openai',
        modelId: 'openai/gpt-5',
        reasoning: 'high',
        permissionMode: 'default',
        autoApprove: false,
        enabledModelIds: ['openai/gpt-5'],
        providerModelSelections: {},
      } as ChatPreferences).then((value) => { created = value; });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(created).toEqual(expect.objectContaining({ id: CREATED.id }));
    await waitFor(() => {
      expect(latestChat!.sessions.filter((row) => row.id === CREATED.id)).toHaveLength(1);
    });

    await act(async () => sweep.resolve([CREATED]));
    await waitFor(() => {
      expect(latestChat!.sessions.filter((row) => row.id === CREATED.id)).toHaveLength(1);
    });
  });

  test('NC-1: a background sweep failure is surfaced without an unhandled rejection', async () => {
    // Regression caught: fire-and-forget reconciliation rejected without the
    // provider error surface observing it.
    const sweep = deferred<(typeof CREATED)[]>();
    mockListSessionsAcrossProjects
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => sweep.promise);
    render(
      <AgentChatProvider>
        <Probe />
      </AgentChatProvider>,
    );
    await waitFor(() => expect(latestChat).toBeDefined());

    await act(async () => {
      await expect(latestChat!.createChat(PROJECT_ID)).resolves.toEqual(
        expect.objectContaining({ id: CREATED.id }),
      );
    });
    await act(async () => sweep.reject(new Error('catalog sweep failed')));

    await waitFor(() => expect(latestChat!.error).toBe('catalog sweep failed'));
  });

  test('NC-1 perf: a 500ms catalog sweep is absent from create latency', async () => {
    // Regression caught: a deterministic 500ms sweep delay used to add the
    // same 500ms to the Create-to-navigation critical path.
    const sweepStarted = deferred<void>();
    mockListSessionsAcrossProjects
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        sweepStarted.resolve();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return [CREATED];
      });
    render(
      <AgentChatProvider>
        <Probe />
      </AgentChatProvider>,
    );
    await waitFor(() => expect(latestChat).toBeDefined());

    const startedAt = performance.now();
    await act(async () => {
      await latestChat!.createChat(PROJECT_ID);
    });
    const elapsedMs = performance.now() - startedAt;
    await sweepStarted.promise;
    console.info(`NC create critical path with 500ms sweep: ${elapsedMs.toFixed(1)}ms`);

    expect(elapsedMs).toBeLessThan(250);
    await waitFor(() => {
      expect(latestChat!.sessions.filter((row) => row.id === CREATED.id)).toHaveLength(1);
    });
  });
});
