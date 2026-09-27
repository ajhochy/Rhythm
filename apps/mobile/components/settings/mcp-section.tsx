import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Button, Card, Chip, Divider, HelperText, List, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import { Colors, MinimumTouchTarget, Radii, Spacing } from '@/constants/theme';
import type { Config, McpLocalConfig, McpRemoteConfig, McpStatus } from '@/lib/opencode/types';

type Palette = typeof Colors.light;
type McpConfig = NonNullable<Config['mcp']>[string];

export function McpSection({
  configs,
  mcpStatuses,
  onAdd,
  onCompleteOAuth,
  onConnect,
  onDisconnect,
  onRefresh,
  onSetEnabled,
  onStartOAuth,
  palette,
}: {
  configs?: Config['mcp'];
  mcpStatuses: Record<string, McpStatus>;
  onAdd: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
  onCompleteOAuth: (name: string, code: string) => Promise<void>;
  onConnect: (name: string) => Promise<void>;
  onDisconnect: (name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSetEnabled: (name: string, enabled: boolean) => Promise<void>;
  onStartOAuth: (name: string) => Promise<boolean>;
  palette: Palette;
}) {
  const [addType, setAddType] = useState<'local' | 'remote'>('local');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [oauthName, setOauthName] = useState<string>();
  const [oauthCode, setOauthCode] = useState('');
  const names = Array.from(new Set([...Object.keys(configs || {}), ...Object.keys(mcpStatuses)])).sort();

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(undefined);
    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not update MCP servers.');
    } finally {
      setBusy(undefined);
    }
  }

  function describeConfig(config?: McpConfig) {
    if (!config || !('type' in config)) return 'Configuration details unavailable';
    return config.type === 'local' ? config.command.join(' ') : config.url;
  }

  const trimmedName = name.trim();
  const trimmedTarget = target.trim();

  function localCommand() {
    const command: unknown = JSON.parse(trimmedTarget);
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string' || !part)) {
      throw new Error('Enter the local command as a JSON string array.');
    }
    return command as string[];
  }

  return (
    <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
      <Card.Content style={styles.section}>
        <View style={styles.header}>
          <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Advanced · MCP servers</Text>
          <Button compact loading={busy === 'refresh'} onPress={() => void run('refresh', onRefresh)}>Refresh</Button>
        </View>
        <View style={[styles.addGroup, { backgroundColor: palette.background }]}>
          <SegmentedButtons
            value={addType}
            onValueChange={(value) => { setAddType(value as 'local' | 'remote'); setTarget(''); }}
            buttons={[{ value: 'local', label: 'Local' }, { value: 'remote', label: 'Remote' }]}
          />
          <TextInput testID="settings-mcp-name" mode="flat" label="Server name" value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} />
          <TextInput
            testID="settings-mcp-target"
            mode="flat"
            label={addType === 'local' ? 'Command arguments (JSON)' : 'URL'}
            placeholder={addType === 'local' ? '["npx","@modelcontextprotocol/server"]' : 'https://example.com/mcp'}
            value={target}
            onChangeText={setTarget}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            testID="settings-mcp-add"
            mode="contained"
            disabled={!trimmedName || !trimmedTarget || Boolean(busy)}
            loading={busy === 'add'}
            onPress={() => void run('add', async () => {
              await onAdd(trimmedName, addType === 'local'
                ? { type: 'local', command: localCommand() }
                : { type: 'remote', url: trimmedTarget });
              setName('');
              setTarget('');
            })}>
            Add {addType} server
          </Button>
        </View>

        {names.length === 0 ? <HelperText type="info">No MCP servers configured.</HelperText> : null}
        {names.map((serverName) => {
          const config = configs?.[serverName];
          const status = mcpStatuses[serverName];
          const enabled = config?.enabled !== false;
          const isRemote = config && 'type' in config && config.type === 'remote';
          const actionKey = `action:${serverName}`;

          return (
            <View key={serverName} style={[styles.server, { backgroundColor: palette.background, borderColor: palette.border }]}>
              <List.Item
                title={serverName}
                description={describeConfig(config)}
                titleNumberOfLines={0}
                descriptionNumberOfLines={0}
                titleStyle={{ color: palette.text }}
                descriptionStyle={{ color: palette.muted }}
                right={() => <Chip compact>{status?.status || (enabled ? 'configured' : 'disabled')}</Chip>}
              />
              <Divider style={{ backgroundColor: palette.border }} />
              <View style={styles.metadata}>
                <View style={styles.metadataRow}>
                  <Text variant="labelMedium" style={[styles.metadataLabel, { color: palette.muted }]}>Reachability</Text>
                  <Text variant="bodyMedium" style={[styles.metadataValue, { color: palette.text }]}>{status?.status === 'connected' ? 'Reachable' : status?.status === 'failed' ? 'Failed' : 'Not connected'}</Text>
                </View>
                <View style={styles.metadataRow}>
                  <Text variant="labelMedium" style={[styles.metadataLabel, { color: palette.muted }]}>Authentication</Text>
                  <Text variant="bodyMedium" style={[styles.metadataValue, { color: palette.text }]}>{status?.status === 'needs_auth' ? 'Required' : status?.status === 'needs_client_registration' ? 'Client registration required' : status?.status === 'connected' ? 'Ready' : 'Not requested'}</Text>
                </View>
                <View style={styles.metadataRow}>
                  <Text variant="labelMedium" style={[styles.metadataLabel, { color: palette.muted }]}>Enablement</Text>
                  <Text variant="bodyMedium" style={[styles.metadataValue, { color: palette.text }]}>{enabled ? 'Enabled' : 'Disabled'}</Text>
                </View>
                <View style={styles.metadataRow}>
                  <Text variant="labelMedium" style={[styles.metadataLabel, { color: palette.muted }]}>Configuration</Text>
                  <Text variant="bodyMedium" style={[styles.metadataValue, { color: palette.text }]}>{config && 'type' in config ? (config.type === 'local' ? 'Local command' : 'Remote server') : 'Unavailable'}</Text>
                </View>
              </View>
              {status?.status === 'failed' || status?.status === 'needs_client_registration' ? (
                <HelperText type="error">{status.error}</HelperText>
              ) : null}
              <View style={styles.actions}>
                {config ? (
                  <View style={styles.enabledControl}>
                    <Text variant="labelMedium">Enabled</Text>
                    <Switch
                      accessibilityLabel={`${serverName} enabled`}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: enabled, disabled: Boolean(busy) }}
                      value={enabled}
                      disabled={Boolean(busy)}
                      onValueChange={(value) => void run(actionKey, () => onSetEnabled(serverName, value))}
                    />
                  </View>
                ) : null}
                <Button
                  compact
                  disabled={!enabled || Boolean(busy)}
                  loading={busy === actionKey}
                  onPress={() => void run(actionKey, () => status?.status === 'connected' ? onDisconnect(serverName) : onConnect(serverName))}>
                  {status?.status === 'connected' ? 'Disconnect' : 'Connect'}
                </Button>
                {isRemote && status?.status === 'needs_auth' ? (
                  <Button compact disabled={Boolean(busy)} onPress={() => void run(actionKey, async () => {
                    if (await onStartOAuth(serverName)) setOauthName(serverName);
                  })}>OAuth</Button>
                ) : null}
              </View>
              {oauthName === serverName ? (
                <View style={styles.oauth}>
                  <TextInput mode="outlined" label="Authorization code (optional)" value={oauthCode} onChangeText={setOauthCode} autoCapitalize="none" />
                  <Button
                    compact
                    disabled={!oauthCode.trim() || Boolean(busy)}
                    onPress={() => void run(actionKey, async () => {
                      await onCompleteOAuth(serverName, oauthCode);
                      setOauthCode('');
                      setOauthName(undefined);
                    })}>
                    Complete OAuth
                  </Button>
                </View>
              ) : null}
            </View>
          );
        })}
        {error ? <HelperText type="error">{error}</HelperText> : null}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radii.grouped },
  section: { gap: Spacing.x3 },
  title: { fontWeight: '600' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.x3 },
  addGroup: { borderRadius: Radii.control, gap: Spacing.x2, overflow: 'hidden', padding: Spacing.x2 },
  server: { borderRadius: Radii.control, borderWidth: 1, overflow: 'hidden', paddingBottom: Spacing.x2 },
  metadata: { gap: Spacing.x2, padding: Spacing.x3 },
  metadataRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.x2 },
  metadataLabel: { flexBasis: 100 },
  metadataValue: { flex: 1, flexBasis: 160, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.x1, minHeight: MinimumTouchTarget, paddingHorizontal: Spacing.x2 },
  enabledControl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.x1, minHeight: MinimumTouchTarget },
  oauth: { gap: Spacing.x2, padding: Spacing.x2 },
});
