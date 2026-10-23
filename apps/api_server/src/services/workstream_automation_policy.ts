import type {
  OneShotAutomationRequestedModel,
} from '../contracts/agent_workstream_automation_contract';
import {
  parseStoredOneShotAutomationPlan,
  type OneShotAutomationPlan,
} from '../contracts/agent_workstream_automation_contract';

export type { OneShotAutomationPlan } from '../contracts/agent_workstream_automation_contract';

/**
 * Current facts supplied by the existing coordinator admission path.  Both
 * booleans must represent fresh, authoritative checks: they may never be
 * inferred from a cached local idle state or a persisted plan alone.
 */
export interface OneShotAutomationCurrentFacts {
  now: Date;
  workstreamRevision: number;
  workstreamState: string;
  parentSessionId: string | null;
  profile: {
    id: string;
    revision: number;
    model: OneShotAutomationRequestedModel;
  } | null;
  runtimeEligible: boolean;
  admissionEligible: boolean;
}

export type OneShotAutomationDecision =
  | { status: 'off'; reason: 'no_plan' }
  | { status: 'scheduled'; reason: 'not_due' }
  | { status: 'expired'; reason: 'expired' }
  | { status: 'consumed'; reason: 'consumed' }
  | { status: 'disabled'; reason: 'disabled' }
  | { status: 'blocked'; reason: OneShotAutomationBlockedReason }
  | { status: 'eligible'; reason: 'eligible' };

export type OneShotAutomationBlockedReason =
  | 'persisted_blocked'
  | 'policy_malformed'
  | 'runtime_facts_malformed'
  | 'workstream_revision_changed'
  | 'workstream_not_ready'
  | 'parent_session_changed'
  | 'profile_unavailable'
  | 'profile_changed'
  | 'model_changed'
  | 'runtime_unavailable'
  | 'admission_hold';

type ParsedCurrentFacts = {
  nowMillis: number;
  workstreamRevision: number;
  workstreamState: string;
  parentSessionId: string | null;
  profile: {
    id: string;
    revision: number;
    model: OneShotAutomationRequestedModel;
  } | null;
  runtimeEligible: boolean;
  admissionEligible: boolean;
};

const CURRENT_FACT_KEYS = [
  'now', 'workstreamRevision', 'workstreamState', 'parentSessionId', 'profile',
  'runtimeEligible', 'admissionEligible',
] as const;
const PROFILE_KEYS = ['id', 'revision', 'model'] as const;
const MODEL_KEYS = ['providerId', 'modelId'] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MODEL_IDENTIFIER = /^[A-Za-z0-9._:/@+\-]{1,200}$/;

function exactModel(left: OneShotAutomationRequestedModel, right: OneShotAutomationRequestedModel): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId;
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    present.every((key) => keys.includes(key));
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

function dateMillis(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  try {
    const millis = value.valueOf();
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

function currentModel(value: unknown): OneShotAutomationRequestedModel | null {
  const raw = record(value);
  if (raw === null || !exactKeys(raw, MODEL_KEYS) ||
      typeof raw.providerId !== 'string' || !MODEL_IDENTIFIER.test(raw.providerId) ||
      typeof raw.modelId !== 'string' || !MODEL_IDENTIFIER.test(raw.modelId)) {
    return null;
  }
  return { providerId: raw.providerId, modelId: raw.modelId };
}

function parseCurrentFacts(value: unknown): ParsedCurrentFacts | null {
  try {
    const raw = record(value);
    if (raw === null || !exactKeys(raw, CURRENT_FACT_KEYS)) return null;
    const nowMillis = dateMillis(raw.now);
    const workstreamRevision = positiveInteger(raw.workstreamRevision);
    if (nowMillis === null || workstreamRevision === null || typeof raw.workstreamState !== 'string' ||
        (raw.parentSessionId !== null &&
          (typeof raw.parentSessionId !== 'string' || !IDENTIFIER.test(raw.parentSessionId))) ||
        typeof raw.runtimeEligible !== 'boolean' || typeof raw.admissionEligible !== 'boolean') {
      return null;
    }

    let profile: ParsedCurrentFacts['profile'] = null;
    if (raw.profile !== null) {
      const candidate = record(raw.profile);
      if (candidate === null || !exactKeys(candidate, PROFILE_KEYS) ||
          typeof candidate.id !== 'string' || !IDENTIFIER.test(candidate.id)) {
        return null;
      }
      const revision = positiveInteger(candidate.revision);
      const model = currentModel(candidate.model);
      if (revision === null || model === null) return null;
      profile = { id: candidate.id, revision, model };
    }

    return {
      nowMillis,
      workstreamRevision,
      workstreamState: raw.workstreamState,
      parentSessionId: raw.parentSessionId,
      profile,
      runtimeEligible: raw.runtimeEligible,
      admissionEligible: raw.admissionEligible,
    };
  } catch {
    return null;
  }
}

/**
 * Pure, fail-closed planning decision.  It writes nothing, starts no timer,
 * and does not itself admit or dispatch a worker.  The eventual scheduler must
 * call the existing atomic coordinator admission after this decision is
 * `eligible`, with the same freshly-read facts.
 */
export function evaluateOneShotAutomation(
  planValue: unknown,
  factsValue: unknown,
): OneShotAutomationDecision {
  if (planValue === null) return { status: 'off', reason: 'no_plan' };
  const plan = parseStoredOneShotAutomationPlan(planValue);
  if (plan === null) return { status: 'blocked', reason: 'policy_malformed' };
  const facts = parseCurrentFacts(factsValue);
  if (facts === null) return { status: 'blocked', reason: 'runtime_facts_malformed' };
  if (plan.status === 'disabled') return { status: 'disabled', reason: 'disabled' };
  if (plan.status === 'consumed') return { status: 'consumed', reason: 'consumed' };
  if (plan.status === 'blocked') return { status: 'blocked', reason: 'persisted_blocked' };

  if (facts.nowMillis >= Date.parse(plan.expiresAt)) return { status: 'expired', reason: 'expired' };
  if (facts.nowMillis < Date.parse(plan.dueAt)) return { status: 'scheduled', reason: 'not_due' };
  if (facts.workstreamRevision !== plan.workstreamRevision) {
    return { status: 'blocked', reason: 'workstream_revision_changed' };
  }
  if (facts.workstreamState !== 'ready') return { status: 'blocked', reason: 'workstream_not_ready' };
  if (facts.parentSessionId !== plan.parentSessionId) {
    return { status: 'blocked', reason: 'parent_session_changed' };
  }
  if (facts.profile === null) return { status: 'blocked', reason: 'profile_unavailable' };
  if (facts.profile.id !== plan.targetProfileId || facts.profile.revision !== plan.targetProfileRevision) {
    return { status: 'blocked', reason: 'profile_changed' };
  }
  if (!exactModel(facts.profile.model, plan.resolvedModel)) {
    return { status: 'blocked', reason: 'model_changed' };
  }
  if (!facts.runtimeEligible) return { status: 'blocked', reason: 'runtime_unavailable' };
  if (!facts.admissionEligible) return { status: 'blocked', reason: 'admission_hold' };
  return { status: 'eligible', reason: 'eligible' };
}
