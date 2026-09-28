import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import {
  Colors,
  MinimumTouchTarget,
  Radii,
  Spacing,
  TypeScale,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ToolCatalogGroup = 'knowledge' | 'automation' | 'system';

export type ToolCatalogItem = {
  id: string;
  title: string;
  group: ToolCatalogGroup;
  metadata: string;
  status?: string;
};

export type ToolCatalogProps = {
  items: readonly ToolCatalogItem[];
  onOpen: (id: string) => void;
  colorScheme?: 'light' | 'dark';
};

const GROUPS: readonly { id: ToolCatalogGroup; title: string }[] = [
  { id: 'knowledge', title: 'Knowledge & review' },
  { id: 'automation', title: 'Automation' },
  { id: 'system', title: 'System & connections' },
];

export function ToolCatalog({ items, onOpen, colorScheme }: ToolCatalogProps) {
  const detectedScheme = useColorScheme();
  const palette = Colors[colorScheme ?? detectedScheme ?? 'light'];

  return (
    <ScrollView
      accessibilityLabel="Agent tools"
      contentContainerStyle={styles.content}
      testID="tool-catalog-scroll"
    >
      {GROUPS.map((group) => {
        const groupedItems = items.filter((item) => item.group === group.id);
        if (groupedItems.length === 0) return null;
        return (
          <View key={group.id} style={styles.section}>
            <Text
              accessibilityRole="header"
              style={[styles.sectionTitle, { color: palette.muted }]}
            >
              {group.title}
            </Text>
            <View
              style={[
                styles.group,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              {groupedItems.map((item, index) => {
                const accessibilityLabel = `${item.title}. ${item.metadata}${
                  item.status ? `. ${item.status}` : ''
                }`;
                return (
                  <Pressable
                    accessibilityLabel={accessibilityLabel}
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => onOpen(item.id)}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && {
                        borderTopColor: palette.border,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                      pressed && { backgroundColor: palette.surfaceAlt },
                    ]}
                  >
                    <View style={styles.copy}>
                      <Text style={[styles.title, { color: palette.text }]}>
                        {item.title}
                      </Text>
                      <Text style={[styles.metadata, { color: palette.muted }]}>
                        {item.metadata}
                      </Text>
                    </View>
                    {item.status ? (
                      <View style={styles.status}>
                        <View
                          style={[styles.statusDot, { backgroundColor: palette.success }]}
                        />
                        <Text style={[styles.statusText, { color: palette.muted }]}>
                          {item.status}
                        </Text>
                      </View>
                    ) : null}
                    <MaterialCommunityIcons
                      color={palette.icon}
                      name="chevron-right"
                      size={20}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.x6, padding: Spacing.x4, paddingBottom: Spacing.x8 },
  section: { gap: Spacing.x2 },
  sectionTitle: {
    fontSize: TypeScale.footnote,
    fontWeight: '600',
    paddingHorizontal: Spacing.x2,
    textTransform: 'uppercase',
  },
  group: { borderRadius: Radii.grouped, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.x3,
    minHeight: MinimumTouchTarget,
    paddingHorizontal: Spacing.x4,
    paddingVertical: Spacing.x3,
  },
  copy: { flex: 1, gap: Spacing.x1, minWidth: 0 },
  title: { fontSize: TypeScale.body, fontWeight: '600' },
  metadata: { fontSize: TypeScale.secondary },
  status: { alignItems: 'center', flexDirection: 'row', gap: Spacing.x1, maxWidth: '36%' },
  statusDot: { borderRadius: Radii.pill, height: 7, width: 7 },
  statusText: { flexShrink: 1, fontSize: TypeScale.footnote },
});
