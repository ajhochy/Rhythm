import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Searchbar, Text } from 'react-native-paper';

import {
  Colors,
  MinimumTouchTarget,
  Radii,
  Spacing,
  TypeScale,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ColorScheme = 'light' | 'dark';

export type BrainSearchSurfaceProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch?: () => void;
  children?: ReactNode;
  colorScheme?: ColorScheme;
};

export function BrainSearchSurface({
  query,
  onQueryChange,
  onSearch,
  children,
  colorScheme,
}: BrainSearchSurfaceProps) {
  const detectedScheme = useColorScheme();
  const palette = Colors[colorScheme ?? detectedScheme ?? 'light'];
  return (
    <View style={styles.stack}>
      <View style={styles.searchRow}>
        <Searchbar
          accessibilityLabel="Search Brain"
          onChangeText={onQueryChange}
          onSubmitEditing={onSearch}
          placeholder="Search memories"
          style={[styles.search, { backgroundColor: palette.surface }]}
          value={query}
        />
        {onSearch ? (
          <Button
            accessibilityLabel="Search Brain"
            mode="contained"
            onPress={onSearch}
            style={styles.searchButton}
          >
            Search
          </Button>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export type StatusDecisionSummaryProps = {
  status: string;
  summary: string;
  nextDecision?: string;
  colorScheme?: ColorScheme;
};

export function StatusDecisionSummary({
  status,
  summary,
  nextDecision,
  colorScheme,
}: StatusDecisionSummaryProps) {
  const detectedScheme = useColorScheme();
  const palette = Colors[colorScheme ?? detectedScheme ?? 'light'];
  return (
    <View
      accessibilityLabel={`Status ${status}. ${summary}${
        nextDecision ? ` Next decision: ${nextDecision}` : ''
      }`}
      accessibilityRole="summary"
      style={[
        styles.panel,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.eyebrow, { color: palette.tint }]}>Status</Text>
      <Text style={[styles.heading, { color: palette.text }]}>{status}</Text>
      <Text style={[styles.body, { color: palette.muted }]}>{summary}</Text>
      {nextDecision ? (
        <View style={[styles.decision, { backgroundColor: palette.surfaceAlt }]}>
          <Text style={[styles.eyebrow, { color: palette.muted }]}>Next decision</Text>
          <Text style={[styles.body, { color: palette.text }]}>{nextDecision}</Text>
        </View>
      ) : null}
    </View>
  );
}

export type ConnectionMetadataProps = {
  reachability: string;
  authentication: string;
  enablement: string;
  configuration: string;
  colorScheme?: ColorScheme;
};

export function ConnectionMetadata({
  reachability,
  authentication,
  enablement,
  configuration,
  colorScheme,
}: ConnectionMetadataProps) {
  const detectedScheme = useColorScheme();
  const palette = Colors[colorScheme ?? detectedScheme ?? 'light'];
  const rows = [
    ['Reachability', reachability],
    ['Authentication', authentication],
    ['Enablement', enablement],
    ['Configuration', configuration],
  ] as const;
  return (
    <View
      style={[
        styles.metadataGroup,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      {rows.map(([label, value], index) => (
        <View
          key={label}
          style={[
            styles.metadataRow,
            index > 0 && {
              borderTopColor: palette.border,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          <Text style={[styles.metadataLabel, { color: palette.muted }]}>{label}</Text>
          <Text style={[styles.metadataValue, { color: palette.text }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export type ProviderModelGroup = {
  id: string;
  title: string;
  metadata?: string;
  models: readonly { id: string; title?: string; metadata?: string }[];
};

export type ProviderModelGroupsProps = {
  groups: readonly ProviderModelGroup[];
  onModelPress?: (providerId: string, modelId: string) => void;
  colorScheme?: ColorScheme;
};

export function ProviderModelGroups({
  groups,
  onModelPress,
  colorScheme,
}: ProviderModelGroupsProps) {
  const detectedScheme = useColorScheme();
  const palette = Colors[colorScheme ?? detectedScheme ?? 'light'];
  return (
    <View style={styles.stack}>
      {groups.map((group) => (
        <View key={group.id} style={styles.stack}>
          <View style={styles.providerHeader}>
            <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
              {group.title}
            </Text>
            {group.metadata ? (
              <Text style={[styles.body, { color: palette.muted }]}>{group.metadata}</Text>
            ) : null}
          </View>
          <View
            style={[
              styles.metadataGroup,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            {group.models.map((model, index) => {
              const content = (
                <>
                  <Text style={[styles.modelTitle, { color: palette.text }]}>
                    {model.title ?? model.id}
                  </Text>
                  {model.title ? (
                    <Text style={[styles.modelId, { color: palette.muted }]}>{model.id}</Text>
                  ) : null}
                  {model.metadata ? (
                    <Text style={[styles.modelId, { color: palette.muted }]}>{model.metadata}</Text>
                  ) : null}
                </>
              );
              const rowStyle = [
                styles.modelRow,
                index > 0 && {
                  borderTopColor: palette.border,
                  borderTopWidth: StyleSheet.hairlineWidth,
                },
              ];
              return onModelPress ? (
                <Pressable
                  accessibilityLabel={`Open model ${model.id}`}
                  accessibilityRole="button"
                  key={model.id}
                  onPress={() => onModelPress(group.id, model.id)}
                  style={({ pressed }) => [
                    rowStyle,
                    pressed && { backgroundColor: palette.surfaceAlt },
                  ]}
                >
                  {content}
                </Pressable>
              ) : (
                <View key={model.id} style={rowStyle}>
                  {content}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.x4 },
  searchRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2 },
  search: { flex: 1, minWidth: 220 },
  searchButton: { justifyContent: 'center', minHeight: MinimumTouchTarget },
  panel: { borderRadius: Radii.grouped, borderWidth: StyleSheet.hairlineWidth, gap: Spacing.x2, padding: Spacing.x4 },
  eyebrow: { fontSize: TypeScale.footnote, fontWeight: '700', textTransform: 'uppercase' },
  heading: { fontSize: TypeScale.title3, fontWeight: '700' },
  body: { fontSize: TypeScale.body },
  decision: { borderRadius: Radii.control, gap: Spacing.x1, marginTop: Spacing.x2, padding: Spacing.x3 },
  metadataGroup: { borderRadius: Radii.grouped, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  metadataRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2, minHeight: MinimumTouchTarget, padding: Spacing.x3 },
  metadataLabel: { flexBasis: 112, fontSize: TypeScale.secondary, fontWeight: '600' },
  metadataValue: { flex: 1, fontSize: TypeScale.secondary, minWidth: 140 },
  providerHeader: { gap: Spacing.x1, paddingHorizontal: Spacing.x2 },
  modelRow: { gap: Spacing.x1, minHeight: MinimumTouchTarget, padding: Spacing.x3 },
  modelTitle: { flexShrink: 1, fontSize: TypeScale.body, fontWeight: '600' },
  modelId: { flexShrink: 1, fontSize: TypeScale.meta },
});
