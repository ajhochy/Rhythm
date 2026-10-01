import {
  getDecisionRoutingMinConfidence,
  getEffectiveDecisionMode,
} from '../../config/env';
import type { DecisionMode } from '../../config/env';
import type { ModelRoute, ModelTier } from '../agent_model_resolver';
import { classify } from './decision_engine';
import type { ClassifyResult, DecisionOpts } from './decision_engine';
import { recordDecision } from './decision_log';
import { effectiveLowConfidenceTier, loadDecisionSettings } from './decision_settings';
import { routeModelForTier, type CatalogSource } from './model_catalog';
import { getDefaultChoiceClient, type ChoiceClient, type ChoiceQuestion } from './systemone_client';

/**
 * Only the built-in agent default, and Auto (router) sessions, are "soft"
 * choices the router may override. agent_config is a model the user picked for
 * the profile, so it is a pin just like a session or per-turn override.
 */
const ELIGIBLE_SOURCES = new Set(['agent_default', 'auto']);

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

/** Classify with one System One choice question, in the reranker's result shape. */
async function classifyWithChoice(prompt: string, client: ChoiceClient): Promise<ClassifyResult<ModelTier>> {
  const r = await client.choose(prompt, TIER_CHOICE_QUESTION);
  if (r.status !== 'ok') return r;
  const sorted = Object.values<number>(r.probabilities).sort((a, b) => b - a);
  return {
    status: 'ok',
    label: r.choice,
    confidence: r.confidence,
    margin: sorted[0] - (sorted[1] ?? 0),
    scores: r.probabilities,
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
  /** True for Auto (router) sessions: an unset env var then means 'on'. */
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
  try {
    const settings = loadDecisionSettings();
    const choiceClient =
      input.choiceClient ??
      (!input.client && settings.backend === 'systemone' ? getDefaultChoiceClient() : null);
    const r = choiceClient
      ? await classifyWithChoice(input.prompt, choiceClient)
      : await classify(input.prompt, TIER_LABELS, input.client ? { client: input.client } : {});
    if (r.status !== 'ok') {
      recordDecision({
        feature: 'model_routing',
        mode,
        sessionId: input.sessionId ?? null,
        status: r.status,
        applied: false,
        baseline: input.baselineTier ?? null,
        latencyMs: r.latencyMs,
        detail: { reason: r.reason, requestedSource: input.requestedSource },
      });
      return { tier: null, applied: false, mode, reason: r.status };
    }
    const confident = r.confidence >= getDecisionRoutingMinConfidence();
    // Low-confidence policy: 'standard' routes an unsure answer to the middle
    // tier (calibrated for Kev); 'keep' leaves the current route alone.
    const fallback = !confident && effectiveLowConfidenceTier(settings) === 'standard';
    const label: ModelTier = fallback ? 'standard' : r.label;
    const usable = confident || fallback;
    const gate = input.scopeGate ? input.scopeGate(label, r.confidence) : null;
    const gateOk = gate ? gate.apply : true;
    const applied = mode === 'on' && usable && gateOk;
    let picked: Awaited<ReturnType<typeof routeModelForTier>> | null = null;
    if (applied) {
      try {
        picked = await routeModelForTier({
          tier: label,
          agentId: input.agentId,
          ...(input.baseRoute ? { baseRoute: input.baseRoute } : {}),
        });
      } catch {
        picked = null;
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
      latencyMs: r.latencyMs,
      model: r.model,
      query: input.prompt,
      detail: {
        scores: r.scores,
        margin: r.margin,
        requestedSource: input.requestedSource,
        ...(fallback ? { reason: 'low_confidence_fallback', classified: r.label } : {}),
        ...(picked
          ? {
              catalog: picked.catalog,
              ...(picked.model ? {} : { routeReason: picked.reason }),
              pickedModel: `${picked.route.providerID}/${picked.route.modelID}`,
            }
          : {}),
        ...(gate ? { scope: gate.reason, wouldApply: usable && gateOk } : {}),
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
    return { tier: null, applied: false, mode, reason: 'error' };
  }
}
