import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAgentChat } from '@/providers/agent-chat-provider';
import { useOpencode } from '@/providers/opencode-provider';
import type {
  AgentOption,
  ChatPreferences,
} from '@/providers/opencode-provider-types';
import type { AgentChatLifecycle } from '@/providers/services/agent-chat-service';

export function useChatListController() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const chat = useAgentChat();
  const opencode = useOpencode();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] =
    useState<AgentChatLifecycle | 'all'>('all');
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [creationProfiles, setCreationProfiles] = useState<AgentOption[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setCreateSheetVisible(false);
    }
  }, [isFocused]);

  function targetProjectForNewChat() {
    return (
      projectId ??
      opencode.activeProjectPath ??
      opencode.projects[0]?.path
    );
  }

  async function openCreateSheet() {
    const targetProject = targetProjectForNewChat();
    if (!targetProject) {
      setFeedback('Choose a project before creating a chat.');
      return;
    }
    try {
      const profiles =
        targetProject === opencode.activeProjectPath &&
        opencode.availableAgents.length > 0
          ? opencode.availableAgents
          : await opencode.loadSessionProfiles(targetProject);
      setCreationProfiles(profiles);
      setCreateSheetVisible(true);
    } catch (reason) {
      setFeedback(
        reason instanceof Error
          ? reason.message
          : 'Could not load profiles for this project.',
      );
    }
  }

  async function createChat(
    title: string | undefined,
    preferences: ChatPreferences,
  ) {
    const targetProject = targetProjectForNewChat();
    if (!targetProject) {
      throw new Error('Choose a project before creating a chat.');
    }
    setIsCreating(true);
    try {
      return await chat.createChat(targetProject, title, preferences);
    } finally {
      setIsCreating(false);
    }
  }

  return {
    clearFeedback: () => setFeedback(null),
    closeCreateSheet: () => setCreateSheetVisible(false),
    createChat,
    creationProfiles,
    createSheetVisible,
    feedback,
    isCreating,
    isFocused,
    isOnline: chat.isOnline,
    lifecycle,
    openCreateSheet,
    openTerminal: () => router.push('/agents/terminal'),
    openWorkspace: () => router.push('/agents/workspace'),
    projectId,
    projects: opencode.projects,
    setLifecycle,
    setProjectId,
  };
}

export type ChatListController = ReturnType<typeof useChatListController>;
