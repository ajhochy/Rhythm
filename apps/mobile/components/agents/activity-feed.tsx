import { useRouter } from 'expo-router';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import {
  Avatar,
  Card,
  Chip,
  Searchbar,
  SegmentedButtons,
  Text,
} from 'react-native-paper';
import { useMemo, useState } from 'react';

import { ToolScreenState } from '@/components/tools/tool-screen-state';
import type { ToolScreenStateKind } from '@/components/tools/tool-screen-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getActivityDeepLink,
  type ActivityItem,
} from '@/providers/services/activity-service';
import {
  filterAgentActivities,
  type AgentActivityStatusFilter,
} from '@/providers/services/agent-category-service';

const STATUS_ICON: Record<ActivityItem['status'], string> = {
  active: 'progress-clock',
  waiting: 'clock-outline',
  failed: 'alert-circle-outline',
  completed: 'check-circle-outline',
};

export function ActivityFeed({
  items,
  loading,
  offline,
  error,
  errorState,
  refreshing,
  hasMore,
  onRefresh,
  onLoadMore,
  category,
  emptyTitle,
  emptyMessage,
  emptyActionLabel,
  emptyActionHref,
  searchPlaceholder,
}: {
  items: ActivityItem[];
  loading: boolean;
  offline: boolean;
  error: string | null;
  errorState: Extract<
    ToolScreenStateKind,
    'expired-auth' | 'forbidden' | 'error'
  > | null;
  refreshing: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  category?: 'scheduled' | 'background';
  emptyTitle?: string;
  emptyMessage?: string;
  emptyActionLabel?: string;
  emptyActionHref?: string;
  searchPlaceholder?: string;
}) {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<AgentActivityStatusFilter>('all');
  const categoryItems = useMemo(
    () =>
      category
        ? filterAgentActivities(items, {
            category,
            query,
            status: statusFilter,
          })
        : items,
    [category, items, query, statusFilter],
  );
  const unfilteredCategoryItems = useMemo(
    () =>
      category
        ? filterAgentActivities(items, {
            category,
            query: '',
            status: 'all',
          })
        : items,
    [category, items],
  );

  if (loading && unfilteredCategoryItems.length === 0) {
    return <ToolScreenState state="loading" title="Loading activity" />;
  }
  if (errorState && unfilteredCategoryItems.length === 0) {
    return (
      <ToolScreenState
        actionLabel={errorState === 'error' ? 'Try again' : undefined}
        message={error ?? undefined}
        onAction={errorState === 'error' ? onRefresh : undefined}
        state={errorState}
        title={errorState === 'error' ? 'Could not load activity' : undefined}
      />
    );
  }
  if (unfilteredCategoryItems.length === 0) {
    return (
      <ToolScreenState
        actionLabel={
          offline ? undefined : (emptyActionLabel ?? 'Refresh')
        }
        message={emptyMessage}
        onAction={
          offline
            ? undefined
            : emptyActionHref
              ? () => router.push(emptyActionHref as never)
              : onRefresh
        }
        state={offline ? 'offline-cache' : 'empty'}
        title={
          offline
            ? 'Activity unavailable offline'
            : (emptyTitle ?? 'No activity yet')
        }
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {offline ? (
        <Card
          accessibilityLabel="Offline saved activity. Links are read-only."
          mode="contained"
          style={[styles.notice, { backgroundColor: palette.surfaceAlt }]}>
          <Card.Content>
            <Text style={{ color: palette.warning }} variant="bodyMedium">
              Mac offline — showing a read-only saved feed.
            </Text>
          </Card.Content>
        </Card>
      ) : null}
      {category && searchPlaceholder ? (
        <View style={styles.filters}>
          <Searchbar
            accessibilityLabel={searchPlaceholder}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            value={query}
          />
          <SegmentedButtons
            buttons={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed' },
              { value: 'failed', label: 'Failed' },
            ]}
            onValueChange={(value) =>
              setStatusFilter(value as AgentActivityStatusFilter)}
            value={statusFilter}
          />
        </View>
      ) : null}
      <FlatList
        accessibilityLabel={
          category ? `${category} agent activity` : 'Agent activity feed'
        }
        contentContainerStyle={
          categoryItems.length === 0 ? styles.emptyList : styles.list
        }
        data={categoryItems}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (hasMore && !loading) onLoadMore();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor={palette.tint}
          />
        }
        renderItem={({ item }) => {
          const deepLink = getActivityDeepLink(item);
          return (
            <Card
              accessibilityLabel={`${item.title}. ${item.source}. ${item.status}.`}
              accessibilityRole={deepLink ? 'button' : undefined}
              disabled={!deepLink}
              mode="outlined"
              onPress={
                deepLink
                  ? () => {
                      if (item.sessionId && item.projectId) {
                        router.push({
                          pathname: '/agents/chats/[sessionId]',
                          params: {
                            sessionId: item.sessionId,
                            projectId: item.projectId,
                          },
                        });
                        return;
                      }
                      router.push(deepLink as never);
                    }
                  : undefined
              }
              style={[styles.card, { borderColor: palette.border }]}>
              <Card.Title
                left={(props) => (
                  <Avatar.Icon
                    {...props}
                    icon={STATUS_ICON[item.status]}
                  />
                )}
                subtitle={new Date(item.occurredAt).toLocaleString()}
                title={item.title}
                titleNumberOfLines={2}
              />
              <Card.Content style={styles.content}>
                <View style={styles.chips}>
                  <Chip compact>{item.source}</Chip>
                  <Chip compact icon={STATUS_ICON[item.status]}>
                    {item.status}
                  </Chip>
                </View>
                {item.summary ? (
                  <Text
                    numberOfLines={4}
                    style={{ color: palette.muted }}
                    variant="bodyMedium">
                    {item.summary}
                  </Text>
                ) : null}
              </Card.Content>
            </Card>
          );
        }}
        ListFooterComponent={
          loading && items.length > 0 ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.footer, { color: palette.muted }]}
              variant="bodyMedium">
              Loading more activity…
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View accessibilityRole="summary" style={styles.empty}>
            <Text accessibilityRole="header" variant="titleMedium">
              {category === 'scheduled'
                ? 'No matching scheduled tasks'
                : 'No matching background loops'}
            </Text>
            <Text style={{ color: palette.muted }} variant="bodyLarge">
              Try a different search or status filter.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  notice: { margin: 16, marginBottom: 0 },
  filters: { gap: 10, padding: 16, paddingBottom: 0 },
  list: { gap: 12, padding: 16, paddingBottom: 32 },
  emptyList: { flexGrow: 1 },
  card: { borderRadius: 16 },
  content: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: { padding: 16, textAlign: 'center' },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 24,
  },
});
