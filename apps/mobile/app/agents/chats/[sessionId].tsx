import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';

import { ChatView } from '@/components/chat/chat-view';
import { ToolScreenState } from '@/components/tools/tool-screen-state';
import {
  getOpenProjectSessionPresentation,
  type OpenProjectSessionTerminalKind,
} from '@/providers/open-project-session';
import { useOpencode } from '@/providers/opencode-provider';
import { usePairedHost } from '@/providers/paired-host-provider';

const TERMINAL_STATES = new Set<OpenProjectSessionTerminalKind>([
  'missing-session',
  'unauthorized-project',
  'offline',
  'timeout',
  'transient-error',
]);

export default function AgentChatDetailScreen() {
  const params = useLocalSearchParams<{
    sessionId: string;
    projectId?: string;
  }>();
  const router = useRouter();
  const opencode = useOpencode();
  const pairedHost = usePairedHost();
  const {
    host: pairedHostRecord,
    message: pairedHostMessage,
    state: pairedHostState,
  } = pairedHost;
  const {
    activeProjectPath,
    cancelOpenProjectSession,
    connection,
    currentSessionId,
    isHydrated,
    openProjectSession,
    openProjectSessionState: openState,
  } = opencode;
  const pairedHostAvailable =
    !pairedHostRecord || pairedHostState === 'connected';
  const sessionId = Array.isArray(params.sessionId)
    ? params.sessionId[0]
    : params.sessionId;
  const projectId = Array.isArray(params.projectId)
    ? params.projectId[0]
    : params.projectId;
  const targetProjectId = projectId ?? activeProjectPath ?? '';
  const targetSessionId = sessionId ?? '';
  const stateMatchesTarget =
    'projectId' in openState &&
    openState.projectId === targetProjectId &&
    openState.sessionId === targetSessionId;

  const routeHeader = <Stack.Screen options={{ headerShown: false }} />;

  useEffect(() => {
    if (!isHydrated) return;
    if (connection.status === 'connecting') return;
    if (
      connection.status === 'idle' &&
      (Platform.OS === 'web' ||
        Boolean(pairedHostRecord && pairedHostAvailable))
    ) {
      return;
    }
    if (stateMatchesTarget) {
      if (openState.kind === 'opening') return;
      if (TERMINAL_STATES.has(openState.kind as OpenProjectSessionTerminalKind)) {
        return;
      }
      if (
        openState.kind === 'ready' &&
        activeProjectPath === targetProjectId &&
        currentSessionId === targetSessionId
      ) {
        return;
      }
      if (openState.kind === 'ready') {
        cancelOpenProjectSession();
      }
    }
    void openProjectSession(targetProjectId, targetSessionId);
  }, [
    activeProjectPath,
    cancelOpenProjectSession,
    connection.status,
    currentSessionId,
    isHydrated,
    openState.kind,
    openProjectSession,
    pairedHostAvailable,
    pairedHostRecord,
    stateMatchesTarget,
    targetProjectId,
    targetSessionId,
  ]);

  useEffect(
    () => () => {
      cancelOpenProjectSession();
    },
    [cancelOpenProjectSession],
  );

  if (
    stateMatchesTarget &&
    TERMINAL_STATES.has(openState.kind as OpenProjectSessionTerminalKind)
  ) {
    const kind = openState.kind as OpenProjectSessionTerminalKind;
    const presentation = getOpenProjectSessionPresentation(kind);
    const message =
      'message' in openState && openState.message
        ? openState.message
        : presentation.message;
    return (
      <>
        {routeHeader}
        <ToolScreenState
          message={message}
          state={presentation.screenState}
          title={presentation.title}>
          <View style={styles.actions}>
            <Button
              accessibilityLabel={presentation.retryLabel}
              mode="contained"
              onPress={() => {
                void openProjectSession(targetProjectId, targetSessionId);
              }}>
              {presentation.retryLabel}
            </Button>
            <Button
              accessibilityLabel={presentation.backLabel}
              mode="outlined"
              onPress={() => {
                cancelOpenProjectSession();
                router.replace('/(tabs)/agents');
              }}>
              {presentation.backLabel}
            </Button>
          </View>
        </ToolScreenState>
      </>
    );
  }

  const isReady =
    stateMatchesTarget &&
    openState.kind === 'ready' &&
    activeProjectPath === targetProjectId &&
    currentSessionId === targetSessionId;
  if (!isReady) {
    return (
      <>
        {routeHeader}
        <ToolScreenState
          message={
            pairedHostAvailable
              ? 'Loading the transcript and agent state.'
              : pairedHostMessage
          }
          state="loading"
          title="Opening chat">
          <Button
            accessibilityLabel="Back to chats"
            mode="outlined"
            onPress={() => {
              cancelOpenProjectSession();
              router.replace('/(tabs)/agents');
            }}>
            Back to chats
          </Button>
        </ToolScreenState>
      </>
    );
  }

  return (
    <>
      {routeHeader}
      <ChatView />
    </>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 8,
  },
});
