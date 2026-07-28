import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, SegmentedButtons, Text } from 'react-native-paper';
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
        style={[styles.header, { backgroundColor: palette.background }]}>
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" variant="headlineSmall">
            Agents
          </Text>
          <IconButton
            accessibilityLabel="Show activity"
            icon="pulse"
            onPress={() => setSection('activity')}
          />
        </View>
      </SafeAreaView>
      <SegmentedButtons
        buttons={[
          {
            value: 'chats',
            label: `Chats (${counts.chats})`,
            icon: 'message-outline',
            accessibilityLabel: `Chats, ${counts.chats} items`,
          },
          {
            value: 'scheduled',
            label: `Scheduled Tasks (${counts.scheduled})`,
            icon: 'calendar-clock',
            accessibilityLabel: `Scheduled Tasks, ${counts.scheduled} items`,
          },
          {
            value: 'background',
            label: `Background Loops (${counts.background})`,
            icon: 'sync',
            accessibilityLabel: `Background Loops, ${counts.background} items`,
          },
        ]}
        onValueChange={(value) =>
          setSection(value as AgentCategory)}
        style={styles.sections}
        value={section}
      />
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
  header: { paddingBottom: 12, paddingHorizontal: 16, paddingTop: 12 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sections: { marginHorizontal: 16, marginBottom: 8 },
});
