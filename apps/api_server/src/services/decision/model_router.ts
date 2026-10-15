import {
  getDecisionRoutingMinConfidence,
  getDecisionRoutingScope,
  getEffectiveDecisionMode,
} from '../../config/env';
import type { DecisionMode } from '../../config/env';
import type { ModelRoute, ModelTier } from '../agent_model_resolver';
import { logger } from '../../utils/logger';
import { classify } from './decision_engine';
import type { ClassifyResult, DecisionOpts } from './decision_engine';
import { hasDecisionForSession, recordDecision } from './decision_log';
import { effectiveLowConfidenceTier, loadDecisionSettings } from './decision_settings';
import { routeModelForTier, type CatalogSource } from './model_catalog';
import { getDefaultChoiceClient, type ChoiceClient, type ChoiceQuestion } from './systemone_client';
import { getOpenAIDecisionsClient, type ScoreQuestion } from './openai_decisions_client';

/**
 * Only the built-in agent default, and Auto (router) sessions, are "soft"
 * choices the router may override. agent_config is a model the user picked for
 * the profile, so it is a pin just like a session or per-turn override.
 */
const ELIGIBLE_SOURCES = new Set(['agent_default', 'auto']);
const shadowSessionsInFlight = new Set<string>();
const pendingShadowRouting = new Set<Promise<void>>();

/** Test-only drain; production turns must never wait for shadow observations. */
export async function waitForShadowRoutingForTests(): Promise<void> {
  while (pendingShadowRouting.size) await Promise.all([...pendingShadowRouting]);
}

export const TIER_LABELS: { id: ModelTier; description: string }[] = [
  {
    id: 'cheap',
    description:
      'A quick, simple request: look something up, rename a symbol, fix formatting, give a short factual answer, or make a small single-file edit.',
  },
  {
    id: 'standard',
    description:
      'A typical everyday coding, writing, or analysis task: implement a feature, fix a routine bug, write tests, review a change, explain code.',
  },
  {
    id: 'frontier',
    description:
      'A hard task needing deep reasoning: multi-step planning, system architecture, difficult debugging, ambiguous judgement calls, or long research across many sources.',
  },
];

/** The one typed question a System One backend (Kev / Jev) answers per first prompt. */
export const TIER_CHOICE_QUESTION: ChoiceQuestion<ModelTier> = {
  instructions:
    'This is a request sent to an AI assistant. Which model tier does it need? Judge by how much reasoning the task needs, not by its length or its topic. A long request can still be a simple lookup; a short question can hide a hard problem.',
  options: Object.fromEntries(TIER_LABELS.map((l) => [l.id, l.description])) as Record<ModelTier, string>,
};

export const TIER_SCORE_QUESTION: ScoreQuestion = {
  type: 'score', name: 'effort',
  instructions: 'The input is a request a person sent to their AI assistant, which can use tools (files, email, calendar, web, code, other agents). How capable a model does this request need to be done well? Judge the work required, not the length of the message or its subject area.',
  levels: [
    { label: 'quick', description: 'A short factual answer, a quick lookup or status check, a yes/no capability question, or a tiny mechanical change. One step, little judgement.' },
    { label: 'everyday', description: 'Normal work: write or rewrite a document, email, report or plan; analyse some data; search and summarise a few sources; use several tools in sequence; fix a routine problem.' },
    { label: 'hard', description: 'Deep work: plan or build something large across many steps, design a system, debug a hard or unclear failure, synthesise or critique many sources, or set strategy or policy.' },
  ],
};
// ponytail: calibration values from the 74-prompt evaluation, not generic confidence gates.
export const OPENAI_DECISIONS_THRESHOLDS = { cheapBelow: 0.15, frontierAbove: 0.95 };
export const tierForDecisionScore = (score: number): ModelTier => score < OPENAI_DECISIONS_THRESHOLDS.cheapBelow
  ? 'cheap' : score > OPENAI_DECISIONS_THRESHOLDS.frontierAbove ? 'frontier' : 'standard';

const isUnit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** Measured elapsed time only; unknown/invalid stays null rather than becoming 0 or the timeout budget. */
const measuredLatency = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;

/** Classify with one System One choice question, in the reranker's result shape. */
async function classifyWithChoice(prompt: string, client: ChoiceClient): Promise<ClassifyResult<ModelTier>> {
  const r = await client.choose(prompt, TIER_CHOICE_QUESTION);
  if (r.status !== 'ok') return r;
  // Injected/custom clients must not bypass the parser's probability checks.
  const malformed = { status: 'error', reason: 'malformed_response', latencyMs: r.latencyMs } as const;
  const p = r.probabilities as unknown;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return malformed;
  // Canonical scores: only the three known tiers; extra keys never reach margin or the log.
  const scores = {} as Record<ModelTier, number>;
  let total = 0;
  let winner = TIER_LABELS[0].id;
  for (const { id } of TIER_LABELS) {
    const v = (p as Record<string, unknown>)[id];
    if (!isUnit(v)) return malformed;
    scores[id] = v;
    total += v;
    if (v > scores[winner]) winner = id;
  }
  // A custom result is already normalized: reject other mass rather than manufacture confidence.
  if (!Number.isFinite(total) || total <= 0 || Math.abs(total - 1) > 1e-6) return malformed;
  if (r.choice !== winner || !isUnit(r.confidence) || Math.abs(r.confidence - scores[winner]) > 1e-6) {
    return malformed;
  }
  const sorted = Object.values(scores).sort((a, b) => b - a);
  return {
    status: 'ok',
    label: winner,
    confidence: r.confidence,
    margin: sorted[0] - sorted[1],
    scores,
    latencyMs: r.latencyMs,
    model: r.model,
  };
}

export interface RouteTurnTierInput {
  prompt: string;
  agentId: string;
  requestedSource: string;
  sessionId?: string;
  /** Tier of the route the resolver picked, for shadow-mode agreement stats. */
  baselineTier?: ModelTier | null;
  /** Current route: its provider is preferred when picking the model for the routed tier. */
  baseRoute?: ModelRoute;
  client?: DecisionOpts['client'];
  /** System One client (tests); otherwise the saved systemone backend is used when active. */
  choiceClient?: ChoiceClient;
  /** True for Auto (router) sessions: an unset env var then means 'shadow'. */
  sessionAuto?: boolean;
  /** Test/caller override of the effective mode (wins over env and sessionAuto). */
  modeOverride?: DecisionMode;
  /**
   * Routing-scope gate, consulted once the classifier is confident. When it
   * returns apply:false the tier is not applied (and the log row says so);
   * shadow mode records the would-apply flag in the log detail.
   */
  scopeGate?: (label: ModelTier, confidence: number) => { apply: boolean; reason: string };
}

export interface RouteTurnTierResult {
  tier: ModelTier | null;
  applied: boolean;
  mode: 'off' | 'shadow' | 'on';
  reason: string;
  confidence?: number;
  /** Model picked for `tier` from the live catalog (static table when it is unreachable). */
  route?: ModelRoute;
  catalog?: CatalogSource;
  downgradedForBudget?: boolean;
}

/**
 * Suggest a model tier for a turn. Never throws. Returns `tier: null` (keep the
 * resolver's route) unless mode is 'on', the source is not a user pin, and the
 * classifier is confident enough.
 */
export async function routeTurnTier(input: RouteTurnTierInput): Promise<RouteTurnTierResult> {
  const mode =
    input.modeOverride ?? getEffectiveDecisionMode('model_routing', { sessionAuto: input.sessionAuto });
  if (mode === 'off') return { tier: null, applied: false, mode, reason: 'off' };
  if (!ELIGIBLE_SOURCES.has(input.requestedSource)) {
    return { tier: null, applied: false, mode, reason: 'pinned_source' };
  }
  if (!input.prompt || !input.prompt.trim()) {
    return { tier: null, applied: false, mode, reason: 'empty_prompt' };
  }
  if (mode === 'shadow') {
    if (input.sessionId && (
      shadowSessionsInFlight.has(input.sessionId) ||
      (getDecisionRoutingScope() === 'first_prompt' && hasDecisionForSession('model_routing', input.sessionId))
    )) {
      return { tier: null, applied: false, mode, reason: 'shadow_continuation' };
    }
    if (input.sessionId) shadowSessionsInFlight.add(input.sessionId);
    // ponytail: reuse the awaited routing pipeline; only its shadow scheduling differs.
    const pending = Promise.resolve()
      .then(() => routeClassifiedTurn(input, mode))
      .then(() => undefined)
      .catch(() => { logger.warn('[model_router] shadow routing failed (non-fatal)'); })
      .finally(() => {
        if (input.sessionId) shadowSessionsInFlight.delete(input.sessionId);
        pendingShadowRouting.delete(pending);
      });
    pendingShadowRouting.add(pending);
    return { tier: null, applied: false, mode, reason: 'shadow' };
  }
  return routeClassifiedTurn(input, mode);
}

async function routeClassifiedTurn(input: RouteTurnTierInput, mode: 'shadow' | 'on'): Promise<RouteTurnTierResult> {
  try {
    const settings = loadDecisionSettings();
    const scored = settings.backend === 'openai_decisions'
      ? await getOpenAIDecisionsClient().score(input.prompt, TIER_SCORE_QUESTION) : null;
    const choiceClient =
      input.choiceClient ??
      (!input.client && settings.backend === 'systemone' ? getDefaultChoiceClient() : null);
    const raw: ClassifyResult<ModelTier> = scored
      ? scored.status !== 'ok' ? scored : { status: 'ok', label: tierForDecisionScore(scored.score), confidence: scored.apiConfidence,
          scores: { cheap: scored.levelProbabilities.quick, standard: scored.levelProbabilities.everyday, frontier: scored.levelProbabilities.hard },
          margin: 0, latencyMs: scored.latencyMs, model: scored.model }
      : choiceClient
      ? await classifyWithChoice(input.prompt, choiceClient)
      : await classify(input.prompt, TIER_LABELS, input.client ? { client: input.client } : {});
    // A nominal success with an unusable confidence/tier is never a decision or a fallback.
    const r: ClassifyResult<ModelTier> =
      raw.status === 'ok' && (!isUnit(raw.confidence) || !TIER_LABELS.some((l) => l.id === raw.label))
        ? { status: 'error', reason: 'malformed_response', latencyMs: raw.latencyMs }
        : raw;
    if (r.status !== 'ok') {
      recordDecision({
        feature: 'model_routing',
        mode,
        sessionId: input.sessionId ?? null,
        status: r.status,
        applied: false,
        baseline: input.baselineTier ?? null,
        latencyMs: measuredLatency(r.latencyMs),
        detail: {
          reason: r.reason,
          requestedSource: input.requestedSource,
          ...(scored ? { backend: 'openai_decisions' } : {}),
          ...('cause' in r && typeof r.cause === 'string' ? { cause: r.cause } : {}),
        },
      });
      return { tier: null, applied: false, mode, reason: r.status };
    }
    const confident = scored?.status === 'ok' || r.confidence >= getDecisionRoutingMinConfidence();
    // 'standard' gives unsure answers a floor, never downgrading a frontier
    // baseline; 'keep' leaves the current route alone.
    const fallback = !confident && effectiveLowConfidenceTier(settings) === 'standard';
    const keptBaseline = fallback && input.baselineTier === 'frontier';
    const label: ModelTier = fallback ? (keptBaseline ? 'frontier' : 'standard') : r.label;
    const usable = confident || fallback;
    const gate = input.scopeGate ? input.scopeGate(label, scored?.status === 'ok' ? 1 : r.confidence) : null;
    const gateOk = gate ? gate.apply : true;
    const wouldApply = usable && gateOk;
    const applied = mode === 'on' && wouldApply;
    let picked: Awaited<ReturnType<typeof routeModelForTier>> | null = null;
    let catalogLatencyMs: number | undefined;
    let shadowCatalogError = false;
    if (wouldApply) {
      const catalogStarted = performance.now();
      try {
        picked = await routeModelForTier({
          tier: label,
          agentId: input.agentId,
          ...(input.baseRoute ? { baseRoute: input.baseRoute } : {}),
        });
      } catch {
        picked = null;
        shadowCatalogError = mode === 'shadow';
        if (shadowCatalogError) logger.warn('[model_router] shadow catalog pick failed (non-fatal)');
      } finally {
        if (mode === 'shadow') catalogLatencyMs = performance.now() - catalogStarted;
      }
    }
    recordDecision({
      feature: 'model_routing',
      mode,
      sessionId: input.sessionId ?? null,
      status: 'ok',
      applied,
      chosen: label,
      confidence: r.confidence,
      baseline: input.baselineTier ?? null,
      latencyMs: measuredLatency(r.latencyMs),
      model: r.model,
      query: input.prompt,
      detail: {
        scores: r.scores,
        margin: r.margin,
        ...(scored?.status === 'ok' ? { backend: 'openai_decisions', score: scored.score,
          levelProbabilities: scored.levelProbabilities, thresholds: OPENAI_DECISIONS_THRESHOLDS,
          inputTokens: scored.inputTokens, estimatedUsd: scored.inputTokens * 0.10 / 1e6 } : {}),
        requestedSource: input.requestedSource,
        ...(fallback ? { reason: 'low_confidence_fallback', classified: r.label } : {}),
        ...(keptBaseline ? { lowConfidence: 'kept_baseline' } : {}),
        ...(picked
          ? {
              catalog: picked.catalog,
              ...(mode === 'shadow' || !picked.model ? { routeReason: picked.reason } : {}),
              pickedModel: `${picked.route.providerID}/${picked.route.modelID}`,
              ...(mode === 'shadow' && picked.downgradedForBudget !== undefined
                ? { downgradedForBudget: picked.downgradedForBudget }
                : {}),
            }
          : {}),
        ...(gate ? { scope: gate.reason, wouldApply } : {}),
        ...(mode === 'shadow' ? { wouldApply } : {}),
        ...(catalogLatencyMs !== undefined ? { catalogLatencyMs } : {}),
        ...(shadowCatalogError ? { routeReason: 'shadow_catalog_error' } : {}),
      },
    });
    if (!applied) {
      return {
        tier: null,
        applied: false,
        mode,
        reason:
          mode === 'shadow' ? 'shadow' : usable && !gateOk ? `scope:${gate?.reason}` : 'low_confidence',
        confidence: r.confidence,
      };
    }
    return {
      tier: label,
      applied: true,
      mode,
      reason: fallback ? 'low_confidence_fallback' : 'ok',
      confidence: r.confidence,
      ...(picked
        ? {
            route: picked.route,
            catalog: picked.catalog,
            ...(picked.downgradedForBudget ? { downgradedForBudget: true } : {}),
          }
        : {}),
    };
  } catch {
    if (mode === 'shadow') throw new Error('shadow_routing_failed');
    return { tier: null, applied: false, mode, reason: 'error' };
  }
}
