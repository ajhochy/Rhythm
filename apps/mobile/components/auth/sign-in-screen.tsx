import { Image, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
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
      <View style={styles.content}>
        <Image
          accessibilityLabel="Rhythm"
          resizeMode="contain"
          source={require('@/assets/images/icon.png')}
          style={styles.mark}
        />
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>Rhythm</Text>
          <Text style={{ color: palette.muted }} variant="bodyLarge">
            Your chats, tools, and paired Mac—ready wherever you are.
          </Text>
        </View>

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
            {signingIn ? (
              <Button accessibilityLabel="Cancel sign in" mode="text" onPress={onCancel}>Cancel</Button>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
  content: { alignSelf: 'center', gap: 24, maxWidth: 480, padding: 24, width: '100%' },
  mark: { alignSelf: 'center', height: 88, width: 88 },
  copy: { alignItems: 'center', gap: 8 },
  title: { fontFamily: Fonts.display, fontSize: 34, fontWeight: '700', lineHeight: 41 },
  status: { alignItems: 'center', gap: 12, minHeight: 56 },
  actions: { gap: 12 },
  button: { justifyContent: 'center', minHeight: 52 },
  error: { borderRadius: 16, gap: 4, padding: 16 },
  pressed: { opacity: 0.82 },
});
