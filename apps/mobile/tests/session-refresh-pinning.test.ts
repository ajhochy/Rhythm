import {
  canCommitBootstrappedSession,
  preserveReadySessionDuringRefresh,
  reconcileSessionSelectionAfterRefresh,
} from '@/providers/opencode-provider-selectors';

describe('mobile session refresh pinning', () => {
  test('issue-1285-c15: scoped refresh cannot displace the ready owner-opened session', () => {
    // Regression reproduced on the physical iPhone: the exact-owner opener
    // selects a projectless desktop session, then the scoped project refresh
    // omits it and the fallback effect restores the remembered project chat.
    // The transcript consequently falls back to Opening chat.
    const projectId = 'project-a';
    const ownerOpened = { id: 'ses-projectless', title: 'Desktop chat' };
    const rememberedProjectChat = {
      id: 'ses-remembered',
      title: 'Remembered project chat',
    };
    const refreshed = [rememberedProjectChat];
    const bootstrapToken = {};

    expect(
      canCommitBootstrappedSession({
        activeBootstrapToken: bootstrapToken,
        bootstrapToken,
        currentSessionId: ownerOpened.id,
      }),
    ).toBe(false);

    expect(
      canCommitBootstrappedSession({
        activeBootstrapToken: bootstrapToken,
        bootstrapToken,
        currentSessionId: undefined,
      }),
    ).toBe(true);

    expect(
      preserveReadySessionDuringRefresh({
        activeProjectId: projectId,
        currentSessionId: ownerOpened.id,
        currentSessions: [ownerOpened],
        openState: {
          generation: 3,
          kind: 'ready',
          projectId,
          sessionId: ownerOpened.id,
        },
        refreshedSessions: refreshed,
      }),
    ).toEqual([ownerOpened, rememberedProjectChat]);

    expect(
      reconcileSessionSelectionAfterRefresh({
        activeProjectId: projectId,
        currentSessionId: ownerOpened.id,
        lastSessionByProject: {
          [projectId]: rememberedProjectChat.id,
        },
        openState: {
          generation: 3,
          kind: 'ready',
          projectId,
          sessionId: ownerOpened.id,
        },
        sessions: refreshed,
      }),
    ).toBe(ownerOpened.id);

    expect(
      reconcileSessionSelectionAfterRefresh({
        activeProjectId: projectId,
        currentSessionId: rememberedProjectChat.id,
        lastSessionByProject: {
          [projectId]: rememberedProjectChat.id,
        },
        openState: {
          generation: 3,
          kind: 'ready',
          projectId,
          sessionId: ownerOpened.id,
        },
        sessions: [ownerOpened, rememberedProjectChat],
      }),
    ).toBe(ownerOpened.id);

    expect(
      preserveReadySessionDuringRefresh({
        activeProjectId: projectId,
        currentSessionId: ownerOpened.id,
        currentSessions: [ownerOpened],
        openState: { kind: 'idle' },
        refreshedSessions: refreshed,
      }),
    ).toEqual(refreshed);

    expect(
      reconcileSessionSelectionAfterRefresh({
        activeProjectId: projectId,
        currentSessionId: ownerOpened.id,
        lastSessionByProject: {
          [projectId]: rememberedProjectChat.id,
        },
        openState: { kind: 'idle' },
        sessions: refreshed,
      }),
    ).toBe(rememberedProjectChat.id);
  });

  test('pins the ready controller target while React currentSessionId still points elsewhere', () => {
    const projectId = 'project-a';
    const readySession = { id: 'ses-ready', title: 'Ready chat' };
    const staleSession = { id: 'ses-stale', title: 'Previous chat' };
    const openState = {
      generation: 4,
      kind: 'ready' as const,
      projectId,
      sessionId: readySession.id,
    };

    expect(
      preserveReadySessionDuringRefresh({
        activeProjectId: projectId,
        currentSessionId: staleSession.id,
        currentSessions: [staleSession, readySession],
        openState,
        refreshedSessions: [staleSession],
      }),
    ).toEqual([readySession, staleSession]);

    expect(
      reconcileSessionSelectionAfterRefresh({
        activeProjectId: projectId,
        currentSessionId: staleSession.id,
        lastSessionByProject: { [projectId]: staleSession.id },
        openState,
        sessions: [staleSession],
      }),
    ).toBe(readySession.id);
  });
});
