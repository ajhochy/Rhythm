import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
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
import { useCoordinatorConversation } from '@/providers/coordinator-conversation-provider';
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
  const menuOpenTask = useRef<ReturnType<
    typeof InteractionManager.runAfterInteractions
  > | null>(null);
  const selectedProject = chatController.projectId
    ? chatController.projects.find(
        (project) => project.path === chatController.projectId,
      )
    : null;

  function dismissMenu() {
    menuOpenTask.current?.cancel();
    menuOpenTask.current = null;
    setMenuVisible(false);
  }

  useEffect(() => () => menuOpenTask.current?.cancel(), []);

  function selectSection(nextSection: AgentCategory | 'activity') {
    if (nextSection !== 'chats') chatController.closeCreateSheet();
    onSectionChange(nextSection);
    dismissMenu();
  }

  function openMenu() {
    menuOpenTask.current?.cancel();
    // react-native-paper measures its portalled menu in the next microtask.
    // Let a returning stack screen finish its transition first, otherwise that
    // measurement can observe no portal ref and the Chats menu never appears.
    menuOpenTask.current = InteractionManager.runAfterInteractions(() => {
      menuOpenTask.current = null;
      setMenuVisible(true);
    });
  }

  return (
    <Menu
      anchor={
        <Pressable
          accessibilityLabel="Chats menu"
          accessibilityRole="button"
          onPress={openMenu}
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
      onDismiss={dismissMenu}
      visible={menuVisible}>
      <ScrollView
        accessibilityLabel="Chats menu options"
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
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [section, setSection] =
    useState<AgentCategory | 'activity'>('chats');
  const chatController = useChatListController();
  const activity = useActivity();
  const chat = useAgentChat();
  const coordinator = useCoordinatorConversation();
  const primaryRequestRef = useRef(false);
  const counts = useMemo(
    () => getAgentCategoryCounts(chat.sessions, activity.items),
    [activity.items, chat.sessions],
  );

  useEffect(() => {
    if (!primaryRequestRef.current) return;
    if (coordinator.primaryEntry.phase === 'ready') {
      primaryRequestRef.current = false;
      router.push('/agents/chat' as never);
    } else if (coordinator.primaryEntry.phase === 'unavailable' ||
      coordinator.primaryEntry.phase === 'setup_required' ||
      coordinator.primaryEntry.phase === 'setup_choice') {
      primaryRequestRef.current = false;
    }
  }, [coordinator.primaryEntry.phase, router]);

  const openRhythm = () => {
    if (coordinator.primaryEntry.phase === 'resolving' ||
      coordinator.primaryEntry.phase === 'switching_project' ||
      coordinator.primaryEntry.phase === 'opening_root' ||
      coordinator.primaryEntry.phase === 'opening_coordination') return;
    primaryRequestRef.current = true;
    void coordinator.resolvePrimary().then((accepted) => {
      if (!accepted) primaryRequestRef.current = false;
    });
  };
  const openingRhythm = coordinator.primaryEntry.phase === 'resolving' ||
    coordinator.primaryEntry.phase === 'setting_up' ||
    coordinator.primaryEntry.phase === 'switching_project' ||
    coordinator.primaryEntry.phase === 'opening_root' ||
    coordinator.primaryEntry.phase === 'opening_coordination';
  const setupChoices = coordinator.primaryEntry.setup?.profileChoices;
  const showRhythmSetup = coordinator.primaryEntry.phase === 'setup_required' ||
    coordinator.primaryEntry.phase === 'setup_choice' ||
    coordinator.primaryEntry.phase === 'setting_up';
  const startRhythmSetup = (profileId?: string) => {
    if (openingRhythm) return;
    primaryRequestRef.current = true;
    void coordinator.setupPrimary(profileId).then((accepted) => {
      if (!accepted) primaryRequestRef.current = false;
    });
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <SafeAreaView
        edges={['top']}
        testID="compact-agents-header"
        style={[styles.header, { backgroundColor: palette.background }]}>
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={styles.largeTitle}>
            Chats
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="Open Rhythm"
              accessibilityRole="button"
              accessibilityState={{ busy: openingRhythm }}
              disabled={openingRhythm}
              onPress={openRhythm}
              style={({ pressed }) => [
                styles.rhythmEntry,
                pressed && !openingRhythm && styles.headerActionPressed,
              ]}
              testID="rhythm-primary-entry">
              <Text numberOfLines={1} style={[styles.rhythmEntryLabel, { color: palette.text }]}>
                {openingRhythm ? 'Opening…' : 'Rhythm'}
              </Text>
            </Pressable>
            <AgentsOverflowMenu
              chatController={chatController}
              counts={counts}
              onSectionChange={setSection}
              section={section}
            />
          </View>
        </View>
        {coordinator.primaryEntry.notice ? (
          <Text accessibilityLiveRegion="polite" style={[styles.rhythmNotice, { color: palette.muted }]}>
            {coordinator.primaryEntry.notice}
          </Text>
        ) : null}
        {showRhythmSetup ? (
          <View accessibilityLabel="Rhythm setup" style={[styles.rhythmSetup, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.rhythmSetupTitle, { color: palette.text }]}>Set up Rhythm</Text>
            <Text style={[styles.rhythmSetupCopy, { color: palette.muted }]}>Choose a currently eligible profile only if Rhythm asks. This does not change model, permission, or workspace authority.</Text>
            {setupChoices?.length ? (
              <View style={styles.rhythmSetupChoices}>
                {setupChoices.map((choice) => (
                  <Pressable
                    accessibilityLabel={`Use Rhythm profile ${choice.label}`}
                    accessibilityRole="button"
                    disabled={openingRhythm}
                    key={choice.id}
                    onPress={() => startRhythmSetup(choice.id)}
                    style={({ pressed }) => [styles.rhythmSetupButton, { borderColor: palette.tint }, pressed && !openingRhythm && styles.headerActionPressed]}
                    testID={`rhythm-setup-profile-${choice.id}`}>
                    <Text numberOfLines={1} style={{ color: palette.tint }}>{choice.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Pressable
                accessibilityLabel="Set up Rhythm"
                accessibilityRole="button"
                disabled={openingRhythm}
                onPress={() => startRhythmSetup()}
                style={({ pressed }) => [styles.rhythmSetupButton, { borderColor: palette.tint }, pressed && !openingRhythm && styles.headerActionPressed]}
                testID="rhythm-setup-start">
                <Text style={{ color: palette.tint }}>{openingRhythm ? 'Setting up…' : 'Set up Rhythm'}</Text>
              </Pressable>
            )}
          </View>
        ) : null}
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
  header: { paddingBottom: 4, paddingHorizontal: 12, paddingTop: 4 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  rhythmEntry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
  },
  rhythmEntryLabel: { fontSize: 15, fontWeight: '700' },
  rhythmNotice: { paddingBottom: 4, paddingHorizontal: 4 },
  rhythmSetup: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 8, marginBottom: 8, padding: 10 },
  rhythmSetupTitle: { fontSize: 15, fontWeight: '700' },
  rhythmSetupCopy: { fontSize: 13, lineHeight: 18 },
  rhythmSetupChoices: { gap: 6 },
  rhythmSetupButton: { alignItems: 'center', borderRadius: 9, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  largeTitle: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  headerAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  headerActionPressed: { opacity: 0.72 },
});
