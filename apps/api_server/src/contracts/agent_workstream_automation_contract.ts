import { AppError } from '../errors/app_error';

/**
 * The public, body-free request for one explicitly authorized future run.
 *
 * This is deliberately not the persisted record.  The authenticated route
 * supplies actor/time and resolves the workstream, profile, parent session,
 * and model before it creates a durable authorization.  In particular, a
 * client cannot provide an owner, acknowledgement timestamp, native state,
 * prompt, or already-resolved model receipt.
 */
export const ONE_SHOT_AUTOMATION_MAX_HORIZON_MS = 30 * 24 * 60 * 60 * 1_000;
export const ONE_SHOT_AUTOMATION_MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const ONE_SHOT_AUTOMATION_MIN_WALL_SECONDS = 30;
export const ONE_SHOT_AUTOMATION_MAX_WALL_SECONDS = 3_600;
export const ONE_SHOT_AUTOMATION_MAX_TOKENS = 2_000_000;
export const ONE_SHOT_AUTOMATION_PLAN_SCHEMA_VERSION = 1 as const;
export const ONE_SHOT_AUTOMATION_PLAN_STATUSES = [
  'scheduled', 'disabled', 'consumed', 'blocked',
] as const;
export type OneShotAutomationPlanStatus = typeof ONE_SHOT_AUTOMATION_PLAN_STATUSES[number];

export interface OneShotAutomationRequestedModel {
  providerId: string;
  modelId: string;
}

export interface OneShotAutomationRequest {
  expectedRevision: number;
  authorizationKey: string;
  dueAt: string;
  expiresAt: string;
  targetProfileId: string;
  parentSessionId: string;
  requestedModel: OneShotAutomationRequestedModel;
  /** Exactly one admitted engine turn; callers cannot choose a larger count. */
  maxTurns: 1;
  maxWallTimeSeconds: number;
  /** A soft total authorization, not an output-token cap. */
  maxTokens: number;
  /** Explicitly covers input, output, reasoning, cache, and a possible overrun. */
  softTotalBudgetAcknowledged: true;
}

export interface OneShotAutomationDisableRequest {
  expectedRevision: number;
  planId: string;
}

/**
 * Server-owned durable consent.  It is intentionally separate from the public
 * request: only the authenticated server path may add actor/time, native scope,
 * and the resolved model after it verifies the current workstream and profile.
 */
export interface OneShotAutomationPlan extends OneShotAutomationRequest {
  schemaVersion: typeof ONE_SHOT_AUTOMATION_PLAN_SCHEMA_VERSION;
  planId: string;
  workstreamId: string;
  /** Captured control revision; it must exactly equal expectedRevision. */
  workstreamRevision: number;
  targetProfileRevision: number;
  resolvedModel: OneShotAutomationRequestedModel;
  acknowledgedByUserId: number;
  acknowledgedAt: string;
  status: OneShotAutomationPlanStatus;
}

type UnknownRecord = Record<string, unknown>;

const REQUEST_KEYS = [
  'expectedRevision', 'authorizationKey', 'dueAt', 'expiresAt', 'targetProfileId',
  'parentSessionId', 'requestedModel', 'maxWallTimeSeconds', 'maxTokens',
  'softTotalBudgetAcknowledged',
] as const;
const DISABLE_KEYS = ['expectedRevision', 'planId'] as const;
const MODEL_KEYS = ['providerId', 'modelId'] as const;
const PLAN_KEYS = [
  'schemaVersion', 'planId', 'workstreamId', 'expectedRevision', 'workstreamRevision',
  'authorizationKey', 'dueAt', 'expiresAt', 'targetProfileId', 'targetProfileRevision',
  'parentSessionId', 'requestedModel', 'resolvedModel', 'maxTurns',
  'maxWallTimeSeconds', 'maxTokens', 'softTotalBudgetAcknowledged',
  'acknowledgedByUserId', 'acknowledgedAt', 'status',
] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MODEL_IDENTIFIER = /^[A-Za-z0-9._:/@+\-]{1,200}$/;

function invalid(): never {
  throw AppError.badRequest('invalid one-shot workstream automation request');
}

function record(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, keys: readonly string[]): void {
  const present = Object.keys(value);
  if (present.length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      present.some((key) => !keys.includes(key))) {
    invalid();
  }
}

function positiveRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid();
  return value as number;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) invalid();
  return value;
}

function modelIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !MODEL_IDENTIFIER.test(value)) invalid();
  return value;
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) invalid();
  return value;
}

function trustedNowMillis(now: Date): number {
  const value = now.valueOf();
  if (Number.isNaN(value)) throw new TypeError('one-shot automation requires a valid trusted clock');
  return value;
}

function requestedModel(value: unknown): OneShotAutomationRequestedModel {
  const raw = record(value);
  exactKeys(raw, MODEL_KEYS);
  return {
    providerId: modelIdentifier(raw.providerId),
    modelId: modelIdentifier(raw.modelId),
  };
}

/**
 * Parse the only client-authorable one-shot scheduling request.
 *
 * `now` is provided by the authenticated server path.  It is intentionally
 * not a body field, so a caller cannot backdate a consent or stretch a window.
 */
export function parseOneShotAutomationRequest(value: unknown, now: Date): OneShotAutomationRequest {
  const raw = record(value);
  exactKeys(raw, REQUEST_KEYS);
  const dueAt = canonicalInstant(raw.dueAt);
  const expiresAt = canonicalInstant(raw.expiresAt);
  const dueMillis = Date.parse(dueAt);
  const expiresMillis = Date.parse(expiresAt);
  const nowMillis = trustedNowMillis(now);

  if (dueMillis <= nowMillis || expiresMillis <= dueMillis ||
      dueMillis - nowMillis > ONE_SHOT_AUTOMATION_MAX_HORIZON_MS ||
      expiresMillis - dueMillis > ONE_SHOT_AUTOMATION_MAX_WINDOW_MS) {
    invalid();
  }
  if (!Number.isSafeInteger(raw.maxWallTimeSeconds) ||
      (raw.maxWallTimeSeconds as number) < ONE_SHOT_AUTOMATION_MIN_WALL_SECONDS ||
      (raw.maxWallTimeSeconds as number) > ONE_SHOT_AUTOMATION_MAX_WALL_SECONDS ||
      !Number.isSafeInteger(raw.maxTokens) || (raw.maxTokens as number) < 1 ||
      (raw.maxTokens as number) > ONE_SHOT_AUTOMATION_MAX_TOKENS ||
      raw.softTotalBudgetAcknowledged !== true) {
    invalid();
  }

  return {
    expectedRevision: positiveRevision(raw.expectedRevision),
    authorizationKey: identifier(raw.authorizationKey),
    dueAt,
    expiresAt,
    targetProfileId: identifier(raw.targetProfileId),
    parentSessionId: identifier(raw.parentSessionId),
    requestedModel: requestedModel(raw.requestedModel),
    maxTurns: 1,
    maxWallTimeSeconds: raw.maxWallTimeSeconds as number,
    maxTokens: raw.maxTokens as number,
    softTotalBudgetAcknowledged: true,
  };
}

/** Removing future consent is revision- and plan-specific; it never aborts a run. */
export function parseOneShotAutomationDisableRequest(value: unknown): OneShotAutomationDisableRequest {
  const raw = record(value);
  exactKeys(raw, DISABLE_KEYS);
  return { expectedRevision: positiveRevision(raw.expectedRevision), planId: identifier(raw.planId) };
}

/**
 * Defensively parse an already-persisted, server-owned consent record.
 *
 * This returns null rather than throwing so a malformed historic record can
 * never crash a scheduler/status read or become an implicit authorization.
 * The public request parser remains the only parser for client bodies and
 * continues to reject these server-only actor/time/native fields.
 */
export function parseStoredOneShotAutomationPlan(value: unknown): OneShotAutomationPlan | null {
  try {
    const raw = record(value);
    exactKeys(raw, PLAN_KEYS);
    if (raw.schemaVersion !== ONE_SHOT_AUTOMATION_PLAN_SCHEMA_VERSION || raw.maxTurns !== 1 ||
        !ONE_SHOT_AUTOMATION_PLAN_STATUSES.includes(raw.status as OneShotAutomationPlanStatus) ||
        !Number.isSafeInteger(raw.acknowledgedByUserId) || (raw.acknowledgedByUserId as number) < 1) {
      return null;
    }

    const acknowledgedAt = canonicalInstant(raw.acknowledgedAt);
    const request = parseOneShotAutomationRequest({
      expectedRevision: raw.expectedRevision,
      authorizationKey: raw.authorizationKey,
      dueAt: raw.dueAt,
      expiresAt: raw.expiresAt,
      targetProfileId: raw.targetProfileId,
      parentSessionId: raw.parentSessionId,
      requestedModel: raw.requestedModel,
      maxWallTimeSeconds: raw.maxWallTimeSeconds,
      maxTokens: raw.maxTokens,
      softTotalBudgetAcknowledged: raw.softTotalBudgetAcknowledged,
    }, new Date(acknowledgedAt));
    const workstreamRevision = positiveRevision(raw.workstreamRevision);
    const targetProfileRevision = positiveRevision(raw.targetProfileRevision);
    const resolvedModel = requestedModel(raw.resolvedModel);

    if (request.expectedRevision !== workstreamRevision ||
        request.requestedModel.providerId !== resolvedModel.providerId ||
        request.requestedModel.modelId !== resolvedModel.modelId) {
      return null;
    }

    return {
      ...request,
      schemaVersion: ONE_SHOT_AUTOMATION_PLAN_SCHEMA_VERSION,
      planId: identifier(raw.planId),
      workstreamId: identifier(raw.workstreamId),
      workstreamRevision,
      targetProfileRevision,
      resolvedModel,
      acknowledgedByUserId: raw.acknowledgedByUserId as number,
      acknowledgedAt,
      status: raw.status as OneShotAutomationPlanStatus,
    };
  } catch {
    return null;
  }
}
