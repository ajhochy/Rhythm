/**
 * RhythmAccountSection
 *
 * Settings section displaying Rhythm Cloud account state.
 * Shows the current sign-in status and provides sign-in / sign-out actions.
 *
 * Placement (per AGENTS.md):
 *   - Presentation only — no API calls, no persistence, no shared domain state.
 *   - Receives all data and callbacks via props from the screen.
 *   - All domain logic lives in RhythmAccountProvider / RhythmSessionStore.
 *
 * Does NOT duplicate profile or tool configuration — those belong in separate sections.
 */

import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, List, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import type { RhythmAccountError, RhythmAccountState, RhythmUser } from '@/lib/auth/rhythm-session-store';

type Palette = typeof Colors.light;

export interface RhythmAccountSectionProps {
  state: RhythmAccountState;
  user: RhythmUser | null;
  error?: RhythmAccountError;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  palette: Palette;
}

function stateChipLabel(state: RhythmAccountState): string {
  switch (state) {
    case 'signedIn':    return 'Connected';
    case 'signingIn':   return 'Signing in…';
    case 'refreshing':  return 'Refreshing…';
    case 'expired':     return 'Session expired';
    case 'offline':     return 'Offline';
    case 'error':       return 'Action needed';
    case 'signedOut':
    default:            return 'Not connected';
  }
}

function stateDescription(state: RhythmAccountState, user: RhythmUser | null): string {
  switch (state) {
    case 'signedIn':
      return user ? `Signed in as ${user.email}` : 'Signed in';
    case 'signingIn':
      return 'Completing sign-in…';
    case 'refreshing':
      return 'Refreshing session…';
    case 'expired':
      return 'Your session has expired. Sign in again to continue.';
    case 'offline':
      return user ? `Offline — last signed in as ${user.email}` : 'Offline — no cached account';
    case 'error':
      return 'Rhythm account needs attention.';
    case 'signedOut':
    default:
      return 'Sign in with your Rhythm account to access Rhythm Cloud features.';
  }
}

export function RhythmAccountSection({
  state,
  user,
  error,
  onSignIn,
  onSignOut,
  onRefresh,
  palette,
}: RhythmAccountSectionProps) {
  const isBusy = state === 'signingIn' || state === 'refreshing';

  return (
    <Card
      mode="contained"
      style={[styles.card, { backgroundColor: palette.surface }]}
      accessibilityLabel="Rhythm account"
    >
      <Card.Content style={styles.content}>
        <View style={styles.row}>
          <Text
            variant="titleMedium"
            style={[styles.title, { color: palette.text }]}
          >
            Rhythm Account
          </Text>
          <Chip
            compact
            accessibilityLabel={`Account status: ${stateChipLabel(state)}`}
          >
            {stateChipLabel(state)}
          </Chip>
        </View>

        <List.Item
          title={user?.name ?? (state === 'signedOut' || state === 'expired' ? 'Not signed in' : '—')}
          description={stateDescription(state, user)}
          titleStyle={{ color: palette.text }}
          descriptionStyle={{ color: palette.muted }}
          descriptionNumberOfLines={3}
        />

        {error ? (
          <Text
            variant="bodySmall"
            style={{ color: palette.danger }}
            accessibilityLiveRegion="polite"
          >
            {error.message}
          </Text>
        ) : null}

        <View style={styles.actions}>
          {(state === 'signedOut' || state === 'expired') && (
            <Button
              mode="contained"
              onPress={onSignIn}
              disabled={isBusy}
              accessibilityLabel="Sign in to Rhythm"
            >
              Sign in with Google
            </Button>
          )}

          {state === 'signedIn' && (
            <>
              <Button
                mode="outlined"
                onPress={onRefresh}
                disabled={isBusy}
                accessibilityLabel="Refresh Rhythm session"
              >
                Refresh session
              </Button>
              <Button
                mode="text"
                onPress={onSignOut}
                disabled={isBusy}
                textColor={palette.danger}
                accessibilityLabel="Sign out of Rhythm"
              >
                Sign out
              </Button>
            </>
          )}

          {state === 'offline' && (
            <Button
              mode="outlined"
              onPress={onRefresh}
              disabled={isBusy}
              accessibilityLabel="Retry Rhythm connection"
            >
              Retry connection
            </Button>
          )}

          {state === 'error' && (
            <Button
              mode="outlined"
              onPress={user ? onRefresh : onSignIn}
              accessibilityLabel="Retry Rhythm account"
            >
              Retry
            </Button>
          )}

          {isBusy && (
            <Text
              variant="bodySmall"
              style={{ color: palette.muted }}
              accessibilityLiveRegion="polite"
            >
              {state === 'signingIn' ? 'Signing in…' : 'Refreshing…'}
            </Text>
          )}
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 4 },
  content: { gap: 4, paddingBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  title: { fontWeight: '600', flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
});
