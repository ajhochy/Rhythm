import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Surface,
  Text,
} from 'react-native-paper';

import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ToolScreenStateKind =
  | 'loading'
  | 'empty'
  | 'offline-cache'
  | 'missing-scope'
  | 'stale-project'
  | 'unauthorized-pairing'
  | 'version-mismatch'
  | 'network-failure'
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
  'missing-scope': {
    title: 'Select a project',
    message: 'Choose an active Rhythm project before opening this tool.',
  },
  'stale-project': {
    title: 'Project unavailable',
    message: 'This project is no longer registered on the paired Mac. Select another project.',
  },
  'unauthorized-pairing': {
    title: 'Pair this iPhone again',
    message: 'The paired Mac no longer authorizes this iPhone or Rhythm account.',
  },
  'version-mismatch': {
    title: 'Rhythm desktop needs an update',
    message: 'This iPhone is paired, but the desktop version is not compatible. Update Rhythm on your Mac, then try again.',
  },
  'network-failure': {
    title: 'Mac unreachable',
    message: 'Check this iPhone’s network and Rhythm Cloud Gateway connection, then try again.',
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

const STATE_ICONS: Record<
  ToolScreenStateKind,
  ComponentProps<typeof MaterialCommunityIcons>['name']
> = {
  loading: 'progress-clock',
  empty: 'archive-outline',
  'offline-cache': 'cloud-off-outline',
  'missing-scope': 'folder-outline',
  'stale-project': 'folder-alert-outline',
  'unauthorized-pairing': 'cellphone-key',
  'version-mismatch': 'shield-alert-outline',
  'network-failure': 'wifi-off',
  'expired-auth': 'account-clock-outline',
  forbidden: 'shield-lock-outline',
  error: 'alert-circle-outline',
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
  const supportingMessage = state === 'version-mismatch'
    ? 'Pairing and saved chats are unchanged.'
    : undefined;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <Surface
        elevation={0}
        style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View
          accessibilityLiveRegion={state === 'loading' ? 'polite' : 'assertive'}
          accessibilityRole="summary"
          accessibilityLabel={`${title ?? copy.title}. ${message ?? copy.message}${supportingMessage ? ` ${supportingMessage}` : ''}`}
          style={styles.statusCopy}>
          {state === 'loading' ? (
            <ActivityIndicator
              accessibilityLabel="Loading"
              color={palette.tint}
            />
          ) : (
            <MaterialCommunityIcons
              accessible={false}
              color={palette.muted}
              name={STATE_ICONS[state]}
              size={28}
            />
          )}
          <Text
            accessibilityRole="header"
            style={[styles.centeredText, { color: palette.text }]}
            variant="headlineSmall">
            {title ?? copy.title}
          </Text>
          <Text style={[styles.centeredText, { color: palette.muted }]} variant="bodyLarge">
            {message ?? copy.message}
          </Text>
          {supportingMessage ? (
            <Text style={[styles.centeredText, { color: palette.muted }]} variant="bodyMedium">
              {supportingMessage}
            </Text>
          ) : null}
        </View>
        {children}
        {actionLabel && onAction ? (
          <Button
            accessibilityLabel={actionLabel}
            mode="contained"
            onPress={onAction}
            style={styles.action}>
            {actionLabel}
          </Button>
        ) : null}
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.x6,
  },
  panel: {
    alignItems: 'center',
    borderRadius: Radii.grouped,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.x3,
    maxWidth: 480,
    padding: Spacing.x6,
    width: '100%',
  },
  action: { minHeight: 44 },
  centeredText: { textAlign: 'center' },
  statusCopy: { alignItems: 'center', gap: Spacing.x3 },
});
