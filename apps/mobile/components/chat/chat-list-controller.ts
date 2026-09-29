import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

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
  const [creationTargetProject, setCreationTargetProject] = useState<string>();
  const [creationProfiles, setCreationProfiles] = useState<AgentOption[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const createSheetRequest = useRef(0);

  useEffect(() => {
    if (!isFocused) {
      createSheetRequest.current += 1;
      setCreateSheetVisible(false);
      setCreationTargetProject(undefined);
    }
  }, [isFocused]);

  function targetProjectForNewChat() {
    return (
      projectId ??
      opencode.activeProjectPath ??
      opencode.projects[0]?.path
    );
  }

  function openCreateSheet(targetProjectPath?: string) {
    const request = ++createSheetRequest.current;
    const targetProject = targetProjectPath ?? targetProjectForNewChat();
    if (!targetProject) {
      setFeedback('Choose a project before creating a chat.');
      return;
    }
    // ponytail: sheet opens instantly (A3); profiles resolve in the background
    // instead of gating visibility on the network round-trip.
    setCreationTargetProject(targetProject);
    setCreateSheetVisible(true);
    if (
      targetProject === opencode.activeProjectPath &&
      opencode.availableAgents.length > 0
    ) {
      setCreationProfiles(opencode.availableAgents);
      return;
    }
    setCreationProfiles([]);
    void opencode.loadSessionProfiles(targetProject).then(
      (profiles) => {
        if (request !== createSheetRequest.current) return;
        setCreationProfiles(profiles);
      },
      (reason) => {
        if (request !== createSheetRequest.current) return;
        setCreateSheetVisible(false);
        setCreationTargetProject(undefined);
        setFeedback(
          reason instanceof Error
            ? reason.message
            : 'Could not load profiles for this project.',
        );
      },
    );
  }

  async function createChat(
    title: string | undefined,
    preferences: ChatPreferences,
  ) {
    const targetProject = creationTargetProject ?? targetProjectForNewChat();
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
    closeCreateSheet: () => {
      createSheetRequest.current += 1;
      setCreateSheetVisible(false);
      setCreationTargetProject(undefined);
    },
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
