export type GatewayMode = 'fixture' | 'live';
export type GatewayService = 'api' | 'engine';

export interface GatewayDomainContracts {
  inspector?: ReturnType<typeof createInspectorGateway>;
  pty?: ReturnType<typeof createLivePtyGateway>;
  tasks?: TaskGateway;
  sessions?: SessionGateway;
  dashboard?: ReturnType<typeof createLiveDashboardGateway>;
  planner?: ReturnType<typeof createLivePlannerGateway>;
  rhythms?: ReturnType<typeof createLiveRhythmsGateway>;
  projects?: ReturnType<typeof createLiveProjectsGateway>;
  messages?: ReturnType<typeof createLiveMessagesGateway>;
  facilities?: ReturnType<typeof createLiveFacilitiesGateway>;
  automations?: ReturnType<typeof createLiveAutomationsGateway>;
  integrations?: ReturnType<typeof createLiveIntegrationsGateway>;
  liveArtifacts?: ReturnType<typeof createLiveArtifactsGateway>;
  userPreferences?: ReturnType<typeof createLiveUserPreferencesGateway>;
  notifications?: ReturnType<typeof createLiveNotificationsGateway>;
  memory?: ReturnType<typeof createLiveMemoryGateway>;
  permissions?: PermissionGateway;
  approvals?: ApprovalGateway;
  delegation?: DelegationGateway;
  mcp?: McpGateway;
  skills?: SkillGateway;
  schedules?: ScheduleGateway;
  mobileAccess?: MobileAccessGateway;
  commands?: CommandGateway;
  runQuality?: RunQualityGateway;
  usageBudget?: UsageBudgetGateway;
  cookbook?: CookbookGateway;
  research?: ResearchGateway;
  designs?: DesignsGateway;
  orgProposals?: OrgProposalsGateway;
  runOutcomes?: RunOutcomesGateway;
  autoPromotion?: AutoPromotionGateway;
  workspaceMembers?: ReturnType<typeof createLiveWorkspaceMembersGateway>;
  settings?: ReturnType<typeof createLiveSettingsGateway>;
  runtime?: RuntimeGateway;
  dayflow?: DayflowGateway;
  sharedAgents?: SharedAgentsPort;
  remoteSessions?: RemoteSessionsGateway;
  workstreams?: WorkstreamGateway;
  coordinatorConversations?: CoordinatorConversationGateway;
  /** Authenticated, root-scoped Dayflow source management only. */
  dayflowSourceConsent?: DayflowSourceConsentGateway;
}

export interface GatewayHealth {
  service: GatewayService;
  state: 'fixture' | 'healthy';
}

export interface RendererGateway {
  readonly mode: GatewayMode;
  readonly environment: { apiPort: string; enginePort: string; apiBase: string; browser?: boolean } | null;
  readonly domains: GatewayDomainContracts;
  readonly health: {
    api(): Promise<GatewayHealth>;
    engine(): Promise<GatewayHealth>;
  };
  unsupported(operation: string): Promise<never>;
}

export interface LiveGatewayConfig {
  cloud?: boolean;
  browserOrigin?: string;
  apiBase?: string;
  engineBase?: string;
  productionApiBase?: string;
  qualificationLocalProductionApiBase?: string;
  expectedApiBase?: string;
  expectedEngineBase?: string;
  taskToken?: string;
  mcpReady?: () => Promise<void>;
}

export interface GatewayEnvironment {
  cloud?: boolean;
  browserOrigin?: string;
  mode?: string;
  apiBase?: string;
  engineBase?: string;
  productionApiBase?: string;
  qualificationLocalProductionApiBase?: string;
  expectedApiBase?: string;
  expectedEngineBase?: string;
  taskToken?: string;
  mcpReady?: () => Promise<void>;
}

type Fetcher = typeof fetch;

// Shipping Electron and Flutter share the same local Rhythm runtime. Alternate loopback ports are
// allowed only when the trusted host supplies matching expectedApiBase/expectedEngineBase values
// (the hermetic test path); they must never become production defaults again.
const ports: Record<GatewayService, string> = { api: '4001', engine: '4096' };

export function validateLiveBase(value: string | undefined, service: GatewayService, expectedValue?: string): string {
  const fallback = `http://127.0.0.1:${ports[service]}`;
  let expected: string;
  try {
    const url = new URL(expectedValue ?? fallback);
    const port = Number(url.port);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || port < 1024 || port > 65535 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    expected = `http://127.0.0.1:${port}`;
  } catch {
    throw new Error(`Live configuration error: trusted ${service} expected base must be plain loopback HTTP on an unprivileged port`);
  }
  if (!value || (value !== expected && value !== `${expected}/`)) {
    throw new Error(`Live configuration error: ${service} base must be exactly ${expected}`);
  }
  return expected;
}

export function validateProductionApiBase(value: string | undefined): string {
  try {
    return normalizeRemoteProductionApiBase(value);
  } catch {
    throw new Error('Live configuration error: production API base must be a remote HTTPS URL without credentials, query, or fragment');
  }
}

const unsupported = (mode: GatewayMode, operation: string) =>
  Promise.reject(new Error(`${mode} gateway unsupported domain operation: ${operation}`));

export function createFixtureGateway(_fetcher?: Fetcher): RendererGateway {
  return {
    mode: 'fixture',
    environment: null,
    domains: {},
    health: {
      api: async () => ({ service: 'api', state: 'fixture' }),
      engine: async () => ({ service: 'engine', state: 'fixture' }),
    },
    unsupported: (operation) => unsupported('fixture', operation),
  };
}

export function createLiveGateway(config: LiveGatewayConfig, fetcher: Fetcher = fetch): RendererGateway {
  const browser = config.browserOrigin !== undefined;
  if (browser && (!/^https?:$/.test(new URL(config.browserOrigin!).protocol) || new URL(config.browserOrigin!).origin !== config.browserOrigin)) throw new Error('Browser gateway requires an HTTP(S) origin');
  const apiBase = browser ? config.browserOrigin! : validateLiveBase(config.apiBase, 'api', config.expectedApiBase);
  const engineBase = browser ? apiBase : validateLiveBase(config.engineBase, 'engine', config.expectedEngineBase);
  if (!browser && apiBase === engineBase) throw new Error('Live configuration error: API and engine expected bases must use distinct ports');
  // The native host grants this one origin only after validating a private, exact-build fixture.
  // Browser/Vite configuration has no path to supply the grant in main.tsx. Keep every other
  // production origin subject to the normal remote HTTPS validator.
  const fixtureLocalBase = 'http://127.0.0.1:4001';
  const qualificationLocalOrigin = config.qualificationLocalProductionApiBase === fixtureLocalBase
    && apiBase === fixtureLocalBase && config.productionApiBase === fixtureLocalBase;
  const productionApiBase = browser ? `${apiBase}/cloud` : qualificationLocalOrigin
    ? fixtureLocalBase : validateProductionApiBase(config.productionApiBase);
  const localFetcher: Fetcher = browser ? trustedBrowserFetcher(apiBase, fetcher) : (input, init) => {
    const headers = new Headers(init?.headers);
    // Only the validated private actor uses its seeded ordinary session for owner-scoped local
    // routes. Normal local calls still strip cloud Authorization for AGENT_LOCAL as before.
    if (!qualificationLocalOrigin) headers.delete('authorization');
    return fetcher(input, { ...init, headers });
  };
  const cloudEnabled = !browser || config.cloud === true;
  const cloudFetcher = browser ? localFetcher : fetcher;

  const check = async (service: GatewayService, url: string): Promise<GatewayHealth> => {
    try {
      const response = await fetcher(url, { method: 'GET', signal: AbortSignal.timeout(4_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { service, state: 'healthy' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${service === 'api' ? 'API' : 'Engine'} health failed: ${detail}`, { cause: error });
    }
  };

  return {
    mode: 'live',
    environment: { apiPort: new URL(apiBase).port, enginePort: new URL(engineBase).port, apiBase, ...(browser ? { browser: true } : {}) },
    // The signed-in cloud bearer belongs only on production requests. The local API mirrors
    // Flutter's localHeaders() trust boundary: a present cloud bearer must be omitted because
    // AGENT_LOCAL fails closed on invalid Authorization instead of using the local bypass.
    domains: {
      inspector: createInspectorGateway(apiBase, productionApiBase, config.taskToken, fetcher, localFetcher),
      pty: createLivePtyGateway(apiBase, localFetcher),
      tasks: cloudEnabled ? createLiveTasksGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      sessions: createLiveSessionsGateway(apiBase, config.taskToken, localFetcher),
      dashboard: cloudEnabled ? createLiveDashboardGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      planner: cloudEnabled ? createLivePlannerGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      rhythms: cloudEnabled ? createLiveRhythmsGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      projects: cloudEnabled ? createLiveProjectsGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      messages: cloudEnabled ? createLiveMessagesGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      facilities: cloudEnabled ? createLiveFacilitiesGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      automations: cloudEnabled ? createLiveAutomationsGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      integrations: cloudEnabled ? createLiveIntegrationsGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      liveArtifacts: cloudEnabled ? createLiveArtifactsGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      userPreferences: cloudEnabled ? createLiveUserPreferencesGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      notifications: cloudEnabled ? createLiveNotificationsGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      memory: createLiveMemoryGateway(apiBase, config.taskToken, localFetcher),
      permissions: createLivePermissionGateway(apiBase, config.taskToken, localFetcher),
      // Browser decisions use the trusted web host; desktop decisions retain the native signed route.
      approvals: browser ? createBrowserApprovalGateway(apiBase, localFetcher) : createLiveApprovalGateway(apiBase, config.taskToken, fetcher),
      delegation: createLiveDelegationGateway(apiBase, config.taskToken, localFetcher),
      mcp: createLiveMcpGateway(apiBase, config.taskToken, localFetcher, config.mcpReady),
      skills: createLiveSkillGateway(apiBase, config.taskToken, localFetcher),
      schedules: createLiveScheduleGateway(apiBase, config.taskToken, localFetcher, config.mcpReady),
      mobileAccess: browser ? undefined : createLiveMobileAccessGateway(apiBase, config.taskToken, localFetcher),
      commands: createLiveCommandGateway(apiBase, config.taskToken, localFetcher),
      runQuality: createLiveRunQualityGateway(apiBase, config.taskToken, localFetcher),
      usageBudget: createLiveUsageBudgetGateway(apiBase, config.taskToken, localFetcher),
      cookbook: createLiveCookbookGateway(apiBase, config.taskToken, localFetcher),
      research: createLiveResearchGateway(apiBase, config.taskToken, localFetcher),
      designs: createLiveDesignsGateway(apiBase, config.taskToken, localFetcher),
      orgProposals: createLiveOrgProposalsGateway(apiBase, config.taskToken, localFetcher),
      runOutcomes: createLiveRunOutcomesGateway(apiBase, config.taskToken, localFetcher),
      autoPromotion: cloudEnabled ? createLiveAutoPromotionGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      workspaceMembers: cloudEnabled ? createLiveWorkspaceMembersGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      settings: cloudEnabled ? createLiveSettingsGateway(productionApiBase, config.taskToken, cloudFetcher) : undefined,
      runtime: createLiveRuntimeGateway(apiBase, localFetcher),
      dayflow: createLiveDayflowGateway(apiBase, localFetcher),
      sharedAgents: createLiveSharedAgentsPort(apiBase, config.taskToken,
        createLiveSessionsGateway(apiBase, config.taskToken, localFetcher), browser ? localFetcher : fetcher,
        undefined, browser ? 'trusted-tailnet-web' : 'bearer'),
      // #1374 — undefined outside the Electron shell (plain browser preview, or a build with the
      // RHYTHM_REMOTE_ATTACH kill switch off); the gateway itself reports `enabled: false` then.
      remoteSessions: createLiveRemoteSessionsGateway(
        typeof window === 'undefined' ? undefined
          : (window as unknown as { rhythmShell?: { remoteEnvironments?: RemoteEnvironmentsBridge } }).rhythmShell?.remoteEnvironments,
      ),
      workstreams: createLiveWorkstreamsGateway(apiBase, config.taskToken, browser ? localFetcher : fetcher),
      // The web host validates its configured owner; desktop keeps its bearer.
      coordinatorConversations: createLiveCoordinatorConversationGateway(apiBase,
        browser ? localFetcher : fetcher, undefined, config.taskToken, browser ? 'trusted-tailnet-web' : 'bearer'),
      // This is another protected local route. It intentionally keeps the
      // signed-in bearer while established local routes continue to strip it.
      dayflowSourceConsent: createLiveDayflowSourceConsentGateway(apiBase, fetcher, config.taskToken),
    },
    health: {
      api: () => check('api', `${apiBase}/health`),
      engine: () => check('engine', browser ? `${apiBase}/opencode/health` : `${engineBase}/global/health`),
    },
    unsupported: (operation) => unsupported('live', operation),
  };
}

export function composeGateway(environment: GatewayEnvironment): RendererGateway {
  if (!environment.mode || environment.mode === 'fixture') return createFixtureGateway();
  if (environment.mode !== 'live') {
    throw new Error('Live configuration error: gateway mode must be fixture or live');
  }
  return createLiveGateway({
    cloud: environment.cloud,
    browserOrigin: environment.browserOrigin,
    apiBase: environment.apiBase ?? '',
    engineBase: environment.engineBase ?? '',
    productionApiBase: environment.productionApiBase ?? '',
    qualificationLocalProductionApiBase: environment.qualificationLocalProductionApiBase,
    expectedApiBase: environment.expectedApiBase,
    expectedEngineBase: environment.expectedEngineBase,
    taskToken: environment.taskToken,
    mcpReady: environment.mcpReady,
  });
}
import { trustedBrowserFetcher } from './browser-transport';
import { createLiveTasksGateway, type TaskGateway } from './tasks';
import { createInspectorGateway } from './inspector';
import { createLivePtyGateway } from './pty';
import { createLiveSessionsGateway, type SessionGateway } from './sessions';
import { createLiveDashboardGateway } from './dashboard';
import { createLivePlannerGateway } from './planner';
import { createLiveRhythmsGateway } from './rhythms';
import { createLiveProjectsGateway } from './projects';
import { createLiveMessagesGateway } from './messages';
import { createLiveFacilitiesGateway } from './facilities';
import { createLiveAutomationsGateway } from './automations';
import { createLiveIntegrationsGateway } from './integrations';
import { createLiveArtifactsGateway, type LiveArtifactsGateway } from './live-artifacts';
import { normalizeRemoteProductionApiBase } from '../../../shared/production-api-base.mjs';
import { createLiveUserPreferencesGateway } from './user-preferences';
import { createLiveNotificationsGateway } from './notifications';
import { createLiveMemoryGateway } from './memory';
import { createLivePermissionGateway, type PermissionGateway } from './permissions';
import { createBrowserApprovalGateway, createLiveApprovalGateway, type ApprovalGateway } from './approvals';
import { createLiveDelegationGateway, type DelegationGateway } from './delegation';
import { createLiveMcpGateway, type McpGateway } from './mcp';
import { createLiveSkillGateway, type SkillGateway } from './skills';
import { createLiveScheduleGateway, type ScheduleGateway } from './schedules';
import { createLiveMobileAccessGateway, type MobileAccessGateway } from './mobile-access';
import { createLiveCommandGateway, type CommandGateway } from './commands';
import { createLiveRunQualityGateway, type RunQualityGateway } from './run-quality';
import { createLiveUsageBudgetGateway, type UsageBudgetGateway } from './usage-budget';
import { createLiveCookbookGateway, type CookbookGateway } from './cookbook';
import { createLiveResearchGateway, type ResearchGateway } from './research';
import { createLiveDesignsGateway, type DesignsGateway } from './designs';
import { createLiveOrgProposalsGateway, type OrgProposalsGateway } from './org-proposals';
import { createLiveRunOutcomesGateway, type RunOutcomesGateway } from './run-outcomes';
import { createLiveAutoPromotionGateway, type AutoPromotionGateway } from './auto-promotion';
import { createLiveWorkspaceMembersGateway } from './workspace-members';
import { createLiveSettingsGateway } from './settings';
import { createLiveRuntimeGateway, type RuntimeGateway } from './runtime';
import { createLiveDayflowGateway, type DayflowGateway } from './dayflow';
import { createLiveWorkstreamsGateway, type WorkstreamGateway } from './workstreams';
import { createLiveCoordinatorConversationGateway, type CoordinatorConversationGateway } from './coordinator-conversations';
import { createLiveDayflowSourceConsentGateway, type DayflowSourceConsentGateway } from './dayflow-source-consent';
import { createLiveSharedAgentsPort } from './shared-agents';
import type { SharedAgentsPort } from '@ajhochy/rhythm-workspace-ui';
import { createLiveRemoteSessionsGateway, type RemoteEnvironmentsBridge, type RemoteSessionsGateway } from './remote-sessions';
