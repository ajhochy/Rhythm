import { StyleSheet, View } from 'react-native';
import { Button, Divider, Surface, Text } from 'react-native-paper';

import { Colors, MinimumTouchTarget, Radii, Spacing } from '@/constants/theme';
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
      elevation={0}
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}>
      <View
        accessibilityRole="summary"
        accessibilityLabel={`Paired Mac status: ${stateLabels[state]}`}
        style={styles.statusCopy}>
        <View style={styles.heading}>
          <View style={styles.titleBlock}>
            <Text
              variant="titleMedium"
              style={{ color: palette.text }}>
              Mac connection
            </Text>
            <Text
              accessibilityLiveRegion="polite"
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
      </View>
      {host ? (
        <View style={[styles.details, { backgroundColor: palette.background }]}>
          <View style={styles.detailRow}>
            <Text variant="labelMedium" style={[styles.detailLabel, { color: palette.muted }]}>Connection</Text>
            <Text variant="bodyMedium" style={[styles.detailValue, { color: palette.text }]}>
              {host.relayUrl ? 'Rhythm Cloud Gateway' : 'Secure Mac connection'}
            </Text>
          </View>
          {host.relayUrl ? (
            <>
              <Divider style={{ backgroundColor: palette.border }} />
              <View style={styles.detailRow}>
                <Text variant="labelMedium" style={[styles.detailLabel, { color: palette.muted }]}>Address</Text>
                <Text selectable variant="bodySmall" style={[styles.detailValue, { color: palette.text }]}>
                  {host.relayUrl}
                </Text>
              </View>
            </>
          ) : null}
          <Divider style={{ backgroundColor: palette.border }} />
          <View style={styles.detailRow}>
            <Text variant="labelMedium" style={[styles.detailLabel, { color: palette.muted }]}>Versions</Text>
            <Text selectable variant="bodySmall" style={[styles.detailValue, { color: palette.text }]}>
              Rhythm {host.rhythmVersion} · Gateway {host.gatewayVersion} · OpenCode {host.opencodeVersion}
            </Text>
          </View>
          <Divider style={{ backgroundColor: palette.border }} />
          <View style={styles.detailRow}>
            <Text variant="labelMedium" style={[styles.detailLabel, { color: palette.muted }]}>Capabilities</Text>
            <Text variant="bodySmall" style={[styles.detailValue, { color: palette.text }]}>
              {host.features.length} secure mobile capabilities available
            </Text>
          </View>
        </View>
      ) : null}
      <View style={styles.actions}>
        {bootstrapFailed ? (
          <Button
            mode="contained"
            icon="refresh"
            accessibilityLabel="Retry connection"
            onPress={onRetryBootstrap}
            style={styles.actionButton}>
            Retry connection
          </Button>
        ) : null}
        <Button
          mode={host || bootstrapFailed ? 'outlined' : 'contained'}
          icon="qrcode-scan"
          disabled={busy || Boolean(host && !reachable)}
          accessibilityLabel={host ? 'Pair a different Mac' : 'Pair a Mac'}
          onPress={onPair}
          style={styles.actionButton}>
          {host ? 'Pair different Mac' : 'Pair a Mac'}
        </Button>
        {host ? (
          <Button
            mode={!reachable && !bootstrapFailed ? 'contained' : 'text'}
            icon="refresh"
            disabled={busy}
            accessibilityLabel="Refresh paired Mac status"
            onPress={onRefresh}
            style={styles.actionButton}>
            Refresh
          </Button>
        ) : null}
        {host && state !== 'revoked' ? (
          <Button
            textColor={palette.danger}
            disabled={!reachable}
            accessibilityLabel="Revoke this iPhone from the paired Mac"
            onPress={onRevoke}
            style={styles.actionButton}>
            Revoke iPhone access
          </Button>
        ) : null}
        {host ? (
          <Button
            accessibilityLabel="Forget the paired Mac on this iPhone"
            onPress={onForget}
            style={styles.actionButton}>
            Forget Mac
          </Button>
        ) : null}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  actionButton: { minHeight: MinimumTouchTarget },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.x2,
    minHeight: MinimumTouchTarget,
  },
  card: {
    borderRadius: Radii.grouped,
    borderWidth: 1,
    gap: Spacing.x3,
    padding: Spacing.x4,
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
  statusCopy: { gap: Spacing.x3 },
  details: {
    borderRadius: Radii.control,
    overflow: 'hidden',
  },
  detailRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.x2,
    minHeight: MinimumTouchTarget,
    paddingHorizontal: Spacing.x3,
    paddingVertical: Spacing.x2,
  },
  detailLabel: { flexBasis: 84 },
  detailValue: { flex: 1, flexBasis: 180, flexShrink: 1 },
});
