import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type SignInScreenProps = {
  errorMessage?: string;
  onCancel: () => void;
  onRetry: () => void;
  onSignIn: () => void;
  state: 'restoring' | 'signedOut' | 'signingIn' | 'error';
};

export function SignInScreen({
  errorMessage,
  onCancel,
  onRetry,
  onSignIn,
  state,
}: SignInScreenProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const restoring = state === 'restoring';
  const signingIn = state === 'signingIn';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View
            accessible={false}
            accessibilityLabel="Rhythm"
            style={styles.markWrapper}>
            <Surface
              accessible={false}
              elevation={2}
              style={[styles.mark, { backgroundColor: palette.surfaceAlt }]}>
              <MaterialCommunityIcons
                accessible={false}
                color={palette.tint}
                name="source-branch"
                size={42}
              />
            </Surface>
          </View>
          <View style={styles.copy}>
            <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>Welcome to Rhythm Agents</Text>
            <Text style={{ color: palette.muted }} variant="bodyLarge">
              Continue with your Rhythm account to connect to your Mac and chats.
            </Text>
          </View>

          <Surface elevation={0} style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {restoring ? (
            <View accessibilityLiveRegion="polite" style={styles.status}>
              <ActivityIndicator accessibilityLabel="Restoring session" color={palette.tint} />
              <Text style={{ color: palette.text }} variant="bodyLarge">Restoring your session…</Text>
            </View>
          ) : (
            <View style={styles.actions}>
              {state === 'error' ? (
                <View accessibilityRole="alert" style={[styles.error, { backgroundColor: palette.surfaceAlt }]} testID="sign-in-error">
                  <Text style={{ color: palette.danger }} variant="titleSmall">Sign in didn’t finish</Text>
                  <Text style={{ color: palette.text }} variant="bodyMedium">{errorMessage || 'Check your connection and try again.'}</Text>
                </View>
              ) : null}
              <Pressable
                accessibilityLabel={state === 'error' ? 'Retry sign in with Google' : 'Continue with Google'}
                accessibilityRole="button"
                accessibilityState={{ busy: signingIn, disabled: signingIn }}
                disabled={signingIn}
                onPress={state === 'error' ? onRetry : onSignIn}
                style={({ pressed }) => pressed && styles.pressed}>
                <Button
                  accessible={false}
                  disabled={signingIn}
                  icon="google"
                  loading={signingIn}
                  mode="contained"
                  pointerEvents="none"
                  style={styles.button}>
                  {state === 'error' ? 'Try again' : 'Continue with Google'}
                </Button>
              </Pressable>
              <Text style={[styles.trustNote, { color: palette.muted }]} variant="bodyMedium">
                Your account controls trusted device access.
              </Text>
              {signingIn ? (
                <Button accessibilityLabel="Cancel sign in" mode="text" onPress={onCancel}>Cancel</Button>
              ) : null}
            </View>
            )}
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  content: { alignSelf: 'center', gap: Spacing.x6, maxWidth: 480, padding: Spacing.x6, width: '100%' },
  markWrapper: { alignSelf: 'center' },
  mark: { alignItems: 'center', borderRadius: Radii.grouped, height: 88, justifyContent: 'center', width: 88 },
  copy: { alignItems: 'center', gap: Spacing.x2 },
  title: { fontFamily: Fonts.display, fontSize: 34, fontWeight: '700', lineHeight: 41 },
  card: { borderRadius: Radii.sheet, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.x4 },
  status: { alignItems: 'center', gap: Spacing.x3, minHeight: 56, justifyContent: 'center' },
  actions: { gap: Spacing.x3 },
  button: { justifyContent: 'center', minHeight: 52 },
  error: { borderRadius: Radii.control, gap: Spacing.x1, padding: Spacing.x4 },
  pressed: { opacity: 0.82 },
  trustNote: { textAlign: 'center' },
});
