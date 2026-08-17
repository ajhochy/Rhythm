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
  taskToken?: string;
}

export interface GatewayEnvironment {
  mode?: string;
  apiBase?: string;
  engineBase?: string;
  taskToken?: string;
}

type Fetcher = typeof fetch;

const ports: Record<GatewayService, string> = { api: '4098', engine: '4097' };

export function validateLiveBase(value: string | undefined, service: GatewayService): string {
  const expected = `http://127.0.0.1:${ports[service]}`;
  if (!value || (value !== expected && value !== `${expected}/`)) {
    throw new Error(`Live configuration error: ${service} base must be exactly ${expected}`);
  }
  return expected;
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
  const apiBase = validateLiveBase(config.apiBase, 'api');
  const engineBase = validateLiveBase(config.engineBase, 'engine');

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
    // Every domain shares ONE bearer, and it arrives here from the signed-in session rather than
    // from a build-time constant. Pages must consume these through `useGateway().domains.*` instead
    // of constructing their own gateway from `import.meta.env.VITE_RHYTHM_LIVE_TOKEN`: that variable
    // is TEST-ONLY, is unset in a packaged build, and a page wired to it renders a config error for
    // every real user. Two wiring units independently reached for it because these domains were not
    // exposed here yet.
    domains: {
      tasks: createLiveTasksGateway(apiBase, config.taskToken),
      sessions: createLiveSessionsGateway(apiBase, config.taskToken),
      dashboard: createLiveDashboardGateway(apiBase, config.taskToken),
      planner: createLivePlannerGateway(apiBase, config.taskToken),
      rhythms: createLiveRhythmsGateway(apiBase, config.taskToken),
      projects: createLiveProjectsGateway(apiBase, config.taskToken),
      messages: createLiveMessagesGateway(apiBase, config.taskToken),
      facilities: createLiveFacilitiesGateway(apiBase, config.taskToken),
      automations: createLiveAutomationsGateway(apiBase, config.taskToken),
      integrations: createLiveIntegrationsGateway(apiBase, config.taskToken),
      liveArtifacts: createLiveArtifactsGateway(apiBase, config.taskToken),
      userPreferences: createLiveUserPreferencesGateway(apiBase, config.taskToken),
      notifications: createLiveNotificationsGateway(apiBase, config.taskToken),
      memory: createLiveMemoryGateway(apiBase, config.taskToken),
      permissions: createLivePermissionGateway(apiBase, config.taskToken),
      approvals: createLiveApprovalGateway(apiBase, config.taskToken),
      delegation: createLiveDelegationGateway(apiBase, config.taskToken),
      mcp: createLiveMcpGateway(apiBase, config.taskToken),
      skills: createLiveSkillGateway(apiBase, config.taskToken),
      schedules: createLiveScheduleGateway(apiBase, config.taskToken),
      mobileAccess: createLiveMobileAccessGateway(apiBase, config.taskToken),
      commands: createLiveCommandGateway(apiBase, config.taskToken),
      runQuality: createLiveRunQualityGateway(apiBase, config.taskToken),
      cookbook: createLiveCookbookGateway(apiBase, config.taskToken),
      research: createLiveResearchGateway(apiBase, config.taskToken),
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
  return createLiveGateway({ apiBase: environment.apiBase ?? '', engineBase: environment.engineBase ?? '', taskToken: environment.taskToken });
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
