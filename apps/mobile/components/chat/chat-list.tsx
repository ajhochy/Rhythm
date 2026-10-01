import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
  IconButton,
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
import { Colors, Fonts, MinimumTouchTarget, Spacing, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatTimestamp } from '@/lib/opencode/format';
import { isAccountBootstrapFailure } from '@/lib/pairing/mobile-environment-contract';
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

type ProjectGroup = {
  activeCount: number;
  key: string;
  label: string;
  path: string;
  pendingQuestionCount: number;
  recentActivityAt?: number;
  rows: FlatChat[];
};

type ProjectSort = 'recent' | 'alphabetical';

type ChatListItem =
  | ({ kind: 'chat' } & FlatChat)
  | { kind: 'empty-project'; key: string }
  | { expanded: boolean; group: ProjectGroup; kind: 'project' };

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
  const chat = useAgentChat();
  const pairedHost = usePairedHost();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [query, setQuery] = useState('');
  const [projectSort, setProjectSort] = useState<ProjectSort>('recent');
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
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
  const activeCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    flattenChats(
      buildAgentChatReadModel(
        chat.sessions.map((session) =>
          session && typeof session === 'object' && !Array.isArray(session)
            ? { ...session, parentId: null, parentID: null, parentSessionId: null }
            : session,
        ),
        { lifecycle: 'active' },
      ),
      0,
      new Set(),
      true,
    ).forEach((session) => {
      const key = session.projectId ?? session.routingProjectId ?? '__desktop__';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [chat.sessions]);
  const pendingQuestionSessionIds = useMemo(
    () => new Set(opencode.pendingQuestionSessionIds),
    [opencode.pendingQuestionSessionIds],
  );
  const pendingQuestionCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    chat.sessions.forEach((session) => {
      if (!pendingQuestionSessionIds.has(session.id)) return;
      const key = session.projectId ?? session.routingProjectId ?? '__desktop__';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [chat.sessions, pendingQuestionSessionIds]);
  const recentActivityByProject = useMemo(() => {
    const activity = new Map<string, number>();
    flattenChats(
      buildAgentChatReadModel(chat.sessions, { lifecycle: 'all' }),
      0,
      new Set(),
      true,
    ).forEach((session) => {
      const key = session.projectId ?? session.routingProjectId ?? '__desktop__';
      activity.set(key, Math.max(activity.get(key) ?? Number.NEGATIVE_INFINITY, session.updatedAt));
    });
    return activity;
  }, [chat.sessions]);
  const projectGroups = useMemo(() => {
    const groups = new Map<string, ProjectGroup>();
    opencode.projects.forEach((project) => {
      if (controller.projectId && project.path !== controller.projectId) return;
      groups.set(project.path, {
        activeCount: activeCountByProject.get(project.path) ?? 0,
        key: project.path,
        label: project.label,
        path: project.path,
        pendingQuestionCount: pendingQuestionCountByProject.get(project.path) ?? 0,
        recentActivityAt: recentActivityByProject.get(project.path),
        rows: [],
      });
    });
    rows.forEach((row) => {
      const key = row.projectId ?? row.routingProjectId ?? '__desktop__';
      if (controller.projectId && key !== controller.projectId) return;
      const mirroredLabel = typeof row.projectName === 'string' && row.projectName.trim()
        ? row.projectName.trim()
        : undefined;
      const group = groups.get(key) ?? {
        activeCount: activeCountByProject.get(key) ?? 0,
        key,
        label: key === '__desktop__' ? 'Desktop chats' : mirroredLabel ?? 'Unknown project',
        path: key === '__desktop__' ? 'Local desktop sessions' : key,
        pendingQuestionCount: pendingQuestionCountByProject.get(key) ?? 0,
        recentActivityAt: recentActivityByProject.get(key),
        rows: [],
      };
      group.rows.push(row);
      groups.set(key, group);
    });
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...groups.values()]
      .filter((group) => {
        if (!normalizedQuery) return true;
        return group.rows.length > 0 || [group.label, group.path].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => {
        const alphabetical = left.label.localeCompare(right.label);
        if (projectSort === 'alphabetical') return alphabetical;
        if (left.recentActivityAt === undefined) {
          return right.recentActivityAt === undefined ? alphabetical : 1;
        }
        if (right.recentActivityAt === undefined) return -1;
        return right.recentActivityAt - left.recentActivityAt || alphabetical;
      });
  }, [activeCountByProject, controller.projectId, opencode.projects, pendingQuestionCountByProject, projectSort, query, recentActivityByProject, rows]);
  useEffect(() => {
    if (controller.lifecycle === 'all') return;
    const matchingProjectIds = flattenChats(readModel, 0, new Set(), true).map(
      (row) => row.projectId ?? row.routingProjectId ?? '__desktop__',
    );
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      matchingProjectIds.forEach((projectId) => next.add(projectId));
      return next.size === current.size ? current : next;
    });
  }, [controller.lifecycle, readModel]);
  const listItems = useMemo<ChatListItem[]>(() => projectGroups.flatMap((group) => {
    const expanded = expandedProjectIds.has(group.key)
      || (controller.lifecycle !== 'all' && group.rows.length > 0);
    const revealRows = Boolean(query.trim()) || expanded;
    const items: ChatListItem[] = [{ expanded, group, kind: 'project' }];
    if (revealRows) {
      items.push(...group.rows.map((row) => ({ ...row, kind: 'chat' as const })));
      if (group.rows.length === 0) {
        items.push({ key: `${group.key}:empty`, kind: 'empty-project' });
      }
    }
    return items;
  }), [controller.lifecycle, expandedProjectIds, projectGroups, query]);
  const visibleSessionCount = projectGroups.reduce(
    (total, group) => total + group.rows.length,
    0,
  );
  const hasFilters = Boolean(query.trim() || controller.projectId || controller.lifecycle !== 'all');
  // Recovery replaces the empty list; with cached chats on screen it would only
  // hide the offline warning those rows still need.
  const showsBootstrapRecovery =
    visibleSessionCount === 0 && isAccountBootstrapFailure(pairedHost.bootstrapState);
  const selectedProjectLabel = controller.projectId
    ? projectsByPath.get(controller.projectId)?.label ?? 'Selected project'
    : 'All projects';
  const lifecycleLabel = controller.lifecycle === 'all'
    ? 'All states'
    : `${controller.lifecycle.charAt(0).toUpperCase()}${controller.lifecycle.slice(1)}`;
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
        <View style={styles.toolbar} testID="chat-list-toolbar">
          <View style={styles.search} testID="chat-list-search">
            <Searchbar
              accessibilityLabel="Search chats"
              inputStyle={styles.searchInput}
              onChangeText={setQuery}
              placeholder="Search projects and chats"
              style={styles.searchField}
              value={query}
            />
          </View>
          <View style={styles.toolbarActions} testID="chat-list-actions">
            <Menu
              anchor={
                <IconButton
                  accessibilityLabel={`Sort projects, ${projectSort === 'recent' ? 'Recent activity' : 'Alphabetical'}`}
                  accessibilityState={{ expanded: sortMenuVisible }}
                  icon={projectSort === 'recent' ? 'sort-clock-descending-outline' : 'sort-alphabetical-ascending'}
                  mode="outlined"
                  onPress={() => setSortMenuVisible(true)}
                  size={20}
                  style={styles.toolbarIconAction}
                />
              }
              onDismiss={() => setSortMenuVisible(false)}
              visible={sortMenuVisible}>
              <Menu.Item
                onPress={() => {
                  setProjectSort('recent');
                  setSortMenuVisible(false);
                }}
                title="Recent activity"
              />
              <Menu.Item
                onPress={() => {
                  setProjectSort('alphabetical');
                  setSortMenuVisible(false);
                }}
                title="Alphabetical"
              />
            </Menu>
            <IconButton
              accessibilityLabel="New chat"
              disabled={!chat.isOnline || controller.isCreating}
              icon="plus"
              mode="contained-tonal"
              onPress={() => void controller.openCreateSheet()}
              size={20}
              style={styles.toolbarIconAction}
            />
          </View>
        </View>
        {hasFilters ? (
          <View style={styles.activeFilters}>
            {controller.projectId ? (
              <View style={styles.activeFilterButton} testID="project-filter-control">
                <Button
                  accessibilityLabel={`Clear project filter, ${selectedProjectLabel}`}
                  compact
                  contentStyle={styles.activeFilterButtonContent}
                  icon="close"
                  mode="outlined"
                  onPress={() => controller.setProjectId(null)}
                  style={styles.activeFilterButton}>
                  {selectedProjectLabel}
                </Button>
              </View>
            ) : null}
            {controller.lifecycle !== 'all' ? (
              <View style={styles.activeFilterButton} testID="lifecycle-filter-control">
                <Button
                  accessibilityLabel={`Clear lifecycle filter, ${lifecycleLabel}`}
                  compact
                  contentStyle={styles.activeFilterButtonContent}
                  icon="close"
                  mode="outlined"
                  onPress={() => controller.setLifecycle('all')}
                  style={styles.activeFilterButton}>
                  {lifecycleLabel}
                </Button>
              </View>
            ) : null}
            <Button
              accessibilityLabel="Clear filters"
              compact
              icon="filter-remove-outline"
              onPress={() => {
                setQuery('');
                controller.setProjectId(null);
                controller.setLifecycle('all');
              }}
              style={styles.clearFilters}>
              Clear filters
            </Button>
          </View>
        ) : null}
        {chat.isOfflineCache && !showsBootstrapRecovery ? (
          <Card
            testID="paired-mac-offline-state"
            accessibilityLabel="Offline saved chats. Actions are unavailable."
            mode="contained"
            style={{ backgroundColor: palette.surfaceAlt }}>
            <Card.Content>
              <Text
                style={{ color: palette.warning }}
                variant="bodyMedium">
                {opencode.connection.message}
              </Text>
            </Card.Content>
          </Card>
        ) : null}
        {chat.error && visibleSessionCount > 0 && !chat.isOfflineCache ? (
          <Card
            accessibilityRole="alert"
            mode="contained"
            style={{ backgroundColor: palette.surfaceAlt }}>
            <Card.Content style={styles.refreshErrorContent}>
              <View style={styles.refreshErrorCopy}>
                <Text variant="titleSmall" style={{ color: palette.text }}>Could not refresh chats</Text>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>{chat.error}</Text>
              </View>
              <Button accessibilityLabel="Try again" compact onPress={() => void chat.refresh()}>Try again</Button>
            </Card.Content>
          </Card>
        ) : null}
      </View>

      <Divider />
      <FlatList
        accessibilityLabel="Chats"
        contentContainerStyle={
          showsBootstrapRecovery || listItems.length === 0 ? styles.emptyList : styles.list
        }
        data={showsBootstrapRecovery ? [] : listItems}
        keyExtractor={(item) => item.kind === 'chat'
          ? `${item.projectId ?? 'none'}:${item.id}`
          : item.kind === 'project'
            ? `project:${item.group.key}`
            : item.key}
        refreshControl={
          <RefreshControl
            onRefresh={() => void chat.refresh()}
            refreshing={chat.isLoading}
            tintColor={palette.tint}
          />
        }
        renderItem={({ item }) => {
          if (item.kind === 'project') {
            const stateLabel = item.expanded ? 'expanded' : 'collapsed';
            const pendingLabel = item.group.pendingQuestionCount > 0
              ? `, ${item.group.pendingQuestionCount} needs answer`
              : '';
            return (
              <View style={styles.projectHeader}>
                <Pressable
                  accessibilityLabel={`${item.group.label}, ${item.group.activeCount} active${pendingLabel}, ${stateLabel}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: item.expanded }}
                  onPress={() => setExpandedProjectIds((current) => {
                    const next = new Set(current);
                    if (next.has(item.group.key)) next.delete(item.group.key);
                    else next.add(item.group.key);
                    return next;
                  })}
                  style={({ pressed }) => [
                    styles.projectHeaderToggle,
                    { backgroundColor: 'transparent', opacity: pressed ? 0.72 : 1 },
                  ]}>
                  <Text
                    accessible={false}
                    style={[styles.projectChevron, { color: palette.muted }]}
                    testID={`project-header-chevron-${item.group.key}`}>
                    {item.expanded ? '⌄' : '›'}
                  </Text>
                  <View
                    style={styles.projectHeaderText}
                    testID={`project-header-copy-${item.group.key}`}>
                    <Text style={[styles.projectTitle, { color: palette.text }]}>{item.group.label}</Text>
                    <View
                      style={styles.projectMetadata}
                      testID={`project-header-metadata-${item.group.key}`}>
                      <Text style={[styles.projectCount, { color: palette.muted }]}>{`${item.group.activeCount} active`}</Text>
                      {item.group.pendingQuestionCount > 0 ? (
                        <Text style={[styles.projectCount, { color: palette.danger }]}>
                          {`${item.group.pendingQuestionCount} needs answer`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
                {item.group.key !== '__desktop__' ? (
                  <Pressable
                    accessibilityLabel={`New chat in ${item.group.label}`}
                    accessibilityRole="button"
                    disabled={!chat.isOnline || controller.isCreating}
                    onPress={() => void controller.openCreateSheet(item.group.path)}
                    style={styles.projectCreate}
                    testID={`project-new-chat-${item.group.key}`}>
                    <Text accessible={false} style={[styles.projectCreateIcon, { color: palette.tint }]}>＋</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }
          if (item.kind === 'empty-project') {
            return <Text style={[styles.emptyProject, { color: palette.muted }]}>No active sessions</Text>;
          }
          const isCollapsed = collapsedIds.has(item.id);
          const hiddenSummary = isCollapsed && item.descendantCount > 0
            ? `${item.descendantCount} hidden descendant${item.descendantCount === 1 ? '' : 's'}${item.runningDescendantCount > 0 ? ` · ${item.runningDescendantCount} running` : ''}`
            : '';
          const mirroredProjectLabel =
            typeof item.projectName === 'string' && item.projectName.trim()
              ? item.projectName.trim()
              : undefined;
          const projectLabel = item.projectId === null
            ? 'Desktop chat'
            : projectsByPath.get(item.projectId ?? '')?.label ??
              mirroredProjectLabel ??
              'Unknown project';
          const needsAnswer = pendingQuestionSessionIds.has(item.id);
          const metadata = [projectLabel, needsAnswer ? 'Needs answer' : item.status, hiddenSummary]
            .filter(Boolean)
            .join(' · ');
          const rowLabel = [
            item.title,
            `level ${item.depth + 1}`,
            needsAnswer ? 'Needs answer' : item.status,
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
                <Text
                  numberOfLines={1}
                  style={[styles.metadata, { color: needsAnswer ? palette.danger : palette.text }]}>
                  {needsAnswer ? 'Needs answer' : metadata}
                </Text>
                <Text style={[styles.timestamp, { color: palette.muted }]}>
                  {formatTimestamp(item.updatedAt)}
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
        ListHeaderComponent={
          chat.sessions.length === 0 && !hasFilters && !showsBootstrapRecovery ? (
            <View accessibilityRole="summary" style={styles.accountEmptySummary}>
              <Text accessibilityRole="header" style={{ color: palette.text }} variant="headlineSmall">No chats yet</Text>
              <Text style={{ color: palette.muted }} variant="bodyLarge">Create a chat or expand a project to review its sessions.</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          showsBootstrapRecovery ? (
            <ToolScreenState
              actionLabel="Retry connection"
              message={pairedHost.message}
              onAction={() => void pairedHost.retryBootstrap().catch(() => undefined)}
              state="error"
              title="Computer connection unavailable"
            />
          ) : chat.isLoading ? (
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
        availableProjects={controller.projects}
        availableProviders={opencode.configuredProviders}
        mode="create"
        onCreate={async (newTitle, preferences) => {
          const created = await controller.createChat(newTitle, preferences);
          openChat(created as unknown as AgentChatRecord);
        }}
        onDismiss={controller.closeCreateSheet}
        onProjectChange={(projectPath) => controller.openCreateSheet(projectPath)}
        palette={palette}
        preferences={opencode.chatPreferences}
        selectedProjectPath={controller.creationTargetProject}
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
  filters: { gap: Spacing.x2, paddingHorizontal: Spacing.x2, paddingBottom: Spacing.x1, paddingTop: Spacing.x1 },
  toolbar: { alignItems: 'center', flexDirection: 'row', gap: Spacing.x1, minHeight: MinimumTouchTarget },
  search: { flex: 1, minHeight: MinimumTouchTarget, minWidth: 0 },
  searchField: { minHeight: MinimumTouchTarget },
  searchInput: { minHeight: MinimumTouchTarget },
  toolbarActions: { alignItems: 'center', flexDirection: 'row', minHeight: MinimumTouchTarget },
  toolbarIconAction: { height: MinimumTouchTarget, margin: 0, width: MinimumTouchTarget },
  activeFilters: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x1 },
  activeFilterButton: { minHeight: MinimumTouchTarget },
  activeFilterButtonContent: { minHeight: MinimumTouchTarget },
  clearFilters: { minHeight: MinimumTouchTarget },
  refreshErrorContent: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  refreshErrorCopy: { flex: 1, gap: 2, minWidth: 180 },
  list: { padding: Spacing.x2, paddingBottom: Spacing.x8 },
  emptyList: { flexGrow: 1 },
  projectHeader: { alignItems: 'center', flexDirection: 'row', marginTop: Spacing.x1 },
  projectHeaderToggle: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: Spacing.x1, marginTop: 0, minHeight: MinimumTouchTarget, minWidth: 0, paddingVertical: Spacing.x1 },
  projectHeaderText: { alignItems: 'center', flex: 1, flexDirection: 'row', flexShrink: 1, gap: Spacing.x2, minWidth: 0 },
  projectMetadata: { columnGap: Spacing.x2, flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', minWidth: 0 },
  projectTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: TypeScale.footnote, fontWeight: '600' },
  projectCount: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: TypeScale.caption, fontWeight: '500' },
  projectChevron: { flexShrink: 0, fontSize: TypeScale.footnote, lineHeight: TypeScale.subheadline, width: Spacing.x4 },
  projectCreate: { alignItems: 'center', justifyContent: 'center', minHeight: MinimumTouchTarget, minWidth: MinimumTouchTarget },
  projectCreateIcon: { fontSize: 18, lineHeight: 20 },
  emptyProject: { paddingHorizontal: 48, paddingVertical: Spacing.x2 },
  accountEmptySummary: { gap: Spacing.x2, padding: Spacing.x4 },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: MinimumTouchTarget, paddingLeft: Spacing.x1 },
  disclosureButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  disclosureSpacer: { height: 48, width: 48 },
  rowText: { alignSelf: 'stretch', flex: 1, gap: 1, justifyContent: 'center', minHeight: MinimumTouchTarget, minWidth: 0 },
  title: { fontSize: TypeScale.footnote, lineHeight: TypeScale.subheadline },
  parentTitle: { fontWeight: '500' },
  childTitle: { fontWeight: '400' },
  metadata: { fontSize: TypeScale.caption, lineHeight: TypeScale.footnote },
  timestamp: { fontSize: TypeScale.caption2, lineHeight: TypeScale.caption },
  actionButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  controlIcon: { fontSize: 20, lineHeight: 20 },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 24,
  },
});
