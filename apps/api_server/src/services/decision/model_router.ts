import {
  getDecisionFeatureMode,
  getDecisionRoutingMinConfidence,
} from '../../config/env';
import type { ModelTier } from '../agent_model_resolver';
import { classify } from './decision_engine';
import type { DecisionOpts } from './decision_engine';
import { recordDecision } from './decision_log';

/**
 * Only the built-in agent default is a "soft" choice the router may override.
 * agent_config is a model the user picked for the profile, so it is a pin just
 * like a session or per-turn override.
 */
const ELIGIBLE_SOURCES = new Set(['agent_default']);

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

export interface RouteTurnTierInput {
  prompt: string;
  agentId: string;
  requestedSource: string;
  sessionId?: string;
  /** Tier of the route the resolver picked, for shadow-mode agreement stats. */
  baselineTier?: ModelTier | null;
  client?: DecisionOpts['client'];
}

export interface RouteTurnTierResult {
  tier: ModelTier | null;
  applied: boolean;
  mode: 'off' | 'shadow' | 'on';
  reason: string;
  confidence?: number;
}

/**
 * Suggest a model tier for a turn. Never throws. Returns `tier: null` (keep the
 * resolver's route) unless mode is 'on', the source is not a user pin, and the
 * classifier is confident enough.
 */
export async function routeTurnTier(input: RouteTurnTierInput): Promise<RouteTurnTierResult> {
  const mode = getDecisionFeatureMode('model_routing');
  if (mode === 'off') return { tier: null, applied: false, mode, reason: 'off' };
  if (!ELIGIBLE_SOURCES.has(input.requestedSource)) {
    return { tier: null, applied: false, mode, reason: 'pinned_source' };
  }
  if (!input.prompt || !input.prompt.trim()) {
    return { tier: null, applied: false, mode, reason: 'empty_prompt' };
  }
  try {
    const r = await classify(input.prompt, TIER_LABELS, input.client ? { client: input.client } : {});
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
    const applied = mode === 'on' && confident;
    recordDecision({
      feature: 'model_routing',
      mode,
      sessionId: input.sessionId ?? null,
      status: 'ok',
      applied,
      chosen: r.label,
      confidence: r.confidence,
      baseline: input.baselineTier ?? null,
      latencyMs: r.latencyMs,
      model: r.model,
      query: input.prompt,
      detail: { scores: r.scores, margin: r.margin, requestedSource: input.requestedSource },
    });
    if (!applied) {
      return {
        tier: null,
        applied: false,
        mode,
        reason: mode === 'shadow' ? 'shadow' : 'low_confidence',
        confidence: r.confidence,
      };
    }
    return { tier: r.label, applied: true, mode, reason: 'ok', confidence: r.confidence };
  } catch {
    return { tier: null, applied: false, mode, reason: 'error' };
  }
}
