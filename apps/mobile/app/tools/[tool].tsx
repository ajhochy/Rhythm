import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
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
  Checkbox,
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
import { useOpencode } from '@/providers/opencode-provider';
import type { OpenCodeInspection } from '@/providers/services/opencode-inspection-service';
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
  profiles: 'New profile',
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
        scheduleType: 'cron',
        enabled: true,
      };
    case 'webhooks':
      return { name: form.name, eventTypes: ['*'], enabled: true };
    case 'profiles':
      return profileInput(form);
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
    profiles: 'profiles:create',
    cookbook: 'cookbook:create',
    skills: 'skills:create',
    playbooks: 'playbooks:create',
    mcp: 'mcp:add',
  };
  return actions[tool]!;
}

function profileInput(form: Record<string, string>): Record<string, unknown> {
  const allowedMcpsJson =
    form.scopeMode === 'inherit'
      ? null
      : form.scopeMode === 'explicit-empty'
        ? '[]'
        : JSON.stringify(
            (form.scope ?? '')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          );
  const delegates = (form.delegates ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    label: form.name,
    systemPrompt: form.prompt,
    modelProvider: form.modelProvider || null,
    modelId: form.modelId || null,
    isManager: form.isManager === 'true',
    allowedDelegatesJson: JSON.stringify(delegates),
    allowedMcpsJson,
  };
}

export default function RhythmToolScreen() {
  const params = useLocalSearchParams<{ tool?: string; selectedId?: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const manifest = TOOL_SCREEN_MANIFEST.find(
    (entry) => entry.id === params.tool,
  );
  const tool = manifest?.id;
  const { getState, perform, refresh } = useRhythmTools();
  const {
    chatPreferences,
    completeMcpOAuth,
    completeProviderOAuth,
    loadOpenCodeInspection,
    reloadOpenCodeConfig,
    reloadOpenCodeSkills,
    removeMcpOAuth,
    removeProvider,
    startMcpOAuth,
    startProviderOAuth,
  } = useOpencode();
  const state = getState(tool ?? 'brain');
  const [dialog, setDialog] = useState<
    'create' | 'edit' | 'profile' | 'mcp-oauth' | 'provider-oauth' | null
  >(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ToolRecord | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runtimeInspection, setRuntimeInspection] = useState<OpenCodeInspection>();
  const [oauthCode, setOauthCode] = useState('');
  const [oauthName, setOauthName] = useState('');
  const [providerMethodIndex, setProviderMethodIndex] = useState(0);

  useEffect(() => {
    if (tool) void refresh(tool);
  }, [refresh, tool]);

  useEffect(() => {
    if (!params.selectedId || selected || state.items.length === 0) return;
    const target = state.items.find((item) => item.id === params.selectedId);
    if (target) setSelected(target);
  }, [params.selectedId, selected, state.items]);

  useEffect(() => {
    if (!selected) return;
    const refreshed = state.items.find((item) => item.id === selected.id);
    if (refreshed && refreshed !== selected) setSelected(refreshed);
  }, [selected, state.items]);

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
    const result = await run(
      createAction(tool),
      actionInput(tool, form),
      tool === 'research' ? 'Research started.' : `${manifest.title} saved.`,
    );
    if (result === undefined) return;
    setDialog(null);
    setForm({});
  };

  const inspectOpenCodeRuntime = async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      const [provider, ...modelParts] = (chatPreferences.modelId || '').split('/');
      const model = modelParts.join('/');
      const inspection = await loadOpenCodeInspection(
        provider || undefined,
        model || undefined,
      );
      setRuntimeInspection(inspection);
      setNotice('OpenCode runtime inspection refreshed.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not inspect the OpenCode runtime.');
    } finally {
      setSubmitting(false);
    }
  };

  const openProfile = (item: ToolRecord) => {
    const allowed =
      typeof item.allowedMcpsJson === 'string'
        ? item.allowedMcpsJson
        : null;
    setSelected(item);
    setForm({
      name: String(item.label ?? item.name ?? ''),
      prompt: String(item.systemPrompt ?? item.prompt ?? ''),
      modelProvider: String(item.modelProvider ?? ''),
      modelId: String(item.modelId ?? ''),
      delegates:
        typeof item.allowedDelegatesJson === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(item.allowedDelegatesJson) as unknown;
                return Array.isArray(parsed) ? parsed.join(', ') : '';
              } catch {
                return '';
              }
            })()
          : Array.isArray(item.allowedDelegates)
            ? item.allowedDelegates.join(', ')
            : '',
      isManager: item.isManager === true ? 'true' : 'false',
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
    const result = await run(
      'profiles:update',
      {
        id: selected.id,
        ...profileInput(form),
      },
      'Projected to OpenCode',
    );
    if (result === undefined) return;
    setDialog(null);
  };

  const openEdit = (item: ToolRecord) => {
    setSelected(item);
    if (tool === 'profiles') {
      openProfile(item);
      return;
    }
    setForm({
      title: String(item.title ?? ''),
      content: String(item.content ?? ''),
      name: String(item.name ?? ''),
      description: String(item.description ?? item.prompt ?? ''),
      prompt: String(item.prompt ?? ''),
      cron: String(item.cronExpression ?? item.cron ?? ''),
      template: String(item.template ?? item.content ?? ''),
    });
    setDialog('edit');
  };

  const saveEdit = async () => {
    if (!selected) return;
    const actions: Partial<Record<ToolScreenId, ToolAction>> = {
      brain: 'brain:update',
      schedules: 'schedules:update',
      cookbook: 'cookbook:update',
      skills: 'skills:update',
      playbooks: 'playbooks:update',
    };
    const action = actions[tool];
    if (!action) return;
    const input = {
      ...actionInput(tool, form),
      id: selected.id,
      name:
        tool === 'skills' || tool === 'playbooks'
          ? String(selected.name ?? selected.id)
          : form.name,
      ...(tool === 'schedules' ? { enabled: selected.enabled !== false } : {}),
    };
    const result = await run(
      action,
      input,
      tool === 'brain'
        ? 'Memory updated.'
        : tool === 'schedules'
          ? 'Scheduled job updated.'
          : tool === 'cookbook'
            ? 'Recipe updated.'
            : tool === 'skills'
              ? 'Skill updated.'
              : 'Playbook updated.',
    );
    if (result === undefined) return;
    setDialog(null);
    setForm({});
  };

  const beginMcpOAuth = async (item: ToolRecord) => {
    setSubmitting(true);
    setNotice(null);
    try {
      const name = String(item.name ?? item.id);
      const authorizationUrl = await startMcpOAuth(name);
      if (!authorizationUrl) {
        throw new Error('The MCP server did not return an authorization URL.');
      }
      setOauthName(name);
      setOauthCode('');
      setDialog('mcp-oauth');
      await WebBrowser.openBrowserAsync(authorizationUrl);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not start MCP authorization.');
    } finally {
      setSubmitting(false);
    }
  };

  const finishMcpOAuth = async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      await completeMcpOAuth(oauthName, oauthCode);
      await refresh('mcp');
      setDialog(null);
      setOauthCode('');
      setNotice('MCP authorization completed.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not complete MCP authorization.');
    } finally {
      setSubmitting(false);
    }
  };

  const beginProviderOAuth = async (item: ToolRecord) => {
    setSubmitting(true);
    setNotice(null);
    try {
      const providerId = String(item.providerID ?? item.providerId ?? item.id);
      const authorization = await startProviderOAuth(providerId, 0);
      if (!authorization.url) {
        throw new Error('The provider did not return an authorization URL.');
      }
      setOauthName(providerId);
      setProviderMethodIndex(0);
      setOauthCode('');
      setDialog('provider-oauth');
      await WebBrowser.openBrowserAsync(authorization.url);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not start provider authorization.');
    } finally {
      setSubmitting(false);
    }
  };

  const finishProviderOAuth = async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      await completeProviderOAuth(oauthName, providerMethodIndex, oauthCode);
      await refresh('models');
      setDialog(null);
      setOauthCode('');
      setNotice(`${recordTitle('models', selected ?? { id: oauthName })} authorization completed.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Could not complete provider authorization.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderActions = (item: ToolRecord) => {
    const title = recordTitle(tool, item);
    switch (tool) {
      case 'brain':
        return (
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`Edit ${title}`}
              disabled={state.offline}
              onPress={() => openEdit(item)}>
              Edit
            </Button>
            <Button
              accessibilityLabel={`Delete ${title}`}
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Delete memory?', `Delete ${title}?`)) {
                  await run('brain:delete', { id: item.id }, 'Memory deleted.');
                  if (selected?.id === item.id) setSelected(null);
                }
              }}>
              Delete
            </Button>
          </View>
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
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`Edit ${title}`}
              disabled={state.offline}
              onPress={() => openEdit(item)}>
              Edit
            </Button>
            <Button
              accessibilityLabel={`${item.enabled === false ? 'Enable' : 'Disable'} ${title}`}
              disabled={state.offline}
              onPress={() =>
                void run(
                  'schedules:update',
                  { id: item.id, enabled: item.enabled === false },
                  item.enabled === false ? 'Scheduled job enabled.' : 'Scheduled job disabled.',
                )}>
              {item.enabled === false ? 'Enable' : 'Disable'}
            </Button>
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
            <Button
              accessibilityLabel={`Delete ${title}`}
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Delete scheduled job?', `Delete ${title}?`)) {
                  await run('schedules:delete', { id: item.id }, 'Scheduled job deleted.');
                  if (selected?.id === item.id) setSelected(null);
                }
              }}>
              Delete
            </Button>
          </View>
        );
      case 'webhooks':
        return (
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`Copy ${title} URL`}
              disabled={!item.url}
              onPress={async () => {
                await Clipboard.setStringAsync(String(item.url));
                setNotice('Webhook URL copied.');
              }}>
              Copy URL
            </Button>
            <Button
              accessibilityLabel={`Rotate ${title} secret`}
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Rotate webhook secret?', `Rotate the secret for ${title}?`)) {
                  await run('webhooks:rotate-secret', { id: item.id }, 'Webhook secret rotated.');
                }
              }}>
              Rotate secret
            </Button>
            <Button
              accessibilityLabel={`Delete ${title}`}
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Delete webhook?', `Delete ${title}?`)) {
                  await run('webhooks:revoke', { id: item.id }, 'Webhook deleted.');
                  if (selected?.id === item.id) setSelected(null);
                }
              }}>
              Delete
            </Button>
          </View>
        );
      case 'profiles':
        return (
          <Button
            accessibilityLabel={`Delete ${title}`}
            disabled={state.offline}
            onPress={async () => {
              if (await confirmAction('Delete profile?', `Delete ${title}?`)) {
                await run('profiles:delete', { id: item.id }, 'Profile deleted.');
                if (selected?.id === item.id) setSelected(null);
              }
            }}>
            Delete
          </Button>
        );
      case 'cookbook':
        return (
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`Edit ${title}`}
              disabled={state.offline}
              onPress={() => openEdit(item)}>
              Edit
            </Button>
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
            <Button
              accessibilityLabel={`Delete ${title}`}
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Delete recipe?', `Delete ${title}?`)) {
                  await run('cookbook:delete', { id: item.id }, 'Recipe deleted.');
                  if (selected?.id === item.id) setSelected(null);
                }
              }}>
              Delete
            </Button>
          </View>
        );
      case 'skills':
        return item.managed ? (
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`Edit ${title}`}
              disabled={state.offline}
              onPress={() => openEdit(item)}>
              Edit
            </Button>
            <Button
              accessibilityLabel={`Delete ${title}`}
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Delete skill?', `Delete ${title}?`)) {
                  await run('skills:delete', { name: item.name }, 'Skill deleted.');
                }
              }}>
              Delete
            </Button>
          </View>
        ) : <Chip compact>Read only</Chip>;
      case 'playbooks':
        return item.managed ? (
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`Edit ${title}`}
              disabled={state.offline}
              onPress={() => openEdit(item)}>
              Edit
            </Button>
            <Button
              accessibilityLabel={`Delete ${title}`}
              disabled={state.offline}
              onPress={async () => {
                if (await confirmAction('Delete playbook?', `Delete ${title}?`)) {
                  await run('playbooks:delete', { name: item.name }, 'Playbook deleted.');
                }
              }}>
              Delete
            </Button>
          </View>
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
              accessibilityLabel={`Authenticate ${title}`}
              disabled={state.offline}
              onPress={() => void beginMcpOAuth(item)}>
              Authenticate
            </Button>
            <Button
              testID={`mcp-remove-oauth-${String(item.name)}`}
              disabled={state.offline || submitting}
              onPress={async () => {
                if (!(await confirmAction(
                  'Remove MCP authorization?',
                  `Remove saved OAuth authorization for ${String(item.name)}?`,
                ))) return;
                setSubmitting(true);
                try {
                  await removeMcpOAuth(String(item.name));
                  await refresh('mcp');
                  setNotice('MCP authorization removed.');
                } catch (reason) {
                  setNotice(reason instanceof Error ? reason.message : 'Could not remove MCP authorization.');
                } finally {
                  setSubmitting(false);
                }
              }}>
              Remove auth
            </Button>
          </View>
        );
      case 'models':
        return (
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`Authenticate ${title}`}
              disabled={state.offline || submitting}
              onPress={() => {
                setSelected(item);
                void beginProviderOAuth(item);
              }}>
              Authenticate
            </Button>
            <Button
              accessibilityLabel={`Remove ${title} credentials`}
              disabled={state.offline || submitting}
              onPress={async () => {
                if (!(await confirmAction(
                  'Remove provider credentials?',
                  `Remove saved credentials for ${title}?`,
                ))) return;
                setSubmitting(true);
                setNotice(null);
                try {
                  await removeProvider(String(item.providerID ?? item.providerId ?? item.id));
                  await refresh('models');
                  setNotice(`${title} credentials removed.`);
                } catch (reason) {
                  setNotice(reason instanceof Error ? reason.message : 'Could not remove provider credentials.');
                } finally {
                  setSubmitting(false);
                }
              }}>
              Remove credentials
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
        {tool === 'skills' || tool === 'models' || tool === 'mcp' ? (
          <Surface style={[styles.runtimeInspection, { backgroundColor: palette.surfaceAlt }]}>
            <View style={styles.runtimeHeader}>
              <View style={styles.runtimeCopy}>
                <Text variant="titleMedium">OpenCode runtime</Text>
                <Text variant="bodySmall" style={{ color: palette.muted }}>
                  Read-only schemas, resources, and redacted configuration from the paired engine.
                </Text>
              </View>
              <Button
                testID="opencode-runtime-inspect-button"
                compact
                mode="outlined"
                loading={submitting}
                onPress={() => void inspectOpenCodeRuntime()}>
                Inspect
              </Button>
            </View>
            <View style={styles.actions}>
              {tool === 'skills' ? (
                <Button
                  testID="opencode-skills-reload-button"
                  compact
                  mode="contained-tonal"
                  disabled={submitting}
                  onPress={() => {
                    setSubmitting(true);
                    void reloadOpenCodeSkills()
                      .then((skills) => {
                        setNotice(`Reloaded ${skills.length} runtime skills.`);
                        return refresh('skills');
                      })
                      .catch((reason) => setNotice(reason instanceof Error ? reason.message : 'Could not reload skills.'))
                      .finally(() => setSubmitting(false));
                  }}>
                  Reload skills
                </Button>
              ) : null}
              {tool === 'models' ? (
                <Button
                  testID="opencode-config-reload-button"
                  compact
                  mode="contained-tonal"
                  disabled={submitting}
                  onPress={() => {
                    setSubmitting(true);
                    void reloadOpenCodeConfig()
                      .then(() => setNotice('OpenCode configuration reloaded.'))
                      .catch((reason) => setNotice(reason instanceof Error ? reason.message : 'Could not reload configuration.'))
                      .finally(() => setSubmitting(false));
                  }}>
                  Reload config
                </Button>
              ) : null}
            </View>
            {runtimeInspection ? (
              <>
                {tool === 'skills' ? (
                  <Text testID="opencode-runtime-skills" selectable>
                    {runtimeInspection.skills.map((skill) => skill.name).join('\n') || 'No runtime skills.'}
                  </Text>
                ) : null}
                {tool === 'mcp' ? (
                  <Text testID="opencode-runtime-resources" selectable style={styles.mono}>
                    {JSON.stringify(runtimeInspection.resources, null, 2)}
                  </Text>
                ) : null}
                {tool === 'models' ? (
                  <>
                    <Text variant="labelLarge">Tool IDs and schemas</Text>
                    <Text testID="opencode-runtime-tool-schemas" selectable style={styles.mono}>
                      {JSON.stringify({
                        ids: runtimeInspection.toolIds,
                        schemas: runtimeInspection.toolSchemas,
                      }, null, 2)}
                    </Text>
                    <Text variant="labelLarge">Redacted global config</Text>
                    <Text testID="opencode-runtime-config" selectable style={styles.mono}>
                      {JSON.stringify(runtimeInspection.globalConfig, null, 2)}
                    </Text>
                  </>
                ) : null}
              </>
            ) : null}
          </Surface>
        ) : null}
        {state.offline ? (
          <Surface style={styles.notice}>
            <Text>Mac offline — saved data is read-only.</Text>
          </Surface>
        ) : null}
        {notice && !dialog ? (
          <Surface
            accessibilityLiveRegion="polite"
            style={[styles.notice, { backgroundColor: palette.surfaceAlt }]}>
            <Text>{notice}</Text>
          </Surface>
        ) : null}
        {oneTimeSecret ? (
          <Surface style={styles.secret}>
            <Text accessibilityRole="header" variant="titleMedium">
              Copy this webhook secret now
            </Text>
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
        {selected && tool === 'brain' ? (
          <Surface style={styles.detail}>
            <Text accessibilityRole="header" variant="titleMedium">Memory details</Text>
            <Text accessibilityRole="header" variant="titleLarge">
              {recordTitle(tool, selected)}
            </Text>
            <Text>{String(selected.content ?? 'No memory content.')}</Text>
            <View style={styles.actions}>
              <Button
                accessibilityLabel="Edit memory"
                disabled={state.offline}
                onPress={() => openEdit(selected)}>
                Edit memory
              </Button>
              <Button onPress={() => setSelected(null)}>Close details</Button>
            </View>
          </Surface>
        ) : null}
        {selected && tool === 'research' ? (
          <Surface style={styles.detail}>
            <Text accessibilityRole="header" variant="titleLarge">
              {recordTitle(tool, selected)}
            </Text>
            <Text variant="titleMedium">Research report</Text>
            <Text>{String(selected.report ?? 'The report is still being prepared.')}</Text>
            <Button onPress={() => setSelected(null)}>Close report</Button>
          </Surface>
        ) : null}
        {selected && ['schedules', 'webhooks', 'cookbook'].includes(tool) ? (
          <Surface style={styles.detail}>
            <Text accessibilityRole="header" variant="titleLarge">
              {recordTitle(tool, selected)}
            </Text>
            {tool === 'schedules' ? (
              <>
                <Text>{selected.enabled === false ? 'Disabled' : 'Enabled'}</Text>
                <Text>Schedule: {String(selected.cronExpression ?? selected.cron ?? 'Not set')}</Text>
                <Text>Last run: {String(selected.lastRunStatus ?? 'not run')}</Text>
              </>
            ) : null}
            {tool === 'webhooks' ? (
              <Text selectable>{String(selected.url ?? 'Webhook URL unavailable')}</Text>
            ) : null}
            {tool === 'cookbook' ? (
              <Text>{String(selected.description ?? selected.prompt ?? 'No instructions.')}</Text>
            ) : null}
            <Button onPress={() => setSelected(null)}>Close details</Button>
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
          <ToolScreenState
            message={`${manifest.title} items will appear here when they are available.`}
            state="empty"
          />
        ) : (
          items.map((item) => {
            const title = recordTitle(tool, item);
            const subtitle = recordSubtitle(tool, item);
            const actions = renderActions(item);
            return (
              <Card
                accessibilityLabel={`${title}. ${subtitle}`}
                accessibilityRole={
                  [
                    'brain',
                    'research',
                    'schedules',
                    'webhooks',
                    'profiles',
                    'cookbook',
                    'review',
                  ].includes(tool)
                    ? 'button'
                    : undefined
                }
                key={item.id}
                mode="outlined"
                onPress={
                  tool === 'profiles'
                    ? () => openProfile(item)
                    : [
                        'brain',
                        'research',
                        'schedules',
                        'webhooks',
                        'cookbook',
                        'review',
                      ].includes(tool)
                      ? () => setSelected(item)
                      : undefined
                }
                style={[styles.card, { borderColor: palette.border }]}>
                <Card.Content style={styles.cardHeader}>
                  <Text variant="titleMedium">{title}</Text>
                  {subtitle ? (
                    <Text
                      style={{ color: palette.muted }}
                      variant="bodyMedium">
                      {subtitle}
                    </Text>
                  ) : null}
                </Card.Content>
                {tool === 'brain' && item.content ? (
                  <Card.Content>
                    <Text>{String(item.content)}</Text>
                  </Card.Content>
                ) : null}
                {tool === 'schedules' ? (
                  <Card.Content style={styles.actions}>
                    <Chip compact>{item.enabled === false ? 'Disabled' : 'Enabled'}</Chip>
                    <Text>Last run: {String(item.lastRunStatus ?? 'not run')}</Text>
                  </Card.Content>
                ) : null}
                {tool === 'webhooks' && item.url ? (
                  <Card.Content>
                    <Text selectable>{String(item.url)}</Text>
                  </Card.Content>
                ) : null}
                {tool === 'cookbook' && (item.description || item.prompt) ? (
                  <Card.Content>
                    <Text>{String(item.description ?? item.prompt)}</Text>
                  </Card.Content>
                ) : null}
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
                {actions ? <Divider /> : null}
                {actions ? (
                  <Card.Content style={styles.cardActions}>{actions}</Card.Content>
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
              {tool === 'profiles' ? (
                <>
                  <TextInput
                    accessibilityLabel="Profile name"
                    label="Profile name"
                    onChangeText={(name) => setForm((value) => ({ ...value, name }))}
                    value={form.name ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Profile prompt"
                    label="Profile prompt"
                    multiline
                    onChangeText={(prompt) => setForm((value) => ({ ...value, prompt }))}
                    value={form.prompt ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Model provider"
                    autoCapitalize="none"
                    label="Model provider"
                    onChangeText={(modelProvider) =>
                      setForm((value) => ({ ...value, modelProvider }))}
                    value={form.modelProvider ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Model ID"
                    autoCapitalize="none"
                    label="Model ID"
                    onChangeText={(modelId) =>
                      setForm((value) => ({ ...value, modelId }))}
                    value={form.modelId ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Allowed delegates"
                    label="Allowed delegates, comma separated"
                    onChangeText={(delegates) =>
                      setForm((value) => ({ ...value, delegates }))}
                    value={form.delegates ?? ''}
                  />
                  <Checkbox.Item
                    label="Manager profile"
                    onPress={() =>
                      setForm((value) => ({
                        ...value,
                        isManager: value.isManager === 'true' ? 'false' : 'true',
                      }))}
                    status={form.isManager === 'true' ? 'checked' : 'unchecked'}
                  />
                  <Text accessibilityRole="header">Permission scope mode</Text>
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
                  {form.scopeMode === 'explicit' ? (
                    <TextInput
                      accessibilityLabel="Allowed MCP scope"
                      label="Allowed MCPs, comma separated"
                      onChangeText={(scope) =>
                        setForm((value) => ({ ...value, scope }))}
                      value={form.scope ?? ''}
                    />
                  ) : null}
                </>
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
                    : tool === 'profiles'
                      ? 'Create profile'
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
          visible={dialog === 'edit'}>
          <Dialog.Title>
            Edit {selected ? recordTitle(tool, selected) : manifest.title}
          </Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView contentContainerStyle={styles.dialogFields}>
              {tool === 'brain' ? (
                <>
                  <TextInput
                    accessibilityLabel="Memory title"
                    label="Memory title"
                    onChangeText={(title) =>
                      setForm((value) => ({ ...value, title }))}
                    value={form.title ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Memory content"
                    label="Memory content"
                    multiline
                    onChangeText={(content) =>
                      setForm((value) => ({ ...value, content }))}
                    value={form.content ?? ''}
                  />
                </>
              ) : null}
              {tool === 'schedules' ? (
                <>
                  <TextInput
                    accessibilityLabel="Job name"
                    label="Job name"
                    onChangeText={(name) =>
                      setForm((value) => ({ ...value, name }))}
                    value={form.name ?? ''}
                  />
                  <TextInput
                    accessibilityLabel="Cron schedule"
                    label="Cron schedule"
                    onChangeText={(cron) =>
                      setForm((value) => ({ ...value, cron }))}
                    value={form.cron ?? ''}
                  />
                </>
              ) : null}
              {tool === 'cookbook' ? (
                <>
                  <TextInput
                    accessibilityLabel="Recipe title"
                    label="Recipe title"
                    onChangeText={(title) =>
                      setForm((value) => ({ ...value, title }))}
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
                    accessibilityLabel="Description"
                    label="Description"
                    onChangeText={(description) =>
                      setForm((value) => ({ ...value, description }))}
                    value={form.description ?? ''}
                  />
                  <TextInput
                    accessibilityLabel={
                      tool === 'skills' ? 'Skill content' : 'Playbook template'
                    }
                    label={tool === 'skills' ? 'Skill content' : 'Playbook template'}
                    multiline
                    onChangeText={(text) =>
                      setForm((value) => ({
                        ...value,
                        [tool === 'skills' ? 'content' : 'template']: text,
                      }))}
                    value={
                      form[tool === 'skills' ? 'content' : 'template'] ?? ''
                    }
                  />
                </>
              ) : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>Cancel</Button>
            <Button
              accessibilityLabel={
                tool === 'brain'
                  ? 'Save memory changes'
                  : tool === 'schedules'
                    ? 'Save scheduled job changes'
                    : tool === 'cookbook'
                      ? 'Save recipe changes'
                      : tool === 'skills'
                        ? 'Save skill changes'
                        : 'Save playbook changes'
              }
              disabled={submitting}
              onPress={() => void saveEdit()}>
              Save changes
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
            <TextInput
              accessibilityLabel="Model provider"
              autoCapitalize="none"
              label="Model provider"
              onChangeText={(modelProvider) =>
                setForm((value) => ({ ...value, modelProvider }))}
              value={form.modelProvider ?? ''}
            />
            <TextInput
              accessibilityLabel="Model ID"
              autoCapitalize="none"
              label="Model ID"
              onChangeText={(modelId) =>
                setForm((value) => ({ ...value, modelId }))}
              value={form.modelId ?? ''}
            />
            <TextInput
              accessibilityLabel="Allowed delegates"
              label="Allowed delegates, comma separated"
              onChangeText={(delegates) =>
                setForm((value) => ({ ...value, delegates }))}
              value={form.delegates ?? ''}
            />
            <Checkbox.Item
              label="Manager profile"
              onPress={() =>
                setForm((value) => ({
                  ...value,
                  isManager: value.isManager === 'true' ? 'false' : 'true',
                }))}
              status={form.isManager === 'true' ? 'checked' : 'unchecked'}
            />
            {notice && dialog === 'profile' ? <Text>{notice}</Text> : null}
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
        <Dialog
          onDismiss={() => setDialog(null)}
          visible={dialog === 'mcp-oauth'}>
          <Dialog.Title>Complete {oauthName} authorization</Dialog.Title>
          <Dialog.Content style={styles.dialogFields}>
            <Text>
              Finish signing in in the browser, then paste the authorization code.
            </Text>
            <TextInput
              accessibilityLabel="MCP authorization code"
              autoCapitalize="none"
              label="MCP authorization code"
              onChangeText={setOauthCode}
              value={oauthCode}
            />
            {notice && dialog === 'mcp-oauth' ? <Text>{notice}</Text> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>Cancel</Button>
            <Button
              accessibilityLabel="Complete MCP authorization"
              disabled={submitting || !oauthCode.trim()}
              onPress={() => void finishMcpOAuth()}>
              Complete authorization
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog
          onDismiss={() => setDialog(null)}
          visible={dialog === 'provider-oauth'}>
          <Dialog.Title>
            Complete {selected ? recordTitle('models', selected) : oauthName} authorization
          </Dialog.Title>
          <Dialog.Content style={styles.dialogFields}>
            <Text>
              Finish provider sign-in in the browser, then paste the authorization code.
            </Text>
            <TextInput
              accessibilityLabel="Provider authorization code"
              autoCapitalize="none"
              label="Provider authorization code"
              onChangeText={setOauthCode}
              value={oauthCode}
            />
            {notice && dialog === 'provider-oauth' ? <Text>{notice}</Text> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialog(null)}>Cancel</Button>
            <Button
              accessibilityLabel="Complete provider authorization"
              disabled={submitting || !oauthCode.trim()}
              onPress={() => void finishProviderOAuth()}>
              Complete authorization
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
  cardHeader: { gap: 4, paddingTop: 16 },
  cardActions: { paddingBottom: 16, paddingTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { borderRadius: 12, padding: 14 },
  secret: { borderRadius: 16, gap: 10, padding: 16 },
  detail: { borderRadius: 16, gap: 12, padding: 16 },
  runtimeInspection: { borderRadius: 16, gap: 10, padding: 14 },
  runtimeHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  runtimeCopy: { flex: 1, minWidth: 0 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  dialogFields: { gap: 14, paddingVertical: 8 },
});
