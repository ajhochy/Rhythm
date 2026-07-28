import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import type {
  PairedHost,
  PairedHostState,
} from '@/lib/pairing/paired-host-store';

type Palette = typeof Colors.light;

const stateLabels: Record<PairedHostState, string> = {
  unpaired: 'Not paired',
  pairing: 'Pairing…',
  connected: 'Connected',
  offline: 'iPhone offline',
  tailscaleUnavailable: 'Tailscale unavailable',
  accountMismatch: 'Different Rhythm account',
  revoked: 'Access revoked',
  incompatible: 'Update required',
  unhealthy: 'Mac unhealthy',
};

export interface PairedMacSectionProps {
  state: PairedHostState;
  host: PairedHost | null;
  message: string;
  onPair: () => void;
  onRefresh: () => void;
  onRevoke: () => void;
  onForget: () => void;
  palette: Palette;
}

export function PairedMacSection({
  state,
  host,
  message,
  onPair,
  onRefresh,
  onRevoke,
  onForget,
  palette,
}: PairedMacSectionProps) {
  const busy = state === 'pairing';
  return (
    <Surface
      accessibilityRole="summary"
      accessibilityLabel={`Paired Mac status: ${stateLabels[state]}`}
      elevation={0}
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}>
      <View style={styles.heading}>
        <View style={styles.titleBlock}>
          <Text
            maxFontSizeMultiplier={1.6}
            variant="titleMedium"
            style={{ color: palette.text }}>
            Paired Mac
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={1.6}
            variant="labelMedium"
            style={{
              color: state === 'connected' ? palette.success : palette.muted,
            }}>
            {stateLabels[state]}
          </Text>
        </View>
      </View>
      <Text variant="bodyMedium" style={{ color: palette.muted }}>
        {message}
      </Text>
      {host ? (
        <>
          <Text
            selectable
            maxFontSizeMultiplier={1.6}
            numberOfLines={1}
            variant="bodySmall"
            style={{ color: palette.text }}>
            {host.gatewayUrl.replace('https://', '')}
          </Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {host.features.length} secure mobile capabilities available
          </Text>
        </>
      ) : null}
      <View style={styles.actions}>
        <Button
          maxFontSizeMultiplier={1.8}
          mode={host ? 'outlined' : 'contained'}
          icon="qrcode-scan"
          disabled={busy}
          accessibilityLabel={host ? 'Pair a different Mac' : 'Pair a Mac'}
          onPress={onPair}>
          {host ? 'Pair different Mac' : 'Pair a Mac'}
        </Button>
        {host ? (
          <Button
            maxFontSizeMultiplier={1.8}
            icon="refresh"
            disabled={busy}
            accessibilityLabel="Refresh paired Mac status"
            onPress={onRefresh}>
            Refresh
          </Button>
        ) : null}
        {host && state !== 'revoked' ? (
          <Button
            maxFontSizeMultiplier={1.8}
            textColor={palette.danger}
            accessibilityLabel="Revoke this iPhone from the paired Mac"
            onPress={onRevoke}>
            Revoke
          </Button>
        ) : null}
        {host ? (
          <Button
            maxFontSizeMultiplier={1.8}
            accessibilityLabel="Forget the paired Mac on this iPhone"
            onPress={onForget}>
            Forget
          </Button>
        ) : null}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
});
