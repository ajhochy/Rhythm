import type { GatewayMode } from '.';

// Canonical owner-scoped run-quality rollup — apps/api_server/src/services/run_quality_service.ts:203-248
// (RepeatedMistake, AgentRunQuality, RunQualityRollup) via GET /agents/run-quality
// (apps/api_server/src/routes/run_quality_routes.ts:23-43). The live-mode redspec fixture
// (apps/web/tests/post-m1-phase-7-schedules-quality.redspec.ts) exercises an alternate field-name
// variant for the wasted-token rate, average-corrections rate, and each mistake's label
// (`wastedTokenRate`/`averageCorrectionsPerRun`/`mistake` vs. the service's own
// `wastePercentOfSpend`/`avgCorrectionsPerRun`/`message`); every reader below accepts both so this
// stays correct against the real running server as well as that fixture.
export interface RepeatedMistake {
  mistake: string;
  count: number;
}

export interface AgentRunQuality {
  agentKind: string;
  agentLabel?: string;
  totalRuns: number;
  completedRuns: number;
  escalatedRuns: number;
  inProgressRuns: number;
  unmeasuredRuns: number;
  notEnoughData: boolean;
  completionRate: number | null;
  escalationRate: number | null;
  totalTokens: number;
  wastedTokens: number;
  wastedTokenRate: number | null;
  totalUserCorrections: number;
  averageCorrectionsPerRun: number | null;
  repeatedMistakes: RepeatedMistake[];
}

export interface RunQualityRollup {
  windowDays: number;
  agents: AgentRunQuality[];
}

function normalizeMistake(raw: unknown): RepeatedMistake {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const mistake = typeof row.mistake === 'string' ? row.mistake : typeof row.message === 'string' ? row.message : '';
  return { mistake, count: typeof row.count === 'number' ? row.count : 0 };
}

function normalizeAgent(raw: unknown): AgentRunQuality {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    agentKind: typeof row.agentKind === 'string' ? row.agentKind : '',
    agentLabel: typeof row.agentLabel === 'string' ? row.agentLabel : undefined,
    totalRuns: typeof row.totalRuns === 'number' ? row.totalRuns : 0,
    completedRuns: typeof row.completedRuns === 'number' ? row.completedRuns : 0,
    escalatedRuns: typeof row.escalatedRuns === 'number' ? row.escalatedRuns : 0,
    inProgressRuns: typeof row.inProgressRuns === 'number' ? row.inProgressRuns : 0,
    unmeasuredRuns: typeof row.unmeasuredRuns === 'number' ? row.unmeasuredRuns : 0,
    notEnoughData: row.notEnoughData === true,
    completionRate: typeof row.completionRate === 'number' ? row.completionRate : null,
    escalationRate: typeof row.escalationRate === 'number' ? row.escalationRate : null,
    totalTokens: typeof row.totalTokens === 'number' ? row.totalTokens : 0,
    wastedTokens: typeof row.wastedTokens === 'number' ? row.wastedTokens : 0,
    wastedTokenRate: typeof row.wastedTokenRate === 'number' ? row.wastedTokenRate : typeof row.wastePercentOfSpend === 'number' ? row.wastePercentOfSpend : null,
    totalUserCorrections: typeof row.totalUserCorrections === 'number' ? row.totalUserCorrections : 0,
    averageCorrectionsPerRun: typeof row.averageCorrectionsPerRun === 'number' ? row.averageCorrectionsPerRun : typeof row.avgCorrectionsPerRun === 'number' ? row.avgCorrectionsPerRun : null,
    repeatedMistakes: Array.isArray(row.repeatedMistakes) ? row.repeatedMistakes.map(normalizeMistake) : [],
  };
}

export interface RunQualityGateway {
  readonly mode: GatewayMode;
  rollup(windowDays: number): Promise<RunQualityRollup>;
}

export class RunQualityGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function createFixtureRunQualityGateway(): RunQualityGateway {
  return { mode: 'fixture', rollup: async () => { throw new RunQualityGatewayError(0, 'Fixture run-quality gateway is unsupported'); } };
}

export function createLiveRunQualityGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): RunQualityGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a run-quality token is required');
  return {
    mode: 'live',
    rollup: async (windowDays) => {
      let result: Response;
      try {
        result = await fetcher(`${apiBase}/agents/run-quality?windowDays=${windowDays}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        throw new RunQualityGatewayError(0, 'Run-quality service unavailable');
      }
      if (!result.ok) throw new RunQualityGatewayError(result.status, `Run-quality rollup failed (${result.status})`);
      const body = await result.json() as { windowDays?: number; agents?: unknown[] };
      return { windowDays: typeof body.windowDays === 'number' ? body.windowDays : windowDays, agents: Array.isArray(body.agents) ? body.agents.map(normalizeAgent) : [] };
    },
  };
}
