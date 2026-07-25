import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  HelperText,
  Text,
  TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PairedHostError } from '@/lib/pairing/paired-host-store';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';

export default function PairScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();
  const params = useLocalSearchParams<{ payload?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualPayload, setManualPayload] = useState('');
  const [error, setError] = useState<string>();
  const [scanned, setScanned] = useState(false);
  const attemptedParam = useRef(false);

  const pair = useCallback(async (payload: string, replaceExisting = false) => {
    if (!payload.trim() || pairedHost.state === 'pairing') return;
    setScanned(true);
    setError(undefined);
    try {
      await pairedHost.pair(payload, { replaceExisting });
      setManualPayload('');
      router.replace('/(tabs)/settings');
    } catch (cause) {
      if (
        cause instanceof PairedHostError &&
        cause.kind === 'replacementRequired'
      ) {
        const retry = () => void pair(payload, true);
        if (Platform.OS === 'web') {
          if (globalThis.confirm(`${cause.message}\n\nThe previous Mac credential will be replaced.`)) {
            retry();
            return;
          }
        } else {
          Alert.alert(
            'Replace paired Mac?',
            `${cause.message}\n\nOnly one Mac can be active on this iPhone.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
              { text: 'Replace', style: 'destructive', onPress: retry },
            ],
          );
          return;
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not pair with this Mac.',
      );
      setScanned(false);
    }
  }, [pairedHost]);

  useEffect(() => {
    if (
      attemptedParam.current ||
      typeof params.payload !== 'string' ||
      !params.payload
    ) {
      return;
    }
    attemptedParam.current = true;
    void pair(params.payload);
  }, [pair, params.payload]);

  const signedIn = account.state === 'signedIn' && Boolean(account.user);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header style={{ backgroundColor: palette.surface }}>
        <Appbar.BackAction
          accessibilityLabel="Close pairing"
          onPress={() => router.back()}
        />
        <Appbar.Content title="Pair a Mac" />
      </Appbar.Header>
      <View style={styles.content}>
        <Text variant="headlineSmall" style={{ color: palette.text }}>
          Scan the code from Rhythm on your Mac
        </Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          Pairing stays inside your private Tailscale network. The one-time
          code is discarded as soon as the Mac exchanges it.
        </Text>
        {!signedIn ? (
          <View
            accessibilityRole="alert"
            style={[styles.notice, { borderColor: palette.border }]}>
            <Text style={{ color: palette.text }}>
              Sign in to the same Rhythm account on this iPhone and Mac before
              pairing.
            </Text>
            <Button onPress={() => router.replace('/(tabs)/settings')}>
              Open Settings
            </Button>
          </View>
        ) : permission?.granted ? (
          <View
            accessible
            accessibilityLabel="QR code scanner"
            style={[styles.cameraFrame, { borderColor: palette.border }]}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={
                scanned
                  ? undefined
                  : ({ data }) => {
                      void pair(data);
                    }
              }
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : (
          <View style={[styles.notice, { borderColor: palette.border }]}>
            <Text style={{ color: palette.text }}>
              Camera access is needed only to scan the one-time QR code.
            </Text>
            <Button
              mode="contained"
              accessibilityLabel="Allow camera for QR pairing"
              onPress={() => void requestPermission()}>
              Allow camera
            </Button>
          </View>
        )}
        {Platform.OS === 'web' ? (
          <>
            <TextInput
              accessibilityLabel="Pairing payload"
              autoCapitalize="none"
              autoCorrect={false}
              disabled={!signedIn || pairedHost.state === 'pairing'}
              label="Pairing payload"
              multiline
              onChangeText={setManualPayload}
              value={manualPayload}
            />
            <Button
              mode="contained"
              disabled={!manualPayload.trim() || !signedIn}
              onPress={() => void pair(manualPayload)}>
              Pair securely
            </Button>
          </>
        ) : null}
        {pairedHost.state === 'pairing' ? (
          <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
            Pairing securely…
          </Text>
        ) : null}
        {error ? (
          <HelperText accessibilityLiveRegion="assertive" type="error" visible>
            {error}
          </HelperText>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cameraFrame: {
    borderRadius: 20,
    borderWidth: 2,
    height: 300,
    overflow: 'hidden',
    width: '100%',
  },
  content: {
    alignSelf: 'center',
    flex: 1,
    gap: 16,
    maxWidth: 520,
    padding: 20,
    width: '100%',
  },
  notice: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  screen: {
    flex: 1,
  },
});
