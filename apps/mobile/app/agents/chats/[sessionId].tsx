import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { ChatView } from '@/components/chat/chat-view';
import { ToolScreenState } from '@/components/tools/tool-screen-state';
import { useOpencode } from '@/providers/opencode-provider';

export default function AgentChatDetailScreen() {
  const params = useLocalSearchParams<{
    sessionId: string;
    projectId?: string;
  }>();
  const opencode = useOpencode();
  const [error, setError] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const sessionId = Array.isArray(params.sessionId)
    ? params.sessionId[0]
    : params.sessionId;
  const projectId = Array.isArray(params.projectId)
    ? params.projectId[0]
    : params.projectId;

  useEffect(() => {
    if (!sessionId || opencode.connection.status !== 'connected') return;
    if (projectId && opencode.activeProjectPath !== projectId) {
      opencode.selectProject(projectId);
      return;
    }
    if (
      opencode.currentSessionId === sessionId ||
      openingRef.current === sessionId
    ) {
      return;
    }
    openingRef.current = sessionId;
    setError(null);
    void opencode.openSession(sessionId)
      .catch((reason) => {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not open this chat.',
        );
      })
      .finally(() => {
        openingRef.current = null;
      });
  }, [
    opencode,
    opencode.activeProjectPath,
    opencode.connection.status,
    opencode.currentSessionId,
    projectId,
    sessionId,
  ]);

  if (error) {
    return (
      <ToolScreenState
        actionLabel="Try again"
        message={error}
        onAction={() => {
          openingRef.current = null;
          setError(null);
          if (sessionId) void opencode.openSession(sessionId);
        }}
        state="error"
        title="Could not open chat"
      />
    );
  }

  if (!sessionId || opencode.currentSessionId !== sessionId) {
    return (
      <ToolScreenState
        message={
          opencode.connection.status === 'connected'
            ? 'Loading the transcript and agent state.'
            : 'Reconnect to your paired Mac to open this chat.'
        }
        state={
          opencode.connection.status === 'connected'
            ? 'loading'
            : 'offline-cache'
        }
        title="Opening chat"
      />
    );
  }

  return <ChatView />;
}
