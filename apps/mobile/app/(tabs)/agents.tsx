import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Divider, Menu, Text } from 'react-native-paper';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { ActivityFeed } from '@/components/agents/activity-feed';
import { ChatList } from '@/components/chat/chat-list';
import {
  type ChatListController,
  useChatListController,
} from '@/components/chat/chat-list-controller';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useActivity } from '@/providers/activity-provider';
import { useAgentChat } from '@/providers/agent-chat-provider';
import {
  getAgentCategoryCounts,
  type AgentCategory,
} from '@/providers/services/agent-category-service';

type AgentsOverflowMenuProps = {
  chatController: ChatListController;
  counts: ReturnType<typeof getAgentCategoryCounts>;
  onSectionChange: (section: AgentCategory | 'activity') => void;
  section: AgentCategory | 'activity';
};

export function AgentsOverflowMenu({
  chatController,
  counts,
  onSectionChange,
  section,
}: AgentsOverflowMenuProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menuVisible, setMenuVisible] = useState(false);
  const selectedProject = chatController.projectId
    ? chatController.projects.find(
        (project) => project.path === chatController.projectId,
      )
    : null;

  function selectSection(nextSection: AgentCategory | 'activity') {
    if (nextSection !== 'chats') chatController.closeCreateSheet();
    onSectionChange(nextSection);
    setMenuVisible(false);
  }

  return (
    <Menu
      anchor={
        <Pressable
          accessibilityLabel="Agents menu"
          accessibilityRole="button"
          onPress={() => setMenuVisible(true)}
          style={({ pressed }) => [
            styles.headerAction,
            pressed && styles.headerActionPressed,
          ]}>
          <MaterialCommunityIcons
            name="dots-horizontal"
            size={24}
            color={palette.text}
          />
        </Pressable>
      }
      onDismiss={() => setMenuVisible(false)}
      visible={menuVisible}>
      <ScrollView
        accessibilityLabel="Agents menu options"
        bounces={false}
        style={{
          maxHeight: Math.max(240, height - insets.top - insets.bottom - 96),
        }}
        testID="agents-overflow-scroll">
      <Menu.Item
        accessibilityLabel={`Chats, ${counts.chats} items`}
        leadingIcon="message-outline"
        onPress={() => selectSection('chats')}
        title={`Chats (${counts.chats})`}
        trailingIcon={section === 'chats' ? 'check' : undefined}
      />
      <Menu.Item
        accessibilityLabel={`Scheduled Tasks, ${counts.scheduled} items`}
        leadingIcon="calendar-clock"
        onPress={() => selectSection('scheduled')}
        title={`Scheduled Tasks (${counts.scheduled})`}
        trailingIcon={section === 'scheduled' ? 'check' : undefined}
      />
      <Menu.Item
        accessibilityLabel={`Background Loops, ${counts.background} items`}
        leadingIcon="sync"
        onPress={() => selectSection('background')}
        title={`Background Loops (${counts.background})`}
        trailingIcon={section === 'background' ? 'check' : undefined}
      />
      <Divider />
      <Menu.Item
        accessibilityLabel="Activity"
        leadingIcon="pulse"
        onPress={() => selectSection('activity')}
        title="Activity"
        trailingIcon={section === 'activity' ? 'check' : undefined}
      />
      {section === 'chats' ? (
        <>
          <Divider />
          <Menu.Item
            accessibilityLabel="Open workspace"
            leadingIcon="folder-outline"
            onPress={() => {
              setMenuVisible(false);
              chatController.openWorkspace();
            }}
            title="Workspace"
          />
          <Menu.Item
            accessibilityLabel="Open terminal"
            leadingIcon="console"
            onPress={() => {
              setMenuVisible(false);
              chatController.openTerminal();
            }}
            title="Terminal"
          />
          <Menu.Item
            accessibilityLabel="Create chat"
            disabled={!chatController.isOnline || chatController.isCreating}
            leadingIcon="plus"
            onPress={() => {
              setMenuVisible(false);
              void chatController.openCreateSheet();
            }}
            title="New chat"
          />
          <Divider />
          <Menu.Item
            disabled
            leadingIcon="folder-multiple-outline"
            title={`Project: ${selectedProject?.label ?? 'All projects'}`}
          />
          <Menu.Item
            accessibilityLabel="Filter chats by project"
            onPress={() => {
              chatController.setProjectId(null);
              setMenuVisible(false);
            }}
            title="All projects"
            trailingIcon={
              chatController.projectId === null ? 'check' : undefined
            }
          />
          {chatController.projects.map((project) => (
            <Menu.Item
              accessibilityLabel={`Filter chats by project, ${project.label}`}
              key={project.path}
              onPress={() => {
                chatController.setProjectId(project.path);
                setMenuVisible(false);
              }}
              title={project.label}
              trailingIcon={
                chatController.projectId === project.path ? 'check' : undefined
              }
            />
          ))}
          <Divider />
          <Menu.Item
            accessibilityLabel="All chat states"
            onPress={() => {
              chatController.setLifecycle('all');
              setMenuVisible(false);
            }}
            title="All states"
            trailingIcon={
              chatController.lifecycle === 'all' ? 'check' : undefined
            }
          />
          <Menu.Item
            accessibilityLabel="Active chats"
            onPress={() => {
              chatController.setLifecycle('active');
              setMenuVisible(false);
            }}
            title="Active"
            trailingIcon={
              chatController.lifecycle === 'active' ? 'check' : undefined
            }
          />
          <Menu.Item
            accessibilityLabel="Completed chats"
            onPress={() => {
              chatController.setLifecycle('completed');
              setMenuVisible(false);
            }}
            title="Completed"
            trailingIcon={
              chatController.lifecycle === 'completed' ? 'check' : undefined
            }
          />
          <Menu.Item
            accessibilityLabel="Archived chats"
            onPress={() => {
              chatController.setLifecycle('archived');
              setMenuVisible(false);
            }}
            title="Archived"
            trailingIcon={
              chatController.lifecycle === 'archived' ? 'check' : undefined
            }
          />
        </>
      ) : null}
      </ScrollView>
    </Menu>
  );
}

export default function AgentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [section, setSection] =
    useState<AgentCategory | 'activity'>('chats');
  const chatController = useChatListController();
  const activity = useActivity();
  const chat = useAgentChat();
  const counts = useMemo(
    () => getAgentCategoryCounts(chat.sessions, activity.items),
    [activity.items, chat.sessions],
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <SafeAreaView
        edges={['top']}
        testID="compact-agents-header"
        style={[styles.header, { backgroundColor: palette.background }]}>
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" variant="headlineSmall">
            Agents
          </Text>
          <AgentsOverflowMenu
            chatController={chatController}
            counts={counts}
            onSectionChange={setSection}
            section={section}
          />
        </View>
      </SafeAreaView>
      {section === 'chats' ? (
        <ChatList controller={chatController} />
      ) : section === 'activity' ? (
        <ActivityFeed
          error={activity.error}
          errorState={activity.errorState}
          hasMore={activity.hasMore}
          items={activity.items}
          loading={activity.loading}
          offline={activity.offline}
          onLoadMore={() => {
            void activity.loadMore();
          }}
          onRefresh={() => {
            void activity.refresh();
          }}
          refreshing={activity.refreshing}
        />
      ) : (
        <ActivityFeed
          category={section}
          emptyActionHref={
            section === 'scheduled' ? '/tools/schedules' : undefined
          }
          emptyActionLabel={
            section === 'scheduled' ? 'Open Scheduled Tasks' : undefined
          }
          emptyMessage={
            section === 'scheduled'
              ? 'Create a scheduled task to run an agent automatically.'
              : 'Background self-improvement work will appear here when a loop runs.'
          }
          emptyTitle={
            section === 'scheduled'
              ? 'No scheduled tasks yet'
              : 'No background loops yet'
          }
          error={activity.error}
          errorState={activity.errorState}
          hasMore={activity.hasMore}
          items={activity.items}
          loading={activity.loading}
          offline={activity.offline}
          onLoadMore={() => {
            void activity.loadMore();
          }}
          onRefresh={() => {
            void activity.refresh();
          }}
          refreshing={activity.refreshing}
          searchPlaceholder={
            section === 'scheduled'
              ? 'Search scheduled tasks'
              : 'Search background loops'
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingBottom: 6, paddingHorizontal: 16, paddingTop: 4 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  headerActionPressed: { opacity: 0.72 },
});
