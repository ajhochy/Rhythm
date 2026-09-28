import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Appbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { PairingScanner } from '@/components/settings/pairing-scanner';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PairedHostError } from '@/lib/pairing/paired-host-store';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';
import { mobileRuntimeVariant } from '@rhythm/mobile-runtime';

export default function PairScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();
  const { height: windowHeight } = useWindowDimensions();
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
  const e2ePayload = mobileRuntimeVariant.simulatedPairingPayload(
    Boolean(pairedHost.host),
  );
  const cameraHeight = Math.max(200, Math.min(300, windowHeight * 0.38));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header style={{ backgroundColor: palette.surface }}>
        <Appbar.BackAction
          accessibilityLabel="Close pairing"
          onPress={() => router.back()}
        />
        <Appbar.Content
          title="Pair a Mac"
        />
      </Appbar.Header>
      <PairingScanner
        cameraHeight={cameraHeight}
        cameraPermission={permission == null
          ? 'loading'
          : permission.granted
            ? 'granted'
            : permission.status === 'undetermined'
              ? 'undetermined'
              : permission.canAskAgain
                ? 'denied'
                : 'blocked'}
        error={error}
        manualPayload={manualPayload}
        onManualPair={() => void pair(manualPayload)}
        onManualPayloadChange={setManualPayload}
        onOpenSettings={() => router.replace('/(tabs)/settings')}
        onOpenSystemSettings={() => void Linking.openSettings().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open iOS Settings.'))}
        onRequestCamera={() => void requestPermission()}
        pairing={pairedHost.state === 'pairing'}
        scanner={permission?.granted ? (
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : ({ data }) => { void pair(data); }}
            style={StyleSheet.absoluteFill}
          />
        ) : undefined}
        signedIn={signedIn}
        simulatedScan={e2ePayload ? {
          disabled: !signedIn || pairedHost.state === 'pairing',
          onPress: () => void pair(e2ePayload),
          testID: mobileRuntimeVariant.simulatedPairingTestId ?? undefined,
        } : undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
