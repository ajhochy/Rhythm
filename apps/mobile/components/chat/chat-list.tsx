import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import {
  Appbar,
  Button,
  Card,
  Dialog,
  Divider,
  IconButton,
  Menu,
  Portal,
  Searchbar,
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput,
} from 'react-native-paper';

import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
import { ToolScreenState } from '@/components/tools/tool-screen-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAgentChat } from '@/providers/agent-chat-provider';
import { useOpencode } from '@/providers/opencode-provider';
import { usePairedHost } from '@/providers/paired-host-provider';
import type { AgentOption } from '@/providers/opencode-provider-types';
import {
  buildAgentChatReadModel,
  type AgentChatLifecycle,
  type AgentChatRecord,
} from '@/providers/services/agent-chat-service';

interface FlatChat extends AgentChatRecord {
  depth: number;
}

function flattenChats(
  records: AgentChatRecord[],
  depth = 0,
): FlatChat[] {
  return records.flatMap((record) => [
    { ...record, depth },
    ...flattenChats(record.children, depth + 1),
  ]);
}

export function ChatList() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const opencode = useOpencode();
  const pairedHost = usePairedHost();
  const chat = useAgentChat();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] =
    useState<AgentChatLifecycle | 'all'>('all');
  const [projectMenuVisible, setProjectMenuVisible] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [creationProfiles, setCreationProfiles] = useState<AgentOption[]>([]);
  const [dialog, setDialog] = useState<{
    kind: 'rename';
    target: AgentChatRecord;
  } | null>(null);
  const [title, setTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setCreateSheetVisible(false);
    }
  }, [isFocused]);
  const projectsByPath = useMemo(
    () => new Map(opencode.projects.map((project) => [project.path, project])),
    [opencode.projects],
  );
  const readModel = useMemo(
    () =>
      buildAgentChatReadModel(chat.sessions, {
        lifecycle,
        projectId,
      }),
    [chat.sessions, lifecycle, projectId],
  );
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return flattenChats(readModel).filter((item) => {
      if (!normalizedQuery) return true;
      const projectLabel =
        projectsByPath.get(item.projectId ?? '')?.label ?? '';
      return [item.title, item.status, projectLabel].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    });
  }, [projectsByPath, query, readModel]);
  const selectedProject =
    (projectId ? projectsByPath.get(projectId) : null) ?? null;

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

  function openChat(record: AgentChatRecord) {
    router.push({
      pathname: '/agents/chats/[sessionId]',
      params: {
        sessionId: record.id,
        ...(record.projectId ? { projectId: record.projectId } : {}),
      },
    });
  }

  async function run(
    id: string,
    action: () => Promise<void>,
    success: string,
  ) {
    setBusyId(id);
    setFeedback(null);
    try {
      await action();
      setFeedback(success);
    } catch (reason) {
      setFeedback(
        reason instanceof Error ? reason.message : 'That action failed.',
      );
    } finally {
      setBusyId(null);
      setActionMenuId(null);
    }
  }

  async function submitDialog() {
    if (!dialog) return;
    const target = dialog.target;
    if (!target?.projectId) return;
    await run(
      target.id,
      () => chat.renameChat(target.projectId!, target.id, title),
      'Chat renamed.',
    );
    setDialog(null);
    setTitle('');
  }

  function confirmDelete(record: AgentChatRecord) {
    if (!record.projectId) return;
    Alert.alert(
      'Delete chat permanently?',
      `“${record.title}” and its transcript will be removed from the Mac. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void run(
              record.id,
              () => chat.deleteChat(record.projectId!, record.id),
              'Chat deleted.',
            ),
        },
      ],
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header
        elevated={false}
        style={{ backgroundColor: palette.background }}>
        <Appbar.Content
          title="Chats"
          titleStyle={{ color: palette.text }}
        />
        <Appbar.Action
          accessibilityLabel="Open workspace"
          icon="folder-outline"
          onPress={() => router.push('/agents/workspace')}
        />
        <Appbar.Action
          accessibilityLabel="Open terminal"
          icon="console"
          onPress={() => router.push('/agents/terminal')}
        />
        <Appbar.Action
          accessibilityLabel="Create chat"
          disabled={!chat.isOnline || busyId === 'create'}
          icon="plus"
          onPress={() => void openCreateSheet()}
        />
      </Appbar.Header>

      <View style={styles.filters}>
        <Searchbar
          accessibilityLabel="Search chats"
          onChangeText={setQuery}
          placeholder="Search chats"
          value={query}
        />
        <Menu
          anchor={
            <Button
              accessibilityLabel="Filter chats by project"
              icon="folder-multiple-outline"
              mode="outlined"
              onPress={() => setProjectMenuVisible(true)}>
              {selectedProject?.label ?? 'All projects'}
            </Button>
          }
          onDismiss={() => setProjectMenuVisible(false)}
          visible={projectMenuVisible}>
          <Menu.Item
            leadingIcon={projectId === null ? 'check' : undefined}
            onPress={() => {
              setProjectId(null);
              setProjectMenuVisible(false);
            }}
            title="All projects"
          />
          {opencode.projects.map((project) => (
            <Menu.Item
              key={project.path}
              leadingIcon={projectId === project.path ? 'check' : undefined}
              onPress={() => {
                setProjectId(project.path);
                setProjectMenuVisible(false);
              }}
              title={project.label}
            />
          ))}
        </Menu>
        <SegmentedButtons
          buttons={[
            {
              value: 'all',
              label: 'All',
              accessibilityLabel: 'All chat states',
              testID: 'chat-lifecycle-all',
            },
            {
              value: 'active',
              label: 'Active',
              accessibilityLabel: 'Active chats',
              testID: 'chat-lifecycle-active',
            },
            {
              value: 'completed',
              label: 'Completed',
              accessibilityLabel: 'Completed chats',
              testID: 'chat-lifecycle-completed',
            },
            {
              value: 'archived',
              label: 'Archived',
              accessibilityLabel: 'Archived chats',
              testID: 'chat-lifecycle-archived',
            },
          ]}
          onValueChange={(value) =>
            setLifecycle(value as AgentChatLifecycle | 'all')}
          value={lifecycle}
        />
        {chat.isOfflineCache ? (
          <Card
            testID="paired-mac-offline-state"
            accessibilityLabel="Offline saved chats. Actions are unavailable."
            mode="contained"
            style={{ backgroundColor: palette.surfaceAlt }}>
            <Card.Content>
              <Text
                style={{ color: palette.warning }}
                variant="bodyMedium">
                {pairedHost.message}
              </Text>
            </Card.Content>
          </Card>
        ) : null}
      </View>

      <Divider />
      <FlatList
        accessibilityLabel="Chats"
        contentContainerStyle={
          rows.length === 0 ? styles.emptyList : styles.list
        }
        data={rows}
        keyExtractor={(item) => `${item.projectId ?? 'none'}:${item.id}`}
        refreshControl={
          <RefreshControl
            onRefresh={() => void chat.refresh()}
            refreshing={chat.isLoading}
            tintColor={palette.tint}
          />
        }
        renderItem={({ item }) => (
          <Card
            accessibilityLabel={`${item.title}, ${item.status}`}
            mode="outlined"
            onPress={() => openChat(item)}
            style={[
              styles.card,
              item.depth > 0 && styles.childCard,
              { borderColor: palette.border },
            ]}>
            <Card.Title
              title={item.title}
              subtitle={`${projectsByPath.get(item.projectId ?? '')?.label ?? 'Unknown project'} · ${item.status}`}
              titleNumberOfLines={2}
              subtitleNumberOfLines={2}
              right={() => (
                <Menu
                  anchor={
                    <IconButton
                      accessibilityLabel={`Chat actions for ${item.title}`}
                      disabled={!chat.isOnline || busyId === item.id}
                      icon="dots-horizontal"
                      onPress={() => setActionMenuId(item.id)}
                    />
                  }
                  onDismiss={() => setActionMenuId(null)}
                  visible={actionMenuId === item.id}>
                  <Menu.Item
                    leadingIcon="open-in-new"
                    onPress={() => {
                      setActionMenuId(null);
                      openChat(item);
                    }}
                    title="Open"
                  />
                  <Menu.Item
                    leadingIcon="pencil-outline"
                    onPress={() => {
                      setActionMenuId(null);
                      setTitle(item.title);
                      setDialog({ kind: 'rename', target: item });
                    }}
                    title="Rename"
                  />
                  {item.archivedAt ? (
                    <Menu.Item
                      leadingIcon="restore"
                      onPress={() =>
                        item.projectId
                          ? void run(
                              item.id,
                              () =>
                                chat.restoreChat(item.projectId!, item.id),
                              'Chat restored.',
                            )
                          : undefined}
                      title="Restore"
                    />
                  ) : (
                    <Menu.Item
                      leadingIcon="archive-outline"
                      onPress={() =>
                        item.projectId
                          ? void run(
                              item.id,
                              () =>
                                chat.archiveChat(item.projectId!, item.id),
                              'Chat archived.',
                            )
                          : undefined}
                      title="Archive"
                    />
                  )}
                  <Menu.Item
                    leadingIcon="source-fork"
                    onPress={() =>
                      item.projectId
                        ? void run(
                            item.id,
                            async () => {
                              const forked = await chat.forkChat(
                                item.projectId!,
                                item.id,
                              );
                              openChat(forked as unknown as AgentChatRecord);
                            },
                            'Chat forked.',
                          )
                        : undefined}
                    testID={`chat-action-fork-${item.id}`}
                    title="Fork"
                  />
                  <Divider />
                  <Menu.Item
                    leadingIcon="delete-outline"
                    onPress={() => {
                      setActionMenuId(null);
                      confirmDelete(item);
                    }}
                    title="Delete"
                    titleStyle={{ color: palette.danger }}
                  />
                </Menu>
              )}
            />
          </Card>
        )}
        ListEmptyComponent={
          chat.isLoading ? (
            <ToolScreenState state="loading" title="Loading chats" />
          ) : chat.error && !chat.isOfflineCache ? (
            <ToolScreenState
              actionLabel="Try again"
              message={chat.error}
              onAction={() => void chat.refresh()}
              state="error"
              title="Could not load chats"
            />
          ) : (
            <View accessibilityRole="summary" style={styles.empty}>
              <Text
                accessibilityRole="header"
                style={{ color: palette.text }}
                variant="headlineSmall">
                {query.trim() || projectId || lifecycle !== 'all'
                  ? 'No matching chats'
                  : 'No chats yet'}
              </Text>
              <Text style={{ color: palette.muted }} variant="bodyLarge">
                {chat.isOnline
                  ? 'Pull to refresh or create a new chat.'
                  : 'Reconnect to your paired Mac to load chats.'}
              </Text>
            </View>
          )
        }
      />

      <Portal>
        <Dialog
          onDismiss={() => setDialog(null)}
          visible={dialog !== null}>
          <Dialog.Title>
            Rename chat
          </Dialog.Title>
          <Dialog.Content>
            <TextInput
              accessibilityLabel="Chat title"
              autoFocus
              label="Title"
              onChangeText={setTitle}
              value={title}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>Cancel</Button>
            <Button
              disabled={
                busyId !== null ||
                !title.trim()
              }
              onPress={() => void submitDialog()}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <SessionConfigurationSheet
        availableModels={opencode.availableModels}
        availableProfiles={creationProfiles}
        availableProviders={opencode.configuredProviders}
        mode="create"
        onCreate={async (newTitle, preferences) => {
          const targetProject = targetProjectForNewChat();
          if (!targetProject) {
            throw new Error('Choose a project before creating a chat.');
          }
          setBusyId('create');
          try {
            const created = await chat.createChat(
              targetProject,
              newTitle,
              preferences,
            );
            openChat(created as unknown as AgentChatRecord);
          } finally {
            setBusyId(null);
          }
        }}
        onDismiss={() => setCreateSheetVisible(false)}
        palette={palette}
        preferences={opencode.chatPreferences}
        visible={createSheetVisible && isFocused}
      />
      <Snackbar
        onDismiss={() => setFeedback(null)}
        visible={Boolean(feedback)}>
        {feedback}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: { gap: 12, padding: 16 },
  list: { gap: 10, padding: 16, paddingBottom: 32 },
  emptyList: { flexGrow: 1 },
  card: { borderRadius: 16 },
  childCard: { marginLeft: 24 },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 24,
  },
});
