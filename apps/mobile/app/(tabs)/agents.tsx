import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Divider, Menu, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityFeed } from '@/components/agents/activity-feed';
import { ChatList } from '@/components/chat/chat-list';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useActivity } from '@/providers/activity-provider';
import { useAgentChat } from '@/providers/agent-chat-provider';
import {
  getAgentCategoryCounts,
  type AgentCategory,
} from '@/providers/services/agent-category-service';

export default function AgentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [section, setSection] =
    useState<AgentCategory | 'activity'>('chats');
  const [menuVisible, setMenuVisible] = useState(false);
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
            <Menu.Item
              accessibilityLabel={`Chats, ${counts.chats} items`}
              leadingIcon="message-outline"
              onPress={() => {
                setSection('chats');
                setMenuVisible(false);
              }}
              title={`Chats (${counts.chats})`}
              trailingIcon={section === 'chats' ? 'check' : undefined}
            />
            <Menu.Item
              accessibilityLabel={`Scheduled Tasks, ${counts.scheduled} items`}
              leadingIcon="calendar-clock"
              onPress={() => {
                setSection('scheduled');
                setMenuVisible(false);
              }}
              title={`Scheduled Tasks (${counts.scheduled})`}
              trailingIcon={section === 'scheduled' ? 'check' : undefined}
            />
            <Menu.Item
              accessibilityLabel={`Background Loops, ${counts.background} items`}
              leadingIcon="sync"
              onPress={() => {
                setSection('background');
                setMenuVisible(false);
              }}
              title={`Background Loops (${counts.background})`}
              trailingIcon={section === 'background' ? 'check' : undefined}
            />
            <Divider />
            <Menu.Item
              accessibilityLabel="Activity"
              leadingIcon="pulse"
              onPress={() => {
                setSection('activity');
                setMenuVisible(false);
              }}
              title="Activity"
              trailingIcon={section === 'activity' ? 'check' : undefined}
            />
          </Menu>
        </View>
      </SafeAreaView>
      {section === 'chats' ? (
        <ChatList />
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
