import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Surface,
  Text,
} from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ToolScreenStateKind =
  | 'loading'
  | 'empty'
  | 'offline-cache'
  | 'expired-auth'
  | 'forbidden'
  | 'error';

const DEFAULT_COPY: Record<
  ToolScreenStateKind,
  { title: string; message: string }
> = {
  loading: {
    title: 'Loading',
    message: 'Getting the latest data from your paired Mac.',
  },
  empty: {
    title: 'Nothing here yet',
    message: 'New activity will appear here when an agent starts working.',
  },
  'offline-cache': {
    title: 'Showing saved data',
    message: 'Your Mac is offline. Saved items are read-only until it reconnects.',
  },
  'expired-auth': {
    title: 'Sign in again',
    message: 'Your Rhythm session expired. Sign in to continue.',
  },
  forbidden: {
    title: 'Access unavailable',
    message: 'Your account or paired Mac does not allow this feature.',
  },
  error: {
    title: 'Could not load this screen',
    message: 'Check the connection to your Mac and try again.',
  },
};

export function ToolScreenState({
  state,
  title,
  message,
  actionLabel,
  onAction,
  children,
}: {
  state: ToolScreenStateKind;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const copy = DEFAULT_COPY[state];

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${title ?? copy.title}. ${message ?? copy.message}`}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <Surface
        elevation={1}
        style={[styles.panel, { backgroundColor: palette.surface }]}>
        {state === 'loading' ? (
          <ActivityIndicator
            accessibilityLabel="Loading"
            color={palette.tint}
          />
        ) : null}
        <Text
          accessibilityRole="header"
          style={{ color: palette.text }}
          variant="headlineSmall">
          {title ?? copy.title}
        </Text>
        <Text style={{ color: palette.muted }} variant="bodyLarge">
          {message ?? copy.message}
        </Text>
        {children}
        {actionLabel && onAction ? (
          <Button
            accessibilityLabel={actionLabel}
            mode="contained"
            onPress={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    borderRadius: 20,
    gap: 12,
    maxWidth: 640,
    padding: 24,
    width: '100%',
  },
});
