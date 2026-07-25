import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, SegmentedButtons } from 'react-native-paper';

import { ChatList } from '@/components/chat/chat-list';
import { ActivityFeed } from '@/components/agents/activity-feed';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useActivity } from '@/providers/activity-provider';

export default function AgentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [section, setSection] = useState<'chats' | 'activity'>('chats');
  const activity = useActivity();

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header
        elevated={false}
        style={{ backgroundColor: palette.background }}>
        <Appbar.Content
          title="Agents"
          titleStyle={{ color: palette.text }}
        />
      </Appbar.Header>
      <SegmentedButtons
        buttons={[
          { value: 'chats', label: 'Chats', icon: 'message-outline', accessibilityLabel: 'Show chats' },
          { value: 'activity', label: 'Activity', icon: 'pulse', accessibilityLabel: 'Show activity' },
        ]}
        onValueChange={(value) =>
          setSection(value as 'chats' | 'activity')}
        style={styles.sections}
        value={section}
      />
      {section === 'chats' ? (
        <ChatList />
      ) : (
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sections: { marginHorizontal: 16, marginBottom: 8 },
});
