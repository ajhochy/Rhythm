import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Card,
  Dialog,
  Divider,
  Menu,
  Portal,
  Searchbar,
  Snackbar,
  Text,
  TextInput,
} from 'react-native-paper';

import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
import type { ChatListController } from '@/components/chat/chat-list-controller';
import { ToolScreenState } from '@/components/tools/tool-screen-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAgentChat } from '@/providers/agent-chat-provider';
import { useOpencode } from '@/providers/opencode-provider';
import { usePairedHost } from '@/providers/paired-host-provider';
import {
  buildAgentChatReadModel,
  type AgentChatRecord,
} from '@/providers/services/agent-chat-service';

interface FlatChat extends AgentChatRecord {
  depth: number;
  descendantCount: number;
  runningDescendantCount: number;
}

export function flattenChats(
  records: AgentChatRecord[],
  depth = 0,
  collapsedIds: ReadonlySet<string> = new Set(),
  bypassCollapse = false,
): FlatChat[] {
  const rows: FlatChat[] = [];
  const visit = (
    record: AgentChatRecord,
    recordDepth: number,
    visible: boolean,
  ): Pick<FlatChat, 'descendantCount' | 'runningDescendantCount'> => {
    const { children, ...chat } = record;
    const row: FlatChat = {
      ...chat,
      children,
      depth: recordDepth,
      descendantCount: 0,
      runningDescendantCount: 0,
    };
    if (visible) rows.push(row);

    const showChildren = visible && (bypassCollapse || !collapsedIds.has(record.id));
    for (const child of children) {
      const counts = visit(child, recordDepth + 1, showChildren);
      row.descendantCount += counts.descendantCount + 1;
      row.runningDescendantCount +=
        counts.runningDescendantCount + (child.status === 'running' ? 1 : 0);
    }
    return row;
  };

  records.forEach((record) => visit(record, depth, true));
  return rows;
}

type ChatListProps = {
  controller: ChatListController;
};

export function ChatList({ controller }: ChatListProps) {
  const router = useRouter();
  const opencode = useOpencode();
  const pairedHost = usePairedHost();
  const chat = useAgentChat();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [query, setQuery] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    kind: 'rename';
    target: AgentChatRecord;
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
        lifecycle: controller.lifecycle,
        projectId: controller.projectId,
      }),
    [chat.sessions, controller.lifecycle, controller.projectId],
  );
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return flattenChats(readModel, 0, collapsedIds, Boolean(normalizedQuery)).filter((item) => {
      if (!normalizedQuery) return true;
      const projectLabel =
        projectsByPath.get(item.projectId ?? '')?.label ?? '';
      return [item.title, item.status, projectLabel].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    });
  }, [collapsedIds, projectsByPath, query, readModel]);
  function routingProjectId(record: AgentChatRecord): string | undefined {
    return record.projectId ?? record.routingProjectId ?? opencode.activeProjectPath;
  }

  function openChat(record: AgentChatRecord) {
    const projectId = routingProjectId(record);
    router.push({
      pathname: '/agents/chats/[sessionId]',
      params: {
        sessionId: record.id,
        ...(projectId ? { projectId } : {}),
      },
    });
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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
    const projectId = target ? routingProjectId(target) : undefined;
    if (!target || !projectId) return;
    await run(
      target.id,
      () => chat.renameChat(projectId, target.id, title),
      'Chat renamed.',
    );
    setDialog(null);
    setTitle('');
  }

  function confirmDelete(record: AgentChatRecord) {
    const projectId = routingProjectId(record);
    if (!projectId) return;
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
              () => chat.deleteChat(projectId, record.id),
              'Chat deleted.',
            ),
        },
      ],
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.filters}>
        <Searchbar
          accessibilityLabel="Search chats"
          onChangeText={setQuery}
          placeholder="Search chats"
          value={query}
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
        renderItem={({ item }) => {
          const isCollapsed = collapsedIds.has(item.id);
          const hiddenSummary = isCollapsed && item.descendantCount > 0
            ? `${item.descendantCount} hidden descendant${item.descendantCount === 1 ? '' : 's'}${item.runningDescendantCount > 0 ? ` · ${item.runningDescendantCount} running` : ''}`
            : '';
          const projectLabel = item.projectId === null
            ? 'Desktop chat'
            : projectsByPath.get(item.projectId ?? '')?.label ?? 'Unknown project';
          const metadata = [projectLabel, item.status, hiddenSummary]
            .filter(Boolean)
            .join(' · ');
          const rowLabel = [
            item.title,
            `level ${item.depth + 1}`,
            item.status,
            projectLabel,
            hiddenSummary,
          ].filter(Boolean).join(', ');
          return (
            <View
              accessible={false}
              style={[
                styles.row,
                { marginLeft: Math.min(item.depth * 12, 24) },
              ]}
              testID={`chat-row-${item.id}`}>
              {item.children.length > 0 ? (
                <Pressable
                    accessibilityLabel={`${isCollapsed ? 'Expand' : 'Collapse'} ${item.title}`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !isCollapsed }}
                    onPress={() => toggleCollapsed(item.id)}
                    style={styles.disclosureButton}
                    testID={`chat-disclosure-${item.id}`}>
                    <Text accessible={false} style={styles.controlIcon}>
                      {isCollapsed ? '›' : '⌄'}
                    </Text>
                  </Pressable>
                ) : <View style={styles.disclosureSpacer} />}
              <Pressable
                accessibilityLabel={rowLabel}
                accessibilityRole="button"
                onPress={() => openChat(item)}
                style={styles.rowText}
                testID={`chat-row-open-${item.id}`}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.title,
                    item.depth === 0 ? styles.parentTitle : styles.childTitle,
                    { color: palette.text },
                  ]}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={{ color: palette.text }} variant="bodySmall">
                  {metadata}
                </Text>
              </Pressable>
              <Menu
                anchor={
                  <Pressable
                    accessibilityLabel={`Chat actions for ${item.title}`}
                    accessibilityRole="button"
                    disabled={!chat.isOnline || busyId === item.id}
                    onPress={() => setActionMenuId(item.id)}
                    style={styles.actionButton}
                    testID={`chat-action-${item.id}`}>
                    <Text accessible={false} style={styles.controlIcon}>⋯</Text>
                  </Pressable>
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
                      routingProjectId(item)
                        ? void run(
                            item.id,
                            () =>
                              chat.restoreChat(routingProjectId(item)!, item.id),
                            'Chat restored.',
                          )
                        : undefined}
                    title="Restore"
                  />
                ) : (
                  <Menu.Item
                    leadingIcon="archive-outline"
                    onPress={() =>
                      routingProjectId(item)
                        ? void run(
                            item.id,
                            () =>
                              chat.archiveChat(routingProjectId(item)!, item.id),
                            'Chat archived.',
                          )
                        : undefined}
                    title="Archive"
                  />
                )}
                <Menu.Item
                  leadingIcon="source-fork"
                  onPress={() =>
                    routingProjectId(item)
                      ? void run(
                          item.id,
                          async () => {
                            const forked = await chat.forkChat(
                              routingProjectId(item)!,
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
            </View>
          );
        }}
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
                {query.trim() || controller.projectId || controller.lifecycle !== 'all'
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
        availableProfiles={controller.creationProfiles}
        availableProviders={opencode.configuredProviders}
        mode="create"
        onCreate={async (newTitle, preferences) => {
          const created = await controller.createChat(newTitle, preferences);
          openChat(created as unknown as AgentChatRecord);
        }}
        onDismiss={controller.closeCreateSheet}
        palette={palette}
        preferences={opencode.chatPreferences}
        visible={controller.createSheetVisible && controller.isFocused}
      />
      <Snackbar
        onDismiss={() => {
          setFeedback(null);
          controller.clearFeedback();
        }}
        visible={Boolean(feedback ?? controller.feedback)}>
        {feedback ?? controller.feedback}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: { gap: 12, padding: 16 },
  list: { padding: 8, paddingBottom: 32 },
  emptyList: { flexGrow: 1 },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 56 },
  disclosureButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  disclosureSpacer: { height: 48, width: 48 },
  rowText: { alignSelf: 'stretch', flex: 1, gap: 2, justifyContent: 'center', minHeight: 44, minWidth: 0 },
  title: { fontSize: 16 },
  parentTitle: { fontWeight: '500' },
  childTitle: { fontWeight: '400' },
  actionButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  controlIcon: { fontSize: 24, lineHeight: 24 },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 24,
  },
});
