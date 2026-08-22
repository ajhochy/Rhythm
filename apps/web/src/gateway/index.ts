export type GatewayMode = 'fixture' | 'live';
export type GatewayService = 'api' | 'engine';

export interface GatewayDomainContracts {
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
  cookbook?: CookbookGateway;
  research?: ResearchGateway;
  designs?: DesignsGateway;
  orgProposals?: OrgProposalsGateway;
  runOutcomes?: RunOutcomesGateway;
  autoPromotion?: AutoPromotionGateway;
}

export interface GatewayHealth {
  service: GatewayService;
  state: 'fixture' | 'healthy';
}

export interface RendererGateway {
  readonly mode: GatewayMode;
  readonly domains: GatewayDomainContracts;
  readonly health: {
    api(): Promise<GatewayHealth>;
    engine(): Promise<GatewayHealth>;
  };
  unsupported(operation: string): Promise<never>;
}

export interface LiveGatewayConfig {
  apiBase: string;
  engineBase: string;
  productionApiBase: string;
  expectedApiBase?: string;
  expectedEngineBase?: string;
  taskToken?: string;
}

export interface GatewayEnvironment {
  mode?: string;
  apiBase?: string;
  engineBase?: string;
  productionApiBase?: string;
  expectedApiBase?: string;
  expectedEngineBase?: string;
  taskToken?: string;
}

type Fetcher = typeof fetch;

const ports: Record<GatewayService, string> = { api: '4098', engine: '4097' };

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
    const url = new URL(value ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('Live configuration error: production API base must be an HTTP(S) URL without credentials, query, or fragment');
  }
}

const unsupported = (mode: GatewayMode, operation: string) =>
  Promise.reject(new Error(`${mode} gateway unsupported domain operation: ${operation}`));

export function createFixtureGateway(_fetcher?: Fetcher): RendererGateway {
  return {
    mode: 'fixture',
    domains: {},
    health: {
      api: async () => ({ service: 'api', state: 'fixture' }),
      engine: async () => ({ service: 'engine', state: 'fixture' }),
    },
    unsupported: (operation) => unsupported('fixture', operation),
  };
}

export function createLiveGateway(config: LiveGatewayConfig, fetcher: Fetcher = fetch): RendererGateway {
  const apiBase = validateLiveBase(config.apiBase, 'api', config.expectedApiBase);
  const engineBase = validateLiveBase(config.engineBase, 'engine', config.expectedEngineBase);
  if (apiBase === engineBase) throw new Error('Live configuration error: API and engine expected bases must use distinct ports');
  const productionApiBase = validateProductionApiBase(config.productionApiBase);
  const localFetcher: Fetcher = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    return fetcher(input, { ...init, headers });
  };

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
    // The signed-in cloud bearer belongs only on production requests. The local API mirrors
    // Flutter's localHeaders() trust boundary: a present cloud bearer must be omitted because
    // AGENT_LOCAL fails closed on invalid Authorization instead of using the local bypass.
    domains: {
      tasks: createLiveTasksGateway(productionApiBase, config.taskToken, fetcher),
      sessions: createLiveSessionsGateway(apiBase, config.taskToken, localFetcher),
      dashboard: createLiveDashboardGateway(productionApiBase, config.taskToken, fetcher),
      planner: createLivePlannerGateway(productionApiBase, config.taskToken, fetcher),
      rhythms: createLiveRhythmsGateway(productionApiBase, config.taskToken, fetcher),
      projects: createLiveProjectsGateway(productionApiBase, config.taskToken, fetcher),
      messages: createLiveMessagesGateway(productionApiBase, config.taskToken, fetcher),
      facilities: createLiveFacilitiesGateway(productionApiBase, config.taskToken, fetcher),
      automations: createLiveAutomationsGateway(productionApiBase, config.taskToken, fetcher),
      integrations: createLiveIntegrationsGateway(productionApiBase, config.taskToken, fetcher),
      liveArtifacts: createLiveArtifactsGateway(productionApiBase, config.taskToken, fetcher),
      userPreferences: createLiveUserPreferencesGateway(productionApiBase, config.taskToken, fetcher),
      notifications: createLiveNotificationsGateway(productionApiBase, config.taskToken, fetcher),
      memory: createLiveMemoryGateway(apiBase, config.taskToken, localFetcher),
      permissions: createLivePermissionGateway(apiBase, config.taskToken, localFetcher),
      approvals: createLiveApprovalGateway(apiBase, config.taskToken, localFetcher),
      delegation: createLiveDelegationGateway(apiBase, config.taskToken, localFetcher),
      mcp: createLiveMcpGateway(apiBase, config.taskToken, localFetcher),
      skills: createLiveSkillGateway(apiBase, config.taskToken, localFetcher),
      schedules: createLiveScheduleGateway(apiBase, config.taskToken, localFetcher),
      mobileAccess: createLiveMobileAccessGateway(apiBase, config.taskToken, localFetcher),
      commands: createLiveCommandGateway(apiBase, config.taskToken, localFetcher),
      runQuality: createLiveRunQualityGateway(apiBase, config.taskToken, localFetcher),
      cookbook: createLiveCookbookGateway(apiBase, config.taskToken, localFetcher),
      research: createLiveResearchGateway(apiBase, config.taskToken, localFetcher),
      designs: createLiveDesignsGateway(apiBase, config.taskToken, localFetcher),
      orgProposals: createLiveOrgProposalsGateway(apiBase, config.taskToken, localFetcher),
      runOutcomes: createLiveRunOutcomesGateway(apiBase, config.taskToken, localFetcher),
      autoPromotion: createLiveAutoPromotionGateway(productionApiBase, config.taskToken, fetcher),
    },
    health: {
      api: () => check('api', `${apiBase}/health`),
      engine: () => check('engine', `${engineBase}/global/health`),
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
    apiBase: environment.apiBase ?? '',
    engineBase: environment.engineBase ?? '',
    productionApiBase: environment.productionApiBase ?? '',
    expectedApiBase: environment.expectedApiBase,
    expectedEngineBase: environment.expectedEngineBase,
    taskToken: environment.taskToken,
  });
}
import { createLiveTasksGateway, type TaskGateway } from './tasks';
import { createLiveSessionsGateway, type SessionGateway } from './sessions';
import { createLiveDashboardGateway } from './dashboard';
import { createLivePlannerGateway } from './planner';
import { createLiveRhythmsGateway } from './rhythms';
import { createLiveProjectsGateway } from './projects';
import { createLiveMessagesGateway } from './messages';
import { createLiveFacilitiesGateway } from './facilities';
import { createLiveAutomationsGateway } from './automations';
import { createLiveIntegrationsGateway } from './integrations';
import { createLiveArtifactsGateway } from './live-artifacts';
import { createLiveUserPreferencesGateway } from './user-preferences';
import { createLiveNotificationsGateway } from './notifications';
import { createLiveMemoryGateway } from './memory';
import { createLivePermissionGateway, type PermissionGateway } from './permissions';
import { createLiveApprovalGateway, type ApprovalGateway } from './approvals';
import { createLiveDelegationGateway, type DelegationGateway } from './delegation';
import { createLiveMcpGateway, type McpGateway } from './mcp';
import { createLiveSkillGateway, type SkillGateway } from './skills';
import { createLiveScheduleGateway, type ScheduleGateway } from './schedules';
import { createLiveMobileAccessGateway, type MobileAccessGateway } from './mobile-access';
import { createLiveCommandGateway, type CommandGateway } from './commands';
import { createLiveRunQualityGateway, type RunQualityGateway } from './run-quality';
import { createLiveCookbookGateway, type CookbookGateway } from './cookbook';
import { createLiveResearchGateway, type ResearchGateway } from './research';
import { createLiveDesignsGateway, type DesignsGateway } from './designs';
import { createLiveOrgProposalsGateway, type OrgProposalsGateway } from './org-proposals';
import { createLiveRunOutcomesGateway, type RunOutcomesGateway } from './run-outcomes';
import { createLiveAutoPromotionGateway, type AutoPromotionGateway } from './auto-promotion';
