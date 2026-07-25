import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAgentChat } from '@/providers/agent-chat-provider';
import { useOpencode } from '@/providers/opencode-provider';
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
  const opencode = useOpencode();
  const chat = useAgentChat();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [lifecycle, setLifecycle] =
    useState<AgentChatLifecycle>('active');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectMenuVisible, setProjectMenuVisible] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    kind: 'create' | 'rename';
    target?: AgentChatRecord;
  } | null>(null);
  const [title, setTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
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
  const rows = useMemo(() => flattenChats(readModel), [readModel]);
  const selectedProject =
    (projectId ? projectsByPath.get(projectId) : null) ?? null;

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
    const targetProject =
      dialog.target?.projectId ??
      projectId ??
      opencode.activeProjectPath ??
      opencode.projects[0]?.path;
    if (!targetProject) {
      setFeedback('Choose a project before creating a chat.');
      return;
    }
    if (dialog.kind === 'create') {
      setBusyId('create');
      try {
        const created = await chat.createChat(targetProject, title);
        setDialog(null);
        setTitle('');
        openChat(created as unknown as AgentChatRecord);
      } catch (reason) {
        setFeedback(
          reason instanceof Error ? reason.message : 'Could not create chat.',
        );
      } finally {
        setBusyId(null);
      }
      return;
    }
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
          onPress={() => {
            setTitle('');
            setDialog({ kind: 'create' });
          }}
        />
      </Appbar.Header>

      <View style={styles.filters}>
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
            { value: 'active', label: 'Active', accessibilityLabel: 'Show active chats' },
            { value: 'completed', label: 'Completed', accessibilityLabel: 'Show completed chats' },
            { value: 'archived', label: 'Archived', accessibilityLabel: 'Show archived chats' },
          ]}
          onValueChange={(value) =>
            setLifecycle(value as AgentChatLifecycle)}
          value={lifecycle}
        />
        {chat.isOfflineCache ? (
          <Card
            accessibilityLabel="Offline saved chats. Actions are unavailable."
            mode="contained"
            style={{ backgroundColor: palette.surfaceAlt }}>
            <Card.Content>
              <Text
                style={{ color: palette.warning }}
                variant="bodyMedium">
                Mac offline — showing a read-only saved list.
              </Text>
            </Card.Content>
          </Card>
        ) : null}
      </View>

      <Divider />
      <FlatList
        accessibilityLabel={`${lifecycle} chats`}
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
                      accessibilityLabel={`Actions for ${item.title}`}
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
                  {lifecycle === 'archived' ? (
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
          <View accessibilityRole="summary" style={styles.empty}>
            <Text
              accessibilityRole="header"
              style={{ color: palette.text }}
              variant="headlineSmall">
              No {lifecycle} chats
            </Text>
            <Text style={{ color: palette.muted }} variant="bodyLarge">
              {chat.error ??
                (chat.isOnline
                  ? 'Pull to refresh or create a new chat.'
                  : 'Reconnect to your paired Mac to load chats.')}
            </Text>
          </View>
        }
      />

      <Portal>
        <Dialog
          onDismiss={() => setDialog(null)}
          visible={dialog !== null}>
          <Dialog.Title>
            {dialog?.kind === 'rename' ? 'Rename chat' : 'New chat'}
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
                (dialog?.kind === 'rename' && !title.trim())
              }
              onPress={() => void submitDialog()}>
              {dialog?.kind === 'rename' ? 'Save' : 'Create'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
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
