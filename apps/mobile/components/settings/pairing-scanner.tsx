import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import {
  Colors,
  MinimumTouchTarget,
  Radii,
  Spacing,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type CameraPermissionState = 'loading' | 'granted' | 'undetermined' | 'denied' | 'blocked';

export type PairingScannerProps = {
  cameraHeight: number;
  cameraPermission: CameraPermissionState;
  error?: string;
  manualPayload: string;
  onManualPair: () => void;
  onManualPayloadChange: (value: string) => void;
  onOpenSettings: () => void;
  onOpenSystemSettings: () => void;
  onRequestCamera: () => void;
  pairing: boolean;
  scanner?: ReactNode;
  showManualEntry?: boolean;
  signedIn: boolean;
  simulatedScan?: {
    disabled: boolean;
    onPress: () => void;
    testID?: string;
  };
};

export function PairingScanner({
  cameraHeight,
  cameraPermission,
  error,
  manualPayload,
  onManualPair,
  onManualPayloadChange,
  onOpenSettings,
  onOpenSystemSettings,
  onRequestCamera,
  pairing,
  scanner,
  signedIn,
  simulatedScan,
}: PairingScannerProps) {
  const palette = Colors[useColorScheme() ?? 'light'];
  const errorRef = useRef<View>(null);
  const previousError = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (Platform.OS === 'ios' && error && error !== previousError.current) {
      const node = findNodeHandle(errorRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
    previousError.current = error;
  }, [error]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.group, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text accessibilityRole="header" variant="headlineSmall" style={{ color: palette.text }}>
          Scan the code from Rhythm on your Mac
        </Text>
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          Pairing connects this iPhone to your Mac through Rhythm Cloud Gateway.
          The one-time code is discarded as soon as the Mac exchanges it.
        </Text>
      </View>

      {!signedIn ? (
        <View accessibilityRole="alert" style={[styles.group, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={{ color: palette.text }}>
            Sign in to the same Rhythm account on this iPhone and Mac before pairing.
          </Text>
          <Button maxFontSizeMultiplier={1.8} onPress={onOpenSettings} style={styles.action}>
            Open Settings
          </Button>
        </View>
      ) : cameraPermission === 'granted' ? (
        <View
          accessible
          accessibilityLabel="QR code scanner"
          style={[styles.cameraFrame, { borderColor: palette.border, height: cameraHeight }]}
        >
          {scanner}
        </View>
      ) : (
        <View style={[styles.group, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={{ color: palette.text }}>
            {cameraPermission === 'loading'
              ? 'Checking camera access…'
              : 'Camera access is needed only to scan the one-time QR code.'}
          </Text>
          {cameraPermission === 'denied' || cameraPermission === 'blocked' ? (
            <Text style={{ color: palette.muted }}>
              If access remains denied, retry the permission request or enter the pairing code manually.
            </Text>
          ) : null}
          {cameraPermission !== 'loading' ? (
            <Button
              mode="contained"
              maxFontSizeMultiplier={1.8}
              accessibilityLabel={cameraPermission === 'blocked' ? 'Open iOS Settings' : 'Allow camera for QR pairing'}
              onPress={cameraPermission === 'blocked' ? onOpenSystemSettings : onRequestCamera}
              style={styles.action}
            >
              {cameraPermission === 'blocked' ? 'Open iOS Settings' : 'Allow camera'}
            </Button>
          ) : null}
        </View>
      )}

      {simulatedScan ? (
        <Button
          mode="contained"
          maxFontSizeMultiplier={1.8}
          testID={simulatedScan.testID}
          accessibilityLabel="Scan test QR code"
          disabled={simulatedScan.disabled}
          onPress={simulatedScan.onPress}
          style={styles.action}
        >
          Simulate QR scan
        </Button>
      ) : null}

      <View style={[styles.group, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text accessibilityRole="header" variant="titleMedium" style={{ color: palette.text }}>
          Enter a pairing code
        </Text>
        <TextInput
          accessibilityLabel="Pairing payload"
          autoCapitalize="none"
          autoCorrect={false}
          disabled={!signedIn || pairing}
          label="Pairing payload"
          multiline
          onChangeText={onManualPayloadChange}
          value={manualPayload}
        />
        <Button
          mode="contained"
          maxFontSizeMultiplier={1.8}
          disabled={!manualPayload.trim() || !signedIn}
          onPress={onManualPair}
          style={styles.action}
        >
          Pair securely
        </Button>
      </View>

      {pairing ? (
        <Text accessibilityLabel="Pairing status: Pairing securely" accessibilityLiveRegion="polite" accessibilityRole="summary" style={{ color: palette.text }}>
          Pairing securely…
        </Text>
      ) : null}
      {error ? (
        <View ref={errorRef} accessible accessibilityLiveRegion="assertive" accessibilityRole="alert">
          <HelperText accessibilityLiveRegion="assertive" type="error" visible>
            {error}
          </HelperText>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: MinimumTouchTarget },
  cameraFrame: { borderRadius: Radii.grouped, borderWidth: 2, minHeight: 200, overflow: 'hidden', width: '100%' },
  content: { alignSelf: 'center', flexGrow: 1, gap: Spacing.x4, maxWidth: 520, padding: Spacing.x4, width: '100%' },
  group: { borderRadius: Radii.grouped, borderWidth: StyleSheet.hairlineWidth, gap: Spacing.x3, padding: Spacing.x4 },
});
