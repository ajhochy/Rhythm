import type { ComponentProps, ReactNode, RefObject } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import {
  Colors,
  Fonts,
  MinimumTouchTarget,
  Radii,
  Spacing,
  TypeScale,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type TerminalAction = {
  id: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: ComponentProps<typeof Button>['icon'];
  loading?: boolean;
  testID?: string;
};

export type TerminalShellProps = {
  title?: string;
  subtitle?: string;
  output: string;
  actions?: readonly TerminalAction[];
  detailSlot?: ReactNode;
  composerSlot?: ReactNode;
  colorScheme?: 'light' | 'dark';
  outputRef?: RefObject<ScrollView | null>;
};

export function TerminalShell({
  title,
  subtitle,
  output,
  actions = [],
  detailSlot,
  composerSlot,
  colorScheme,
  outputRef,
}: TerminalShellProps) {
  const detectedScheme = useColorScheme();
  const palette = Colors[colorScheme ?? detectedScheme ?? 'light'];
  return (
    <View style={[styles.shell, { backgroundColor: palette.background }]}>
      {title || subtitle ? (
        <View style={[styles.header, { backgroundColor: palette.surface }]}>
          {title ? (
            <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text>
          ) : null}
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.outputContent}
        nestedScrollEnabled
        ref={outputRef}
        style={[styles.output, { backgroundColor: palette.background }]}
      >
        <Text
          selectable
          style={[styles.outputText, { color: palette.text, fontSize: TypeScale.meta }]}
          testID="terminal-output"
        >
          {output}
        </Text>
      </ScrollView>
      {detailSlot}
      {actions.length > 0 ? (
        <View
          accessibilityLabel="Terminal actions"
          style={[
            styles.toolbar,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          {actions.map((action) => (
            <Button
              accessibilityLabel={action.label}
              compact
              disabled={action.disabled}
              icon={action.icon}
              key={action.id}
              loading={action.loading}
              mode="text"
              onPress={action.onPress}
              style={styles.action}
              testID={action.testID}
              textColor={action.destructive ? palette.danger : palette.muted}
            >
              {action.label}
            </Button>
          ))}
        </View>
      ) : null}
      {composerSlot}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, minWidth: 0 },
  header: { gap: Spacing.x1, paddingHorizontal: Spacing.x4, paddingVertical: Spacing.x3 },
  title: { fontSize: TypeScale.title3, fontWeight: '700' },
  subtitle: { flexShrink: 1, fontSize: TypeScale.meta },
  output: { flex: 1 },
  outputContent: { flexGrow: 1, padding: Spacing.x4 },
  outputText: { fontFamily: Fonts.mono, lineHeight: 20 },
  toolbar: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x1, justifyContent: 'flex-end', padding: Spacing.x1 },
  action: { borderRadius: Radii.control, justifyContent: 'center', minHeight: MinimumTouchTarget },
});
