import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getPaperTheme } from '@/constants/paper-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { OpencodeProvider } from '@/providers/opencode-provider';
import { PairedHostProvider } from '@/providers/paired-host-provider';
import { RhythmAccountProvider } from '@/providers/rhythm-account-provider';
import { AgentChatProvider } from '@/providers/agent-chat-provider';
import { AppActivityProvider } from '@/providers/activity-provider';
import { AppRhythmToolsProvider } from '@/providers/rhythm-tools-provider';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const paperTheme = getPaperTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const isE2EMode = Boolean(Constants.expoConfig?.extra?.e2eMode);

  useEffect(() => {
    if (Platform.OS === 'web' || isE2EMode) {
      return;
    }

    void import('@/lib/notifications')
      .then(({ initializeNotifications }) => initializeNotifications())
      .catch(() => undefined);

    void import('@/lib/voice/speech-output')
      .then(({ initializeVoiceAudioAsync }) => initializeVoiceAudioAsync())
      .catch(() => undefined);
  }, [isE2EMode]);

  return (
    <SafeAreaProvider>
      <RhythmAccountProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <AppRhythmToolsProvider>
              <AppActivityProvider>
                <AgentChatProvider>
                  <PaperProvider theme={paperTheme}>
                    <ThemeProvider
                      value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                      <Stack>
                        <Stack.Screen
                          name="(tabs)"
                          options={{ headerShown: false }}
                        />
                        <Stack.Screen
                          name="pair"
                          options={{ headerShown: false }}
                        />
                      </Stack>
                      <StatusBar style="auto" />
                    </ThemeProvider>
                  </PaperProvider>
                </AgentChatProvider>
              </AppActivityProvider>
            </AppRhythmToolsProvider>
          </OpencodeProvider>
        </PairedHostProvider>
      </RhythmAccountProvider>
    </SafeAreaProvider>
  );
}
