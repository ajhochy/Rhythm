import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Appbar,
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  Portal,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';

import { ToolScreenState } from '@/components/tools/tool-screen-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useRhythmTools,
  type ToolAction,
} from '@/providers/rhythm-tools-provider';
import {
  TOOL_SCREEN_MANIFEST,
  type ToolRecord,
  type ToolScreenId,
} from '@/providers/services/rhythm-tools-service';

const CREATE_LABEL: Partial<Record<ToolScreenId, string>> = {
  brain: 'New memory',
  research: 'New research',
  schedules: 'New scheduled job',
  webhooks: 'New webhook',
  cookbook: 'New recipe',
  skills: 'New skill',
  playbooks: 'New playbook',
  mcp: 'Add MCP server',
};

function recordTitle(tool: ToolScreenId, item: ToolRecord): string {
  const candidates =
    tool === 'email'
      ? [item.subject, item.fromName, item.fromEmail]
      : [item.title, item.label, item.name, item.query, item.subject, item.agentLabel, item.id];
  return String(candidates.find((value) => typeof value === 'string' && value) ?? item.id);
}

function recordSubtitle(tool: ToolScreenId, item: ToolRecord): string {
  if (tool === 'email') {
    return String(item.snippet ?? item.fromEmail ?? 'Email signal');
  }
  if (tool === 'report-card') {
    const completion = Number(item.completionRate);
    return Number.isFinite(completion)
      ? `Success rate ${Math.round(completion * 100)}%`
      : 'Success rate — not enough data';
  }
  return String(
    item.description ??
      item.status ??
      item.modelId ??
      item.source ??
      item.updatedAt ??
      '',
  );
}

function confirmAction(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function actionInput(tool: ToolScreenId, form: Record<string, string>) {
  switch (tool) {
    case 'brain':
      return { title: form.title, content: form.content, tags: [] };
    case 'research':
      return { query: form.query };
    case 'schedules':
      return {
        name: form.name,
        prompt: form.prompt || `Run scheduled job: ${form.name}`,
        cron: form.cron,
        cronExpression: form.cron,
        enabled: true,
      };
    case 'webhooks':
      return { name: form.name, eventTypes: ['*'], enabled: true };
    case 'cookbook':
      return {
        title: form.title,
        description: form.description,
        prompt: form.prompt || form.description,
      };
    case 'skills':
      return {
        name: form.name,
        description: form.description,
        content:
          `---\nname: ${form.name}\ndescription: ${form.description}\n---\n\n` +
          (form.content || form.description),
      };
    case 'playbooks':
      return {
        name: form.name,
        description: form.description,
        template: form.template,
      };
    case 'mcp':
      return {
        name: form.name,
        config: { type: 'remote', url: form.url, enabled: true },
      };
    default:
      return {};
  }
}

function createAction(tool: ToolScreenId): ToolAction {
  const actions: Partial<Record<ToolScreenId, ToolAction>> = {
    brain: 'brain:create',
    research: 'research:create',
    schedules: 'schedules:create',
    webhooks: 'webhooks:create',
    cookbook: 'cookbook:create',
    skills: 'skills:create',
    playbooks: 'playbooks:create',
    mcp: 'mcp:add',
  };
  return actions[tool]!;
}

export default function RhythmToolScreen() {
  const params = useLocalSearchParams<{ tool?: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const manifest = TOOL_SCREEN_MANIFEST.find(
    (entry) => entry.id === params.tool,
  );
  const tool = manifest?.id;
  const { getState, perform, refresh } = useRhythmTools();
  const state = getState(tool ?? 'brain');
  const [dialog, setDialog] = useState<'create' | 'profile' | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ToolRecord | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (tool) void refresh(tool);
  }, [refresh, tool]);

  const items = useMemo(() => {
    if (tool !== 'brain' || !search.trim()) return state.items;
    const needle = search.trim().toLowerCase();
    return state.items.filter((item) =>
      `${item.title ?? ''} ${item.content ?? ''}`.toLowerCase().includes(needle),
    );
  }, [search, state.items, tool]);

  if (!manifest || !tool) {
    return (
      <ToolScreenState
        actionLabel="Back to Tools"
        onAction={() => router.replace('/(tabs)/tools' as never)}
        state="error"
        title="Tool not found"
      />
    );
  }
  if (state.loading && state.items.length === 0) {
    return <ToolScreenState state="loading" title={`Loading ${manifest.title}`} />;
  }
  if (state.errorState && state.items.length === 0) {
    return (
      <ToolScreenState
        actionLabel={state.errorState === 'error' ? 'Try again' : 'Back to Tools'}
        message={state.error ?? undefined}
        onAction={() =>
          state.errorState === 'error'
            ? void refresh(tool)
            : router.replace('/(tabs)/tools' as never)}
        state={state.errorState}
      />
    );
  }
  if (state.offline && state.items.length === 0) {
    return (
      <ToolScreenState
        actionLabel="Back to Tools"
        onAction={() => router.replace('/(tabs)/tools' as never)}
        state="offline-cache"
        title={`${manifest.title} unavailable offline`}
      />
    );
  }

  const run = async (
    action: ToolAction,
    input: Record<string, unknown>,
    success: string,
  ) => {
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await perform(tool, action, input);
      if (tool === 'webhooks' && result && typeof result === 'object') {
        const secret = (result as { secret?: unknown }).secret;
        if (typeof secret === 'string') setOneTimeSecret(secret);
      }
      setNotice(success);
      return result;
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : 'The action could not be completed.',
      );
      return undefined;
    } finally {
      setSubmitting(false);
    }
  };

  const submitCreate = async () => {
    await run(
      createAction(tool),
      actionInput(tool, form),
      tool === 'research' ? 'Research started.' : `${manifest.title} saved.`,
    );
    setDialog(null);
    setForm({});
  };

  const openProfile = (item: ToolRecord) => {
    const allowed =
      typeof item.allowedMcpsJson === 'string'
        ? item.allowedMcpsJson
        : null;
    setSelected(item);
    setForm({
      prompt: String(item.systemPrompt ?? item.prompt ?? ''),
      scopeMode:
        allowed === null ? 'inherit' : allowed === '[]' ? 'explicit-empty' : 'explicit',
      scope: allowed && allowed !== '[]'
        ? (() => {
            try {
              const parsed = JSON.parse(allowed) as unknown;
              return Array.isArray(parsed) ? parsed.join(', ') : '';
            } catch {
              return '';
            }
          })()
        : '',
    });
    setDialog('profile');
  };

  const saveProfile = async () => {
    if (!selected) return;
    const allowedMcpsJson =
      form.scopeMode === 'inherit'
        ? null
        : form.scopeMode === 'explicit-empty'
          ? '[]'
          : JSON.stringify(
              form.scope
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            );
    await run(
      'profiles:update',
      {
        id: selected.id,
        systemPrompt: form.prompt,
        permissionScope:
          form.scopeMode === 'inherit'
            ? null
            : form.scopeMode === 'explicit-empty'
              ? []
              : JSON.parse(allowedMcpsJson ?? '[]'),
        allowedMcpsJson,
      },
      'Projected to OpenCode',
    );
    setDialog(null);
  };

  const renderActions = (item: ToolRecord) => {
    const title = recordTitle(tool, item);
    switch (tool) {
      case 'brain':
        return (
          <Button
            accessibilityLabel={`Delete ${title}`}
            disabled={state.offline}
            onPress={async () => {
              if (await confirmAction('Delete memory?', `Delete ${title}?`)) {
                await run('brain:delete', { id: item.id }, 'Memory deleted.');
              }
            }}>
            Delete
          </Button>
        );
      case 'research':
        return (
          <View style={styles.actions}>
            {item.status === 'error' ? (
              <Button
                disabled={state.offline}
                onPress={() => void run('research:retry', { id: item.id }, 'Research restarted.')}>
                Retry
              </Button>
            ) : null}
            <Button onPress={() => setSelected(item)}>View report</Button>
            <Button
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Delete research?', `Delete ${title}?`)) {
                  await run('research:delete', { id: item.id }, 'Research deleted.');
                }
              }}>
              Delete
            </Button>
          </View>
        );
      case 'schedules':
        return (
          <Button
            accessibilityLabel={`Run ${title} now`}
            disabled={state.offline}
            onPress={async () => {
              if (await confirmAction('Run scheduled job?', `Run ${title} now?`)) {
                await run('schedules:trigger', { id: item.id }, 'Run queued.');
              }
            }}>
            Run now
          </Button>
        );
      case 'webhooks':
        return (
          <Button
            accessibilityLabel={`Revoke ${title}`}
            disabled={state.offline}
            onPress={async () => {
              if (await confirmAction('Revoke webhook?', `Revoke ${title}?`)) {
                await run('webhooks:revoke', { id: item.id }, 'Webhook revoked.');
              }
            }}>
            Revoke
          </Button>
        );
      case 'cookbook':
        return (
          <Button
            accessibilityLabel={`Run ${title}`}
            disabled={state.offline}
            onPress={async () => {
              if (await confirmAction('Run recipe?', `Run ${title}?`)) {
                await run('cookbook:run', { id: item.id }, 'Recipe queued.');
              }
            }}>
            Run
          </Button>
        );
      case 'skills':
        return item.managed ? (
          <Button
            accessibilityLabel={`Delete ${title}`}
            disabled={state.offline}
            onPress={() => void run('skills:delete', { name: item.name }, 'Skill deleted.')}>
            Delete
          </Button>
        ) : <Chip compact>Read only</Chip>;
      case 'playbooks':
        return item.managed ? (
          <Button
            accessibilityLabel={`Delete ${title}`}
            disabled={state.offline}
            onPress={() => void run('playbooks:delete', { name: item.name }, 'Playbook deleted.')}>
            Delete
          </Button>
        ) : <Chip compact>Read only</Chip>;
      case 'mcp':
        return (
          <View style={styles.actions}>
            <Button
              disabled={state.offline}
              onPress={() =>
                void run(
                  item.status === 'connected' ? 'mcp:disconnect' : 'mcp:connect',
                  { name: item.name },
                  item.status === 'connected' ? 'MCP disconnected.' : 'MCP connected.',
                )}>
              {item.status === 'connected' ? 'Disconnect' : 'Connect'}
            </Button>
            <Button
              disabled={state.offline}
              onPress={() => void run('mcp:oauth', { name: item.name }, 'OAuth started.')}>
              Authenticate
            </Button>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction
          accessibilityLabel="Back to Tools"
          onPress={() => router.replace('/(tabs)/tools' as never)}
        />
        <Appbar.Content title={manifest.title} />
        <Appbar.Action
          accessibilityLabel={`Refresh ${manifest.title}`}
          icon="refresh"
          onPress={() => void refresh(tool)}
        />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.content}>
        {tool === 'skills' ? (
          <Text variant="titleMedium">Approved skills</Text>
        ) : null}
        {state.offline ? (
          <Surface style={styles.notice}>
            <Text>Mac offline — saved data is read-only.</Text>
          </Surface>
        ) : null}
        {notice ? (
          <Surface
            accessibilityLiveRegion="polite"
            style={[styles.notice, { backgroundColor: palette.surfaceAlt }]}>
            <Text>{notice}</Text>
          </Surface>
        ) : null}
        {oneTimeSecret ? (
          <Surface style={styles.secret}>
            <Text variant="titleMedium">Copy this webhook secret now</Text>
            <Text selectable>{oneTimeSecret}</Text>
            <Text>This secret is shown once and is never saved on this device.</Text>
            <Button
              onPress={async () => {
                await Clipboard.setStringAsync(oneTimeSecret);
                setNotice('Webhook secret copied.');
              }}>
              Copy secret
            </Button>
            <Button onPress={() => setOneTimeSecret(null)}>I saved it</Button>
          </Surface>
        ) : null}
        {tool === 'brain' ? (
          <TextInput
            accessibilityLabel="Search Brain"
            label="Search Brain"
            mode="outlined"
            onChangeText={setSearch}
            value={search}
          />
        ) : null}
        {CREATE_LABEL[tool] ? (
          <Button
            accessibilityLabel={CREATE_LABEL[tool]}
            disabled={state.offline}
            icon="plus"
            mode="contained"
            onPress={() => {
              setForm({});
              setDialog('create');
            }}>
            {CREATE_LABEL[tool]}
          </Button>
        ) : null}
        {selected && tool === 'research' ? (
          <Surface style={styles.detail}>
            <Text variant="titleLarge">{recordTitle(tool, selected)}</Text>
            <Text variant="titleMedium">Research report</Text>
            <Text>{String(selected.report ?? 'The report is still being prepared.')}</Text>
            <Button onPress={() => setSelected(null)}>Close report</Button>
          </Surface>
        ) : null}
        {selected && tool === 'review' ? (
          <Surface style={styles.detail}>
            <Text variant="titleLarge">{recordTitle(tool, selected)}</Text>
            <Chip>{String(selected.risk ?? 'unknown')} risk</Chip>
            <Text>{String(selected.rationale ?? 'Review the proposed change before acting.')}</Text>
            <View style={styles.actions}>
              <Button
                accessibilityLabel="Approve proposal"
                mode="contained"
                onPress={async () => {
                  const needsConfirm = selected.risk === 'high';
                  if (
                    needsConfirm &&
                    !(await confirmAction(
                      'Approve high-risk proposal?',
                      'This change is high risk. Approve it only after reviewing the full rationale.',
                    ))
                  ) return;
                  await run('review:approve', { id: selected.id }, 'Proposal approved.');
                  setSelected(null);
                }}>
                Approve
              </Button>
              <Button
                accessibilityLabel="Reject proposal"
                onPress={() =>
                  void run(
                    'review:reject',
                    { id: selected.id, reason: 'Rejected from mobile review.' },
                    'Proposal rejected.',
                  )}>
                Reject
              </Button>
            </View>
          </Surface>
        ) : null}
        {items.length === 0 ? (
          <Text style={{ color: palette.muted }} variant="bodyLarge">
            Nothing here yet.
          </Text>
        ) : (
          items.map((item) => {
            const title = recordTitle(tool, item);
            const subtitle = recordSubtitle(tool, item);
            return (
              <Card
                accessibilityLabel={`${title}. ${subtitle}`}
                accessibilityRole={
                  tool === 'profiles' || tool === 'research' || tool === 'review'
                    ? 'button'
                    : undefined
                }
                key={item.id}
                mode="outlined"
                onPress={
                  tool === 'profiles'
                    ? () => openProfile(item)
                    : tool === 'research' || tool === 'review'
                      ? () => setSelected(item)
                      : undefined
                }
                style={[styles.card, { borderColor: palette.border }]}>
                <Card.Title
                  subtitle={subtitle}
                  subtitleNumberOfLines={3}
                  title={title}
                  titleNumberOfLines={2}
                />
                {tool === 'report-card' ? (
                  <Card.Content>
                    <Text>
                      Success rate{' '}
                      {Number.isFinite(Number(item.completionRate))
                        ? `${Math.round(Number(item.completionRate) * 100)}%`
                        : '—'}
                    </Text>
                    <Text>
                      Escalation rate{' '}
                      {Number.isFinite(Number(item.escalationRate))
                        ? `${Math.round(Number(item.escalationRate) * 100)}%`
                        : '—'}
                    </Text>
                  </Card.Content>
                ) : null}
                {renderActions(item) ? (
                  <>
                    <Divider />
                    <Card.Actions>{renderActions(item)}</Card.Actions>
                  </>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
      <Portal>
        <Dialog
          onDismiss={() => setDialog(null)}
          visible={dialog === 'create'}>
          <Dialog.Title>{CREATE_LABEL[tool]}</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView contentContainerStyle={styles.dialogFields}>
              {tool === 'brain' ? (
                <>
                  <TextInput
                    accessibilityLabel="Memory title"
                    label="Memory title"
                    onChangeText={(title) => setForm((value) => ({ ...value, title }))}
                    value={form.title ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Memory content"
                    label="Memory content"
                    multiline
                    onChangeText={(content) => setForm((value) => ({ ...value, content }))}
                    value={form.content ?? ''}
                  />
                </>
              ) : null}
              {tool === 'research' ? (
                <TextInput
                  accessibilityLabel="Research question"
                  label="Research question"
                  multiline
                  onChangeText={(query) => setForm({ query })}
                  value={form.query ?? ''}
                />
              ) : null}
              {tool === 'schedules' ? (
                <>
                  <TextInput
                    accessibilityLabel="Job name"
                    label="Job name"
                    onChangeText={(name) => setForm((value) => ({ ...value, name }))}
                    value={form.name ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Cron schedule"
                    label="Cron schedule"
                    onChangeText={(cron) => setForm((value) => ({ ...value, cron }))}
                    value={form.cron ?? ''}
                  />
                </>
              ) : null}
              {tool === 'webhooks' ? (
                <TextInput
                  accessibilityLabel="Webhook name"
                  label="Webhook name"
                  onChangeText={(name) => setForm({ name })}
                  value={form.name ?? ''}
                />
              ) : null}
              {tool === 'cookbook' ? (
                <>
                  <TextInput
                    accessibilityLabel="Recipe title"
                    label="Recipe title"
                    onChangeText={(title) => setForm((value) => ({ ...value, title }))}
                    value={form.title ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Recipe instructions"
                    label="Recipe instructions"
                    multiline
                    onChangeText={(description) =>
                      setForm((value) => ({ ...value, description }))}
                    value={form.description ?? ''}
                  />
                </>
              ) : null}
              {tool === 'skills' || tool === 'playbooks' ? (
                <>
                  <TextInput
                    accessibilityLabel={`${tool === 'skills' ? 'Skill' : 'Playbook'} name`}
                    label="Name"
                    onChangeText={(name) => setForm((value) => ({ ...value, name }))}
                    value={form.name ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Description"
                    label="Description"
                    onChangeText={(description) =>
                      setForm((value) => ({ ...value, description }))}
                    value={form.description ?? ''}
                  />
                  <TextInput
                    accessibilityLabel={tool === 'skills' ? 'Skill content' : 'Playbook template'}
                    label={tool === 'skills' ? 'Skill content' : 'Playbook template'}
                    multiline
                    onChangeText={(text) =>
                      setForm((value) => ({
                        ...value,
                        [tool === 'skills' ? 'content' : 'template']: text,
                      }))}
                    value={form[tool === 'skills' ? 'content' : 'template'] ?? ''}
                  />
                </>
              ) : null}
              {tool === 'mcp' ? (
                <>
                  <TextInput
                    accessibilityLabel="MCP server name"
                    label="MCP server name"
                    onChangeText={(name) => setForm((value) => ({ ...value, name }))}
                    value={form.name ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="MCP server URL"
                    autoCapitalize="none"
                    label="MCP server URL"
                    onChangeText={(url) => setForm((value) => ({ ...value, url }))}
                    value={form.url ?? ''}
                  />
                </>
              ) : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>Cancel</Button>
            <Button
              accessibilityLabel={
                tool === 'research'
                  ? 'Start research'
                  : tool === 'schedules'
                    ? 'Save scheduled job'
                    : tool === 'cookbook'
                      ? 'Save recipe'
                      : tool === 'brain'
                        ? 'Save memory'
                        : `Save ${manifest.title}`
              }
              disabled={submitting}
              onPress={() => void submitCreate()}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog
          onDismiss={() => setDialog(null)}
          visible={dialog === 'profile'}>
          <Dialog.Title>Edit {selected ? recordTitle('profiles', selected) : 'profile'}</Dialog.Title>
          <Dialog.Content style={styles.dialogFields}>
            <TextInput
              accessibilityLabel="Profile prompt"
              label="Profile prompt"
              multiline
              onChangeText={(prompt) => setForm((value) => ({ ...value, prompt }))}
              value={form.prompt ?? ''}
            />
            <Text accessibilityRole="header">Permission scope mode</Text>
            <View accessibilityLabel="Permission scope mode">
              <SegmentedButtons
                buttons={[
                  { label: 'Inherit', value: 'inherit', accessibilityLabel: 'Inherit permission scope' },
                  { label: 'None', value: 'explicit-empty', accessibilityLabel: 'No permissions' },
                  { label: 'Custom', value: 'explicit', accessibilityLabel: 'Custom permission scope' },
                ]}
                onValueChange={(scopeMode) =>
                  setForm((value) => ({ ...value, scopeMode }))}
                value={form.scopeMode ?? 'inherit'}
              />
            </View>
            {form.scopeMode === 'explicit' ? (
              <TextInput
                accessibilityLabel="Allowed MCP scope"
                label="Allowed MCPs, comma separated"
                onChangeText={(scope) => setForm((value) => ({ ...value, scope }))}
                value={form.scope ?? ''}
              />
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>Cancel</Button>
            <Button
              accessibilityLabel="Save profile"
              disabled={submitting}
              onPress={() => void saveProfile()}>
              Save profile
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  card: { borderRadius: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { borderRadius: 12, padding: 14 },
  secret: { borderRadius: 16, gap: 10, padding: 16 },
  detail: { borderRadius: 16, gap: 12, padding: 16 },
  dialogFields: { gap: 14, paddingVertical: 8 },
});
