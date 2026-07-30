import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import type { ToolScreenStateKind } from '@/components/tools/tool-screen-state';
import {
  classifyToolFailure,
  deriveToolsCacheScope,
  getToolCacheStorageKey,
  RhythmToolsService,
  sanitizeToolCache,
  TOOL_SCREEN_MANIFEST,
  type ToolRecord,
  type ToolScreenId,
  type ToolTransport,
} from '@/providers/services/rhythm-tools-service';
import { useOpencode } from '@/providers/opencode-provider';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';
import { mobileRuntimeVariant } from '@rhythm/mobile-runtime';

export type ToolsAvailability =
  | 'connected'
  | 'offline'
  | 'expired-auth'
  | 'forbidden'
  | 'missing-scope'
  | 'unauthorized-pairing'
  | 'version-mismatch'
  | 'network-failure';

export interface ToolResourceState {
  items: ToolRecord[];
  loading: boolean;
  refreshing: boolean;
  offline: boolean;
  error: string | null;
  errorState: Extract<
    ToolScreenStateKind,
    | 'missing-scope'
    | 'stale-project'
    | 'unauthorized-pairing'
    | 'version-mismatch'
    | 'network-failure'
    | 'expired-auth'
    | 'forbidden'
    | 'error'
  > | null;
}

export type ToolAction =
  | 'brain:create'
  | 'brain:update'
  | 'brain:delete'
  | 'research:create'
  | 'research:retry'
  | 'research:delete'
  | 'schedules:create'
  | 'schedules:update'
  | 'schedules:delete'
  | 'schedules:trigger'
  | 'webhooks:create'
  | 'webhooks:rotate-secret'
  | 'webhooks:revoke'
  | 'profiles:create'
  | 'profiles:update'
  | 'profiles:delete'
  | 'cookbook:create'
  | 'cookbook:update'
  | 'cookbook:delete'
  | 'cookbook:run'
  | 'review:approve'
  | 'review:reject'
  | 'skills:create'
  | 'skills:update'
  | 'skills:delete'
  | 'playbooks:create'
  | 'playbooks:update'
  | 'playbooks:delete'
  | 'mcp:add'
  | 'mcp:connect'
  | 'mcp:disconnect'
  | 'mcp:oauth';

interface ToolsContextValue {
  getState: (tool: ToolScreenId) => ToolResourceState;
  refresh: (tool: ToolScreenId) => Promise<void>;
  perform: (
    tool: ToolScreenId,
    action: ToolAction,
    input?: Record<string, unknown>,
  ) => Promise<unknown>;
}

const INITIAL_STATE: ToolResourceState = {
  items: [],
  loading: true,
  refreshing: false,
  offline: false,
  error: null,
  errorState: null,
};

const ToolsContext = createContext<ToolsContextValue | null>(null);

function originFor(tool: ToolScreenId): 'cloud' | 'paired' {
  return TOOL_SCREEN_MANIFEST.find((entry) => entry.id === tool)!.origin;
}

function safeError(reason: unknown): string {
  if (
    reason &&
    typeof reason === 'object' &&
    typeof (reason as { message?: unknown }).message === 'string'
  ) {
    return (reason as { message: string }).message;
  }
  return 'Could not load this tool.';
}

async function runAction(
  service: RhythmToolsService,
  action: ToolAction,
  input: Record<string, unknown>,
): Promise<unknown> {
  const id = String(input.id ?? '');
  const name = String(input.name ?? '');
  switch (action) {
    case 'brain:create':
      return service.createBrain(input);
    case 'brain:update':
      return service.updateBrain(id, input);
    case 'brain:delete':
      return service.deleteBrain(id);
    case 'research:create':
      return service.createResearch(String(input.query ?? ''));
    case 'research:retry':
      return service.retryResearch(id);
    case 'research:delete':
      return service.deleteResearch(id);
    case 'schedules:create':
      return service.createSchedule(input);
    case 'schedules:update':
      return service.updateSchedule(id, input);
    case 'schedules:delete':
      return service.deleteSchedule(id);
    case 'schedules:trigger':
      return service.triggerSchedule(id);
    case 'webhooks:create':
      return service.createWebhook(input);
    case 'webhooks:rotate-secret':
      return service.rotateWebhookSecret(id);
    case 'webhooks:revoke':
      return service.revokeWebhook(id);
    case 'profiles:create':
      return service.createProfile(input);
    case 'profiles:update':
      return service.updateProfile(id, input);
    case 'profiles:delete':
      return service.deleteProfile(id);
    case 'cookbook:create':
      return service.createRecipe(input);
    case 'cookbook:update':
      return service.updateRecipe(id, input);
    case 'cookbook:delete':
      return service.deleteRecipe(id);
    case 'cookbook:run':
      return service.runRecipe(id);
    case 'review:approve':
      return service.approveProposal(id);
    case 'review:reject':
      return service.rejectProposal(id, String(input.reason ?? ''));
    case 'skills:create':
      return service.createSkill(input);
    case 'skills:update':
      return service.updateSkill(name, input);
    case 'skills:delete':
      return service.deleteSkill(name);
    case 'playbooks:create':
      return service.createPlaybook(input);
    case 'playbooks:update':
      return service.updatePlaybook(name, input);
    case 'playbooks:delete':
      return service.deletePlaybook(name);
    case 'mcp:add':
      return service.addMcp(input);
    case 'mcp:connect':
      return service.connectMcp(name);
    case 'mcp:disconnect':
      return service.disconnectMcp(name);
    case 'mcp:oauth':
      return service.startMcpOAuth(name);
  }
}

export function RhythmToolsProvider({
  cacheScope,
  children,
  cloudAvailability,
  pairedAvailability,
  service,
}: PropsWithChildren<{
  cacheScope: string;
  cloudAvailability: ToolsAvailability;
  pairedAvailability: ToolsAvailability;
  service: RhythmToolsService | null;
}>) {
  const [states, setStates] = useState<
    Partial<Record<ToolScreenId, ToolResourceState>>
  >({});
  const generation = useRef<Partial<Record<ToolScreenId, number>>>({});

  useEffect(() => {
    for (const tool of Object.keys(generation.current) as ToolScreenId[]) {
      generation.current[tool] = (generation.current[tool] ?? 0) + 1;
    }
    setStates({});
  }, [cacheScope]);

  const availabilityFor = useCallback(
    (tool: ToolScreenId): ToolsAvailability =>
      originFor(tool) === 'cloud'
        ? cloudAvailability
        : pairedAvailability,
    [cloudAvailability, pairedAvailability],
  );

  const setToolState = useCallback(
    (
      tool: ToolScreenId,
      update:
        | Partial<ToolResourceState>
        | ((current: ToolResourceState) => Partial<ToolResourceState>),
    ) => {
      setStates((current) => {
        const previous = current[tool] ?? INITIAL_STATE;
        const patch =
          typeof update === 'function' ? update(previous) : update;
        return { ...current, [tool]: { ...previous, ...patch } };
      });
    },
    [],
  );

  const readCache = useCallback(
    async (tool: ToolScreenId): Promise<ToolRecord[]> => {
      const raw = await AsyncStorage.getItem(
        getToolCacheStorageKey(cacheScope, tool),
      );
      if (!raw) return [];
      try {
        return sanitizeToolCache(tool, JSON.parse(raw));
      } catch {
        return [];
      }
    },
    [cacheScope],
  );

  const refresh = useCallback(
    async (tool: ToolScreenId): Promise<void> => {
      const requestGeneration = (generation.current[tool] ?? 0) + 1;
      generation.current[tool] = requestGeneration;
      const availability = availabilityFor(tool);
      setToolState(tool, (current) => ({
        loading: current.items.length === 0,
        refreshing: current.items.length > 0,
        error: null,
        errorState: null,
      }));
      if (!service || availability !== 'connected') {
        const cached = await readCache(tool);
        if (generation.current[tool] !== requestGeneration) return;
        const failure = classifyToolFailure(
          undefined,
          service ? availability : 'network-failure',
          originFor(tool),
        );
        const canUseCache = failure === 'network-failure';
        setToolState(tool, {
          items: canUseCache ? cached : [],
          loading: false,
          refreshing: false,
          offline: canUseCache,
          errorState: canUseCache && cached.length > 0 ? null : failure,
        });
        return;
      }
      try {
        const response = await service.loadScreen(tool);
        if (generation.current[tool] !== requestGeneration) return;
        const items = sanitizeToolCache(tool, response);
        await AsyncStorage.setItem(
          getToolCacheStorageKey(cacheScope, tool),
          JSON.stringify(items),
        );
        setToolState(tool, {
          items,
          loading: false,
          refreshing: false,
          offline: false,
        });
      } catch (reason) {
        if (generation.current[tool] !== requestGeneration) return;
        const cached = await readCache(tool);
        const failure = classifyToolFailure(
          reason,
          'connected',
          originFor(tool),
        );
        const canUseCache =
          failure === 'network-failure' || failure === 'error';
        setToolState(tool, {
          items: canUseCache ? cached : [],
          loading: false,
          refreshing: false,
          offline: canUseCache && cached.length > 0,
          error: failure === 'error' || failure === 'forbidden'
            ? safeError(reason)
            : null,
          errorState: canUseCache && cached.length > 0 ? null : failure,
        });
      }
    },
    [
      availabilityFor,
      cacheScope,
      readCache,
      service,
      setToolState,
    ],
  );

  const perform = useCallback(
    async (
      tool: ToolScreenId,
      action: ToolAction,
      input: Record<string, unknown> = {},
    ): Promise<unknown> => {
      if (!service || availabilityFor(tool) !== 'connected') {
        throw new Error('This tool is read-only while its service is offline.');
      }
      const result = await runAction(service, action, input);
      await refresh(tool);
      return result;
    },
    [availabilityFor, refresh, service],
  );

  const getState = useCallback(
    (tool: ToolScreenId): ToolResourceState =>
      states[tool] ?? INITIAL_STATE,
    [states],
  );

  const value = useMemo<ToolsContextValue>(
    () => ({ getState, perform, refresh }),
    [getState, perform, refresh],
  );
  return (
    <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>
  );
}

export function AppRhythmToolsProvider({ children }: PropsWithChildren) {
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();
  const { activeProjectPath } = useOpencode();
  const e2eMode = mobileRuntimeVariant.enabled;
  const service = useMemo(() => {
    const e2eService = mobileRuntimeVariant.createRhythmToolsService();
    if (e2eService) return e2eService.forProject(activeProjectPath);
    const unavailable: ToolTransport = {
      async request(): Promise<never> {
        throw new Error('This service is unavailable.');
      },
    };
    return new RhythmToolsService({
      cloud: account.client,
      paired: pairedHost.client ?? unavailable,
      projectId: activeProjectPath,
    });
  }, [
    account.client,
    activeProjectPath,
    pairedHost.client,
  ]);
  useEffect(() => () => service.cancel(), [service]);
  const cacheScope = deriveToolsCacheScope({
    accountUserId: account.user?.id ?? null,
    activeProjectId: activeProjectPath ?? null,
    pairedHost: pairedHost.host
      ? {
          hostId: pairedHost.host.hostId,
          deviceId: pairedHost.host.deviceId,
        }
      : null,
    runtimeCacheScope: e2eMode
      ? mobileRuntimeVariant.cacheScope
      : null,
  });
  const cloudAvailability: ToolsAvailability =
    e2eMode || account.state === 'signedIn' || account.state === 'refreshing'
      ? 'connected'
      : account.state === 'offline'
        ? 'offline'
        : 'expired-auth';
  const pairedAvailability: ToolsAvailability =
    pairedHost.state === 'incompatible'
      ? 'version-mismatch'
      : pairedHost.state === 'accountMismatch' ||
          pairedHost.state === 'revoked' ||
          pairedHost.state === 'unpaired'
        ? 'unauthorized-pairing'
        : pairedHost.state === 'offline' ||
            pairedHost.state === 'tailscaleUnavailable' ||
            pairedHost.state === 'unhealthy'
          ? 'network-failure'
          : !activeProjectPath
            ? 'missing-scope'
            : e2eMode || pairedHost.state === 'connected'
              ? 'connected'
              : 'unauthorized-pairing';
  return (
    <RhythmToolsProvider
      cacheScope={cacheScope}
      cloudAvailability={cloudAvailability}
      pairedAvailability={pairedAvailability}
      service={service}>
      {children}
    </RhythmToolsProvider>
  );
}

export function useRhythmTools(): ToolsContextValue {
  const value = useContext(ToolsContext);
  if (!value) {
    throw new Error('useRhythmTools must be used within RhythmToolsProvider');
  }
  return value;
}
