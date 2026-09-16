import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import {
  isAccountBootstrapFailure,
  type AccountBootstrapState,
} from '@/lib/pairing/mobile-environment-contract';
import {
  type PairedHost,
  type PairedHostState,
} from '@/lib/pairing/paired-host-store';

type Palette = typeof Colors.light;

const stateLabels: Record<PairedHostState, string> = {
  unpaired: 'Not paired',
  pairing: 'Pairing…',
  connected: 'Connected',
  offline: 'iPhone offline',
  tailscaleUnavailable: 'Cloud gateway unavailable',
  accountMismatch: 'Different Rhythm account',
  revoked: 'Access revoked',
  incompatible: 'Update required',
  unhealthy: 'Mac unhealthy',
};

export interface PairedMacSectionProps {
  state: PairedHostState;
  bootstrapState: AccountBootstrapState;
  host: PairedHost | null;
  message: string;
  onPair: () => void;
  onRefresh: () => void;
  onRetryBootstrap: () => void;
  onRevoke: () => void;
  onForget: () => void;
  palette: Palette;
}

export function PairedMacSection({
  state,
  bootstrapState,
  host,
  message,
  onPair,
  onRefresh,
  onRetryBootstrap,
  onRevoke,
  onForget,
  palette,
}: PairedMacSectionProps) {
  const busy = state === 'pairing';
  const reachable = state === 'connected';
  const bootstrapFailed = isAccountBootstrapFailure(bootstrapState);
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
            Mac connection
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
            {host.relayUrl ? 'Rhythm Cloud Gateway' : 'Secure Mac connection'}
          </Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {host.features.length} secure mobile capabilities available
          </Text>
        </>
      ) : null}
      <View style={styles.actions}>
        {bootstrapFailed ? (
          <Button
            maxFontSizeMultiplier={1.8}
            mode="contained"
            icon="refresh"
            accessibilityLabel="Retry connection"
            onPress={onRetryBootstrap}>
            Retry connection
          </Button>
        ) : null}
        <Button
          maxFontSizeMultiplier={1.8}
          mode={host || bootstrapFailed ? 'outlined' : 'contained'}
          icon="qrcode-scan"
          disabled={busy || Boolean(host && !reachable)}
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
            disabled={!reachable}
            accessibilityLabel="Revoke this iPhone from the paired Mac"
            onPress={onRevoke}>
            Revoke iPhone access
          </Button>
        ) : null}
        {host ? (
          <Button
            maxFontSizeMultiplier={1.8}
            accessibilityLabel="Forget the paired Mac on this iPhone"
            onPress={onForget}>
            Forget Mac
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
