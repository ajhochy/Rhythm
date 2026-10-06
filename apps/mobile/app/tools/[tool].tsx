import * as Clipboard from 'expo-clipboard';
import { ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Divider,
  IconButton,
  List,
  Portal,
  Searchbar,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';

import { ToolScreenState } from '@/components/tools/tool-screen-state';
import { ToolDialog } from '@/components/tools/tool-dialog';
import { ResearchMarkdown } from '@/components/tools/research-markdown';
import { ResearchProjectWorkspace } from '@/components/tools/research-project-workspace';
import { decodePlainTextEntities } from '@/components/tools/tool-display-text';
import {
  BrainSearchSurface,
  ConnectionMetadata,
  ProviderModelGroups,
  StatusDecisionSummary,
} from '@/components/tools/tool-detail-primitives';
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
  type GalleryArtifactSource,
  type ToolRecord,
  type ToolScreenId,
} from '@/providers/services/rhythm-tools-service';
import {
  isOrganizedToolCatalog,
  organizeToolCatalog,
  type CatalogGroupMode,
  type CatalogSortDirection,
} from '@/providers/services/tool-catalog-organizer';

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
    return decodePlainTextEntities(String(item.snippet ?? item.fromEmail ?? 'Email signal'));
  }
  if (tool === 'report-card') {
    // The card body is the single source of rate information.
    return '';
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

function reportRate(label: string, value: unknown) {
  const rate =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(rate)
    ? `${label} ${Math.round(rate * 100)}%`
    : `${label} — not enough data`;
}

function galleryMetadata(item: ToolRecord): readonly (readonly [string, string])[] {
  const fields: readonly (readonly [string, unknown])[] = [
    ['Status', item.status],
    ['Artifact type', item.artifactType],
    ['Provider', item.provider],
    ['Created', item.createdAt],
    ['Updated', item.updatedAt],
  ];
  return fields.flatMap(([label, value]) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? [[label, text] as const] : [];
  });
}

function editDialogTitle(tool: ToolScreenId) {
  const titles: Partial<Record<ToolScreenId, string>> = {
    brain: 'Edit memory',
    cookbook: 'Edit recipe',
    playbooks: 'Edit playbook',
    schedules: 'Edit scheduled job',
    skills: 'Edit skill',
  };
  return titles[tool] ?? `Edit ${tool}`;
}

function safeGalleryLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.hostname.toLowerCase().endsWith('.ts.net')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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
  const { getGalleryArtifactSource, getState, perform, refresh, research } =
    useRhythmTools();
  const {
    availableModels,
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
  const [catalogGroupMode, setCatalogGroupMode] =
    useState<CatalogGroupMode>('category');
  const [catalogSortDirection, setCatalogSortDirection] =
    useState<CatalogSortDirection>('asc');
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runtimeInspection, setRuntimeInspection] = useState<OpenCodeInspection>();
  const [oauthCode, setOauthCode] = useState('');
  const [oauthName, setOauthName] = useState('');
  const [providerMethodIndex, setProviderMethodIndex] = useState(0);
  const [galleryPreview, setGalleryPreview] = useState<{
    item: ToolRecord;
    source: GalleryArtifactSource | null;
    status: 'loading' | 'ready' | 'unavailable';
  } | null>(null);

  useEffect(() => {
    if (tool) void refresh(tool);
  }, [refresh, tool]);

  // Thin route visibility for the provider-owned Research workspace: visible only while this route is focused (blur and
  // unmount both clear it; the native stack keeps unfocused routes mounted), so it never polls or accepts a pending read
  // result while hidden.
  const setResearchVisible = research?.setVisible;
  useFocusEffect(
    useCallback(() => {
      if (tool !== 'research' || !setResearchVisible) return undefined;
      setResearchVisible(true);
      return () => setResearchVisible(false);
    }, [setResearchVisible, tool]),
  );

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

  const catalogSections = useMemo(
    () =>
      tool && isOrganizedToolCatalog(tool)
        ? organizeToolCatalog({
            tool,
            items: state.items,
            query: search,
            groupMode: catalogGroupMode,
            sortDirection: catalogSortDirection,
          })
        : null,
    [
      catalogGroupMode,
      catalogSortDirection,
      search,
      state.items,
      tool,
    ],
  );
  const items = useMemo(() => {
    if (catalogSections) {
      return catalogSections.flatMap((section) => section.items);
    }
    if (tool !== 'brain' || !search.trim()) return state.items;
    const needle = search.trim().toLowerCase();
    return state.items.filter((item) =>
      `${item.title ?? ''} ${item.content ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [catalogSections, search, state.items, tool]);
  const routeHeader = <Stack.Screen options={{ headerShown: false }} />;
  const toolHeader = (
    <Appbar.Header
      testID="compact-tool-header"
      style={{ backgroundColor: palette.background }}>
      <Appbar.BackAction
        accessibilityLabel="Back to Tools"
        onPress={() => router.replace('/(tabs)/tools' as never)}
      />
      <Appbar.Content title={manifest?.title ?? 'Tool'} />
      {manifest && tool ? (
        <Appbar.Action
          accessibilityLabel={`Refresh ${manifest.title}`}
          icon="refresh"
          onPress={() => {
            void refresh(tool);
            if (tool === 'research') void research?.refresh();
          }}
        />
      ) : null}
    </Appbar.Header>
  );

  if (!manifest || !tool) {
    return (
      <>
        {routeHeader}
        {toolHeader}
        <ToolScreenState
          actionLabel="Back to Tools"
          onAction={() => router.replace('/(tabs)/tools' as never)}
          state="error"
          title="Tool not found"
        />
      </>
    );
  }
  if (state.loading && state.items.length === 0) {
    return (
      <>
        {routeHeader}
        {toolHeader}
        <ToolScreenState
          state="loading"
          title={`Loading ${manifest.title}`}
        />
      </>
    );
  }
  if (state.errorState && state.items.length === 0) {
    return (
      <>
        {routeHeader}
        {toolHeader}
        <ToolScreenState
          actionLabel={state.errorState === 'error' ? 'Try again' : 'Back to Tools'}
          message={state.error ?? undefined}
          onAction={() =>
            state.errorState === 'error'
              ? void refresh(tool)
              : router.replace('/(tabs)/tools' as never)}
          state={state.errorState}
        />
      </>
    );
  }
  if (state.offline && state.items.length === 0) {
    return (
      <>
        {routeHeader}
        {toolHeader}
        <ToolScreenState
          actionLabel="Back to Tools"
          onAction={() => router.replace('/(tabs)/tools' as never)}
          state="offline-cache"
          title={`${manifest.title} unavailable offline`}
        />
      </>
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

  const openGalleryArtifact = async (item: ToolRecord) => {
    setGalleryPreview({ item, source: null, status: 'loading' });
    try {
      const source = await getGalleryArtifactSource(item);
      setGalleryPreview((current) =>
        current?.item.id === item.id
          ? {
              item,
              source,
              status: source ? 'ready' : 'unavailable',
            }
          : current,
      );
    } catch {
      setGalleryPreview((current) =>
        current?.item.id === item.id
          ? { item, source: null, status: 'unavailable' }
          : current,
      );
    }
  };

  const markGalleryArtifactUnavailable = () => {
    setGalleryPreview((current) =>
      current
        ? { ...current, source: null, status: 'unavailable' }
        : current,
    );
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
            {/* Retry only for a server-owned strict `canRetry === true` (missing/false/non-boolean never enables it). */}
            {item.status === 'error' && item.canRetry === true ? (
              <Button
                disabled={state.offline || submitting}
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
      case 'gallery':
        return (
          <View style={styles.actions}>
            <Button
              accessibilityLabel={`View details for ${title}`}
              onPress={() => void openGalleryArtifact(item)}>
              View details
            </Button>
          </View>
        );
      case 'models':
        if (Number(item.authMethodCount) < 1) {
          return (
            <Chip compact>
              {item.connected === true ? 'Connected' : 'Enabled'} on paired Mac
            </Chip>
          );
        }
        return (
          <View style={styles.actions}>
            {Number(item.authMethodCount) > 0 ? (
              <Button
                accessibilityLabel={`Authenticate ${title}`}
                disabled={state.offline || submitting}
                onPress={() => {
                  setSelected(item);
                  void beginProviderOAuth(item);
                }}>
                Authenticate
              </Button>
            ) : null}
            {item.connected === true ? (
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
            ) : null}
          </View>
        );
      default:
        return null;
    }
  };

  const renderItemCard = (item: ToolRecord) => {
    const title = recordTitle(tool, item);
    const subtitle = recordSubtitle(tool, item);
    const galleryDetails = tool === 'gallery' ? galleryMetadata(item) : [];
    const actions = renderActions(item);
    const providerModels = Array.isArray(item.models)
      ? item.models.filter(
          (model): model is { id: string; name: string } =>
            Boolean(
              model &&
                typeof model === 'object' &&
                typeof (model as { id?: unknown }).id === 'string' &&
                typeof (model as { name?: unknown }).name === 'string',
            ),
        )
      : [];
    return (
      <Card
        accessibilityLabel={`${title}. ${subtitle}`}
        accessibilityRole={
          [
            'brain',
            'email',
            'research',
            'schedules',
            'webhooks',
            'profiles',
            'cookbook',
            'review',
            'gallery',
          ].includes(tool)
            ? 'button'
            : undefined
        }
        key={item.id}
        mode="outlined"
        onPress={
          tool === 'profiles'
            ? () => openProfile(item)
            : tool === 'gallery'
              ? () => void openGalleryArtifact(item)
            : [
                'brain',
                'email',
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
        {tool === 'models' ? (
          <Card.Content>
            <ProviderModelGroups
              groups={[{
                id: String(item.providerID ?? item.providerId ?? item.id),
                title,
                metadata: item.connected === true ? 'Connected' : undefined,
                models: providerModels.map((model) => ({
                  id: model.id,
                  title: model.name,
                })),
              }]}
            />
            {providerModels.length === 0 ? (
              <Text style={{ color: palette.muted }} variant="bodySmall">
                The paired Mac did not report model metadata for this provider.
              </Text>
            ) : null}
          </Card.Content>
        ) : (
          <Card.Content style={styles.cardHeader}>
            <Text style={styles.cardTitle} variant="titleMedium">{title}</Text>
            {subtitle ? (
              <Text
                ellipsizeMode={tool === 'email' ? 'tail' : undefined}
                numberOfLines={tool === 'email' ? 3 : undefined}
                style={[styles.cardSubtitle, { color: palette.muted }]}
                variant="bodyMedium">
                {subtitle}
              </Text>
            ) : null}
          </Card.Content>
        )}
        {tool === 'brain' && item.content ? (
          <Card.Content style={styles.cardBody}>
            <Text style={styles.cardBodyText}>{String(item.content)}</Text>
          </Card.Content>
        ) : null}
        {tool === 'schedules' ? (
          <Card.Content style={[styles.cardBody, styles.actions]}>
            <Chip compact>
              {item.enabled === false ? 'Disabled' : 'Enabled'}
            </Chip>
            <Text>Last run: {String(item.lastRunStatus ?? 'not run')}</Text>
          </Card.Content>
        ) : null}
        {tool === 'webhooks' && item.url && selected?.id !== item.id ? (
          <Card.Content style={styles.cardBody}>
            <Text selectable style={styles.cardBodyText}>{String(item.url)}</Text>
          </Card.Content>
        ) : null}
        {tool === 'cookbook' && (item.description || item.prompt) ? (
          <Card.Content style={styles.cardBody}>
            <Text style={styles.cardBodyText}>{String(item.description ?? item.prompt)}</Text>
          </Card.Content>
        ) : null}
        {tool === 'gallery' ? (
          <Card.Content style={styles.cardBody}>
            {galleryDetails.length > 0 ? (
              galleryDetails.slice(0, 2).map(([label, value]) => (
                <Text key={label} style={styles.cardBodyText}>
                  {label}: {value}
                </Text>
              ))
            ) : (
              <Text style={[styles.cardBodyText, { color: palette.muted }]}>
                View details for available preview and item information.
              </Text>
            )}
          </Card.Content>
        ) : null}
        {tool === 'report-card' ? (
          <Card.Content style={styles.cardBody}>
            <Text style={styles.cardBodyText}>
              {reportRate('Success rate', item.completionRate)}
            </Text>
            <Text style={styles.cardBodyText}>
              {reportRate('Escalation rate', item.escalationRate)}
            </Text>
          </Card.Content>
        ) : null}
        {tool === 'mcp' ? (
          <Card.Content style={styles.cardBody}>
            <ConnectionMetadata
              reachability={
                item.status === 'connected'
                  ? 'Connected'
                  : item.error
                    ? 'Unreachable'
                    : 'Not reported'
              }
              authentication={
                typeof item.authenticated === 'boolean'
                  ? item.authenticated
                    ? 'Authenticated'
                    : 'Not authenticated'
                  : typeof item.authentication === 'string'
                    ? item.authentication
                    : 'Not reported'
              }
              enablement={
                typeof item.enabled === 'boolean'
                  ? item.enabled
                    ? 'Enabled'
                    : 'Disabled'
                  : 'Not reported'
              }
              configuration={
                [item.type, item.url]
                  .filter((value): value is string => typeof value === 'string' && value.length > 0)
                  .join(' · ') || 'Not reported'
              }
            />
          </Card.Content>
        ) : null}
        {actions ? <Divider /> : null}
        {actions ? (
          <Card.Content style={styles.cardActions}>{actions}</Card.Content>
        ) : null}
      </Card>
    );
  };
  const galleryProjectLink =
    galleryPreview?.status === 'unavailable'
      ? safeGalleryLink(galleryPreview.item.projectUrl) ??
        safeGalleryLink(galleryPreview.item.canvaUrl)
      : null;
  const galleryPreviewDetails = galleryPreview
    ? galleryMetadata(galleryPreview.item)
    : [];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {routeHeader}
      {toolHeader}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        testID="tool-route-scroll">
        {tool === 'skills' ? (
          <Text variant="labelLarge">Approved skills</Text>
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
        {tool === 'models' ? (
          <Surface
            style={[
              styles.catalogExplanation,
              { backgroundColor: palette.surfaceAlt },
            ]}>
            <Text variant="titleMedium">What appears here</Text>
            <Text style={{ color: palette.muted }} variant="bodyMedium">
              Only AI providers and models configured or available in Rhythm on
              the paired Mac are shown. Choose a model when starting or
              configuring a chat.
            </Text>
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
          <BrainSearchSurface query={search} onQueryChange={setSearch} />
        ) : null}
        {isOrganizedToolCatalog(tool) ? (
          <Surface
            testID="tool-catalog-controls"
            style={[
              styles.catalogControls,
              { backgroundColor: palette.surfaceAlt },
            ]}>
            <Searchbar
              accessibilityLabel={`Search ${manifest.title}`}
              onChangeText={setSearch}
              placeholder="Search catalog"
              right={({ color, style, testID }) =>
                search.trim() ? (
                  <IconButton
                    accessibilityLabel={`Clear ${manifest.title} search`}
                    icon="close"
                    iconColor={color}
                    onPress={() => setSearch('')}
                    style={style}
                    testID={`${testID}-clear`}
                  />
                ) : null
              }
              value={search}
            />
            <View style={styles.catalogControlRow}>
              <View style={styles.catalogControl}>
                <Text variant="labelLarge">Group by</Text>
                <SegmentedButtons
                  buttons={[
                    { label: 'Category', value: 'category', showSelectedCheck: true },
                    { label: 'None', value: 'none', showSelectedCheck: true },
                  ]}
                  density="small"
                  onValueChange={(value) =>
                    setCatalogGroupMode(value as CatalogGroupMode)
                  }
                  value={catalogGroupMode}
                />
              </View>
              <View style={styles.catalogControl}>
                <Text variant="labelLarge">Sort by</Text>
                <SegmentedButtons
                  buttons={[
                    { label: 'A–Z', value: 'asc', showSelectedCheck: true },
                    { label: 'Z–A', value: 'desc', showSelectedCheck: true },
                  ]}
                  density="small"
                  onValueChange={(value) =>
                    setCatalogSortDirection(value as CatalogSortDirection)
                  }
                  value={catalogSortDirection}
                />
              </View>
            </View>
          </Surface>
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
            <Text
              accessibilityLabel={recordTitle(tool, selected)}
              accessibilityRole="header"
              numberOfLines={2}
              variant="titleLarge">
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
            <Text accessibilityRole="header" variant="titleMedium">
              Research report
            </Text>
            <Text
              accessibilityLabel={recordTitle(tool, selected)}
              numberOfLines={2}
              style={{ color: palette.muted }}
              variant="bodyMedium">
              {recordTitle(tool, selected)}
            </Text>
            <View style={styles.actions}>
              <Button onPress={() => setSelected(null)}>Close report</Button>
            </View>
            <ResearchMarkdown
              color={palette.text}
              mutedColor={palette.muted}
              text={String(selected.report ?? 'The report is still being prepared.')}
            />
          </Surface>
        ) : null}
        {selected && tool === 'email' ? (
          <Surface style={styles.detail}>
            <Text accessibilityRole="header" variant="titleMedium">Email signal details</Text>
            <Text
              accessibilityLabel={recordTitle(tool, selected)}
              numberOfLines={2}
              variant="titleMedium">
              {recordTitle(tool, selected)}
            </Text>
            {selected.fromName || selected.fromEmail || selected.from ? (
              <Text>
                From: {String(selected.fromName ?? selected.fromEmail ?? selected.from)}
              </Text>
            ) : null}
            {selected.receivedAt ? (
              <Text>Received: {String(selected.receivedAt)}</Text>
            ) : null}
            <Text selectable style={styles.detailUrl}>
              {decodePlainTextEntities(String(selected.snippet ?? 'No message preview was supplied.'))}
            </Text>
            <Button onPress={() => setSelected(null)}>Close details</Button>
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
              <Text selectable style={styles.detailUrl}>
                {String(selected.url ?? 'Webhook URL unavailable')}
              </Text>
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
            <StatusDecisionSummary
              status={String(selected.status ?? 'Not reported')}
              summary={String(selected.rationale ?? 'Review the proposed change before acting.')}
              nextDecision="Approve or reject this proposal."
            />
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
        {tool === 'research' && research ? (
          <>
            <ResearchProjectWorkspace
              models={availableModels ?? []}
              palette={palette}
              workspace={research}
            />
            <Text accessibilityRole="header" variant="titleMedium">Research history</Text>
          </>
        ) : null}
        {items.length === 0 ? (
          <ToolScreenState
            message={`${manifest.title} items will appear here when they are available.`}
            state="empty"
          />
        ) : (
          catalogSections
            ? catalogSections.map((section) => (
                <List.Section key={section.title} title={section.title}>
                  {section.items.map(renderItemCard)}
                </List.Section>
              ))
            : items.map(renderItemCard)
        )}
      </ScrollView>
      <Portal>
        <ToolDialog
          actions={[
            galleryProjectLink ? (
              <Button
                key="open-project-link"
                onPress={() => void WebBrowser.openBrowserAsync(galleryProjectLink)}>
                Open project link
              </Button>
            ) : null,
            <Button key="close" onPress={() => setGalleryPreview(null)}>
              Close
            </Button>,
          ]}
          contentStyle={styles.galleryPreviewContent}
          onDismiss={() => setGalleryPreview(null)}
          testID="gallery-preview-dialog"
          title="Gallery details"
          visible={galleryPreview !== null}>
            {galleryPreview ? (
              <Text
                accessibilityLabel={recordTitle('gallery', galleryPreview.item)}
                numberOfLines={2}
                variant="titleMedium">
                {recordTitle('gallery', galleryPreview.item)}
              </Text>
            ) : null}
            {galleryPreview?.status === 'loading' ? (
              <Text>Opening securely through Rhythm Cloud Gateway…</Text>
            ) : null}
            {galleryPreview?.status === 'ready' &&
            galleryPreview.source?.kind === 'image' ? (
              <Image
                accessibilityLabel={recordTitle('gallery', galleryPreview.item)}
                contentFit="contain"
                onError={markGalleryArtifactUnavailable}
                source={{
                  uri: galleryPreview.source.uri,
                  headers: galleryPreview.source.headers,
                }}
                style={styles.galleryImage}
              />
            ) : null}
            {galleryPreview?.status === 'ready' &&
            galleryPreview.source?.kind === 'video' ? (
              <Video
                accessibilityLabel={recordTitle('gallery', galleryPreview.item)}
                onError={markGalleryArtifactUnavailable}
                resizeMode={ResizeMode.CONTAIN}
                source={{
                  uri: galleryPreview.source.uri,
                  headers: galleryPreview.source.headers,
                }}
                style={styles.galleryVideo}
                useNativeControls
              />
            ) : null}
            {galleryPreview?.status === 'unavailable' ? (
              <>
                <Text>Preview unavailable on this device.</Text>
                <Text accessibilityRole="header" variant="titleSmall">Item details</Text>
                {galleryPreviewDetails.length > 0 ? (
                  galleryPreviewDetails.map(([label, value]) => (
                    <Text key={label}>{label}: {value}</Text>
                  ))
                ) : (
                  <Text>No additional item metadata was supplied.</Text>
                )}
                {galleryProjectLink ? (
                  <Text>A supported project link is available below.</Text>
                ) : null}
              </>
            ) : null}
        </ToolDialog>
        <ToolDialog
          actions={[
            <Button key="cancel" onPress={() => setDialog(null)}>
              Cancel
            </Button>,
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
              key="save"
              onPress={() => void submitCreate()}>
              Save
            </Button>,
          ]}
          contentStyle={styles.dialogFields}
          onDismiss={() => setDialog(null)}
          testID="tool-create-dialog"
          title={CREATE_LABEL[tool]}
          visible={dialog === 'create'}>
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
        </ToolDialog>
        <ToolDialog
          actions={[
            <Button key="cancel" onPress={() => setDialog(null)}>
              Cancel
            </Button>,
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
              key="save"
              onPress={() => void saveEdit()}>
              Save changes
            </Button>,
          ]}
          contentStyle={styles.dialogFields}
          onDismiss={() => setDialog(null)}
          testID="tool-edit-dialog"
          title={editDialogTitle(tool)}
          visible={dialog === 'edit'}>
              {selected ? (
                <Text
                  accessibilityLabel={`Editing ${recordTitle(tool, selected)}`}
                  numberOfLines={2}
                  style={styles.dialogContext}
                  variant="bodyMedium">
                  Editing: {recordTitle(tool, selected)}
                </Text>
              ) : null}
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
        </ToolDialog>
        <ToolDialog
          actions={[
            <Button key="cancel" onPress={() => setDialog(null)}>
              Cancel
            </Button>,
            <Button
              accessibilityLabel="Save profile"
              disabled={submitting}
              key="save"
              onPress={() => void saveProfile()}>
              Save profile
            </Button>,
          ]}
          contentStyle={styles.dialogFields}
          onDismiss={() => setDialog(null)}
          testID="tool-profile-dialog"
          title="Edit profile"
          visible={dialog === 'profile'}>
            {selected ? (
              <Text
                accessibilityLabel={`Editing ${recordTitle('profiles', selected)}`}
                numberOfLines={2}
                style={styles.dialogContext}
                variant="bodyMedium">
                Editing: {recordTitle('profiles', selected)}
              </Text>
            ) : null}
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
        </ToolDialog>
        <ToolDialog
          actions={[
            <Button key="cancel" onPress={() => setDialog(null)}>
              Cancel
            </Button>,
            <Button
              accessibilityLabel="Complete MCP authorization"
              disabled={submitting || !oauthCode.trim()}
              key="complete"
              onPress={() => void finishMcpOAuth()}>
              Complete authorization
            </Button>,
          ]}
          contentStyle={styles.dialogFields}
          onDismiss={() => setDialog(null)}
          testID="tool-mcp-oauth-dialog"
          title="Complete MCP authorization"
          visible={dialog === 'mcp-oauth'}>
            {oauthName ? (
              <Text
                accessibilityLabel={`Authorizing ${oauthName}`}
                numberOfLines={2}
                style={styles.dialogContext}
                variant="bodyMedium">
                Authorizing: {oauthName}
              </Text>
            ) : null}
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
        </ToolDialog>
        <ToolDialog
          actions={[
            <Button key="cancel" onPress={() => setDialog(null)}>
              Cancel
            </Button>,
            <Button
              accessibilityLabel="Complete provider authorization"
              disabled={submitting || !oauthCode.trim()}
              key="complete"
              onPress={() => void finishProviderOAuth()}>
              Complete authorization
            </Button>,
          ]}
          contentStyle={styles.dialogFields}
          onDismiss={() => setDialog(null)}
          testID="tool-provider-oauth-dialog"
          title="Complete provider authorization"
          visible={dialog === 'provider-oauth'}>
            {oauthName ? (
              <Text
                accessibilityLabel={`Authorizing ${oauthName}`}
                numberOfLines={2}
                style={styles.dialogContext}
                variant="bodyMedium">
                Authorizing: {oauthName}
              </Text>
            ) : null}
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
        </ToolDialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  card: { borderRadius: 16, overflow: 'hidden' },
  cardHeader: { gap: 4, paddingBottom: 12, paddingTop: 16 },
  cardTitle: { flexShrink: 1, lineHeight: 25, minWidth: 0 },
  cardSubtitle: { flexShrink: 1, lineHeight: 21, minWidth: 0 },
  cardBody: { gap: 8, paddingBottom: 12, paddingTop: 12 },
  cardBodyText: { flexShrink: 1, lineHeight: 21, minWidth: 0 },
  cardActions: { minHeight: 56, paddingBottom: 12, paddingTop: 12 },
  catalogControls: { borderRadius: 16, gap: 12, padding: 12 },
  catalogControlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  catalogControl: { flex: 1, gap: 6, minWidth: 220 },
  catalogExplanation: { borderRadius: 16, gap: 6, padding: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { borderRadius: 12, padding: 14 },
  secret: { borderRadius: 16, gap: 10, padding: 16 },
  detail: { borderRadius: 16, gap: 12, padding: 16 },
  detailUrl: { flexShrink: 1, lineHeight: 21, minWidth: 0 },
  runtimeInspection: { borderRadius: 16, gap: 10, padding: 14 },
  runtimeHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  runtimeCopy: { flex: 1, minWidth: 0 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  dialogFields: { gap: 14, paddingVertical: 8 },
  dialogContext: { flexShrink: 1, minWidth: 0 },
  galleryPreviewContent: { gap: 12 },
  galleryImage: { height: 320, width: '100%' },
  galleryVideo: { height: 320, width: '100%' },
});
