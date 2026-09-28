import type { ReactElement, ReactNode } from 'react';
import { Pressable, type RefreshControlProps, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Searchbar, SegmentedButtons, Text } from 'react-native-paper';

import {
  Colors,
  MinimumTouchTarget,
  Radii,
  Spacing,
  TypeScale,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type WorkspaceSegment = 'chats' | 'files' | 'tools';

export type WorkspaceRow = {
  id: string;
  title: string;
  metadata?: string;
  path?: string;
  disabled?: boolean;
};

export type WorkspaceGroup = {
  id: string;
  title: string;
  rows: readonly WorkspaceRow[];
};

export type WorkspaceSearch = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

export type WorkspaceShellProps = {
  projectLabel: string;
  projectPath: string;
  activeSegment: WorkspaceSegment;
  onSegmentChange: (segment: WorkspaceSegment) => void;
  groups?: readonly WorkspaceGroup[];
  onOpenRow?: (id: string) => void;
  search?: WorkspaceSearch;
  scopeSelector?: ReactNode;
  chatsContent?: ReactNode;
  filesContent?: ReactNode;
  toolsContent?: ReactNode;
  colorScheme?: 'light' | 'dark';
  refreshControl?: ReactElement<RefreshControlProps>;
};

export function WorkspaceShell({
  projectLabel,
  projectPath,
  activeSegment,
  onSegmentChange,
  groups = [],
  onOpenRow,
  search,
  scopeSelector,
  chatsContent,
  filesContent,
  toolsContent,
  colorScheme,
  refreshControl,
}: WorkspaceShellProps) {
  const detectedScheme = useColorScheme();
  const palette = Colors[colorScheme ?? detectedScheme ?? 'light'];
  const content = {
    chats: chatsContent,
    files: filesContent,
    tools: toolsContent,
  }[activeSegment];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={refreshControl}
      style={{ backgroundColor: palette.background }}
    >
      <View
        accessibilityLabel={`${projectLabel}. ${projectPath}`}
        style={[styles.scope, { backgroundColor: palette.surface }]}
      >
        {scopeSelector ?? (
          <>
            <Text accessibilityRole="header" style={[styles.projectTitle, { color: palette.text }]}>
              {projectLabel}
            </Text>
            <Text selectable style={[styles.projectPath, { color: palette.muted }]}>
              {projectPath}
            </Text>
          </>
        )}
      </View>
      <SegmentedButtons
        buttons={[
          { value: 'chats', label: 'Chats', accessibilityLabel: 'Chats' },
          { value: 'files', label: 'Files', accessibilityLabel: 'Files' },
          { value: 'tools', label: 'Tools', accessibilityLabel: 'Tools' },
        ]}
        onValueChange={(value) => onSegmentChange(value as WorkspaceSegment)}
        value={activeSegment}
      />
      {search ? (
        <View style={styles.searchRow}>
          <Searchbar
            accessibilityLabel={search.label}
            onChangeText={search.onChange}
            onSubmitEditing={search.onSubmit}
            placeholder={search.label}
            style={[styles.search, { backgroundColor: palette.surface }]}
            value={search.value}
          />
          <Button
            accessibilityLabel={search.label}
            disabled={search.disabled}
            mode="contained"
            onPress={search.onSubmit}
            style={styles.searchButton}
          >
            Search
          </Button>
        </View>
      ) : null}
      {groups.map((group) => (
        <View key={group.id} style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.muted }]}>
            {group.title}
          </Text>
          <View
            style={[
              styles.group,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            {group.rows.map((row, index) => {
              const accessibilityLabel = [row.title, row.metadata, row.path]
                .filter(Boolean)
                .join('. ');
              const rowStyle = [
                styles.row,
                index > 0 && {
                  borderTopColor: palette.border,
                  borderTopWidth: StyleSheet.hairlineWidth,
                },
              ];
              const rowContent = (
                <>
                  <Text style={[styles.rowTitle, { color: palette.text }]}>{row.title}</Text>
                  {row.metadata ? (
                    <Text style={[styles.rowMetadata, { color: palette.muted }]}>{row.metadata}</Text>
                  ) : null}
                  {row.path ? (
                    <Text selectable style={[styles.rowPath, { color: palette.muted }]}>
                      {row.path}
                    </Text>
                  ) : null}
                </>
              );
              return onOpenRow ? (
                <Pressable
                  accessibilityLabel={accessibilityLabel}
                  accessibilityRole="button"
                  disabled={row.disabled}
                  key={row.id}
                  onPress={() => onOpenRow(row.id)}
                  style={({ pressed }) => [
                    rowStyle,
                    pressed && { backgroundColor: palette.surfaceAlt },
                    row.disabled && styles.disabled,
                  ]}
                >
                  {rowContent}
                </Pressable>
              ) : (
                <View key={row.id} style={rowStyle}>
                  {rowContent}
                </View>
              );
            })}
          </View>
        </View>
      ))}
      <View style={styles.slot}>{content}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { alignSelf: 'center', gap: Spacing.x4, maxWidth: 1100, padding: Spacing.x4, paddingBottom: Spacing.x8, width: '100%' },
  scope: { borderRadius: Radii.grouped, gap: Spacing.x1, padding: Spacing.x4 },
  projectTitle: { fontSize: TypeScale.title2, fontWeight: '700' },
  projectPath: { flexShrink: 1, fontSize: TypeScale.meta },
  searchRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2 },
  search: { flex: 1, minWidth: 220 },
  searchButton: { justifyContent: 'center', minHeight: MinimumTouchTarget },
  section: { gap: Spacing.x2 },
  sectionTitle: { fontSize: TypeScale.footnote, fontWeight: '600', paddingHorizontal: Spacing.x2, textTransform: 'uppercase' },
  group: { borderRadius: Radii.grouped, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { gap: Spacing.x1, minHeight: MinimumTouchTarget, padding: Spacing.x3 },
  rowTitle: { flexShrink: 1, fontSize: TypeScale.body, fontWeight: '600' },
  rowMetadata: { flexShrink: 1, fontSize: TypeScale.secondary },
  rowPath: { flexShrink: 1, fontSize: TypeScale.meta },
  disabled: { opacity: 0.5 },
  slot: { minWidth: 0 },
});
