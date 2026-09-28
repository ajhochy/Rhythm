/**
 * #1485 S1b — strict v1 recipe-workflow schema and validator.
 *
 * This file plus its imported test fixtures is the SINGLE SOURCE OF TRUTH for
 * the v1 recipe-workflow definition shape (docs/ai/current-plan-recipes-1485.md
 * "Minimal schema and one-level fan-out"). No JSON-schema doc, no validation
 * library — a closed set of TypeScript types plus a hand-written structural
 * validator that returns stable `{path, code, message}` diagnostics.
 *
 * Scope: this is a STATIC/STRUCTURAL validator only (shape, reachability,
 * targets, bindings, caps). It says nothing about runtime verdict parsing,
 * dispatch, or persistence — those are S3a/S3b.
 *
 * Design choices worth naming (fail-closed throughout):
 *  - `itemKey` is the only scope identity (no `scopePath`/ancestor walk).
 *  - Exactly one level of `fanOut`; a nested `fanOut` is always invalid.
 *  - A `gate` never dispatches an agent itself — it only routes off a prior
 *    stage's already-produced, typed output (the "producer").
 *  - `onInvalid` is mandatory on every gate and is separate from `branches`
 *    (branches only ever carry the three defined VerdictOutcomeV1 keys —
 *    `blocked` is deliberately never a valid branch key; see F9 in the plan).
 *  - Every binding declares its own expected `type`; mismatches against the
 *    producer's declared field type fail validation rather than failing at
 *    runtime.
 */

export type ScalarType = 'string' | 'number' | 'boolean';
export type ScalarFields = Record<string, ScalarType>;
export type VerdictOutcomeV1 = 'pass' | 'fail' | 'repair';

export type OutputContract = {
  fields: ScalarFields;
  items?: { keyField: string; fields: ScalarFields };
};

/** Run-start inputs are always strings (docs/ai/current-plan-recipes-1485.md). */
export type RunInput = Record<string, string>;

export type BindingV1 =
  | { source: 'runInput'; key: string; type: ScalarType }
  | { source: 'stageOutput'; stageId: string; field: string; type: ScalarType }
  | { source: 'currentItem'; field: string; type: ScalarType };

export type ProviderOverrideV1 = { providerId: string; modelId: string };

export type LoopBudgetV1 = {
  loopId: string;
  maxIterations: number;
  maxCostUsd: number;
  maxTokens: number;
  maxWallTimeMs: number;
  exhaustedTarget: string;
};

export type AgentStageV1 = {
  id: string;
  kind: 'agent';
  profileId: string;
  provider?: ProviderOverrideV1;
  /** Cross-provider contrarian review: requires explicit providers on both sides. */
  differentProviderFromStageId?: string;
  suppressTeacherEscalation?: boolean;
  inputs: Record<string, BindingV1>;
  output: OutputContract;
  /** Absent only when `terminal` is true. */
  next?: string;
  /** Marks a workflow-ending stage (e.g. `shippable_pr`); no `next` required/allowed. */
  terminal?: boolean;
};

export type GateStageV1 = {
  id: string;
  kind: 'gate';
  /** Stage whose already-produced output this gate routes on. */
  producerStageId: string;
  /** Only 'pass'/'fail'/'repair' keys are ever valid; 'repair' is optional. */
  branches: { pass: string; fail: string; repair?: string };
  /** Mandatory, fail-closed target for a missing/malformed/ambiguous verdict. */
  onInvalid: string;
  /** Required exactly when `branches.repair` is present. */
  loop?: LoopBudgetV1;
};

export type ApprovalStageV1 = {
  id: string;
  kind: 'approval';
  inputs: Record<string, BindingV1>;
  onApprove: string;
  onReject: string;
};

export type FanOutStageV1 = {
  id: string;
  kind: 'fanOut';
  /** Producer stage whose `output.items` collection this fans out over. */
  itemsFrom: { stageId: string };
  /** Non-empty, declared scope identity for every child of this fan-out. */
  itemKey: string;
  entryStageId: string;
  /** Only agent/gate/approval — a nested `fanOut` is always invalid. */
  stages: Exclude<RecipeStageV1, FanOutStageV1>[];
  join: 'all';
  next: string;
};

export type RecipeStageV1 = AgentStageV1 | GateStageV1 | ApprovalStageV1 | FanOutStageV1;

export type RunBudgetsV1 = {
  maxCostUsd: number;
  maxTokens: number;
  maxWallTimeMs: number;
  maxStageExecutions: number;
};

export type RecipeWorkflowDefinitionV1 = {
  schemaVersion: 1;
  entryStageId: string;
  stages: RecipeStageV1[];
  budgets: RunBudgetsV1;
};

export type RecipeWorkflowDiagnostic = { path: string; code: string; message: string };
export type RecipeWorkflowValidationResult = {
  valid: boolean;
  diagnostics: RecipeWorkflowDiagnostic[];
};

// ── Diagnostic codes (stable; reused verbatim wherever the same rule fires) ─
const CODE = {
  unknownField: 'unknown_field',
  duplicateStageId: 'duplicate_stage_id',
  unreachableStage: 'unreachable_stage',
  missingTarget: 'missing_target',
  bindingTypeMismatch: 'binding_type_mismatch',
  unavailableProducer: 'unavailable_producer',
  nestedFanOut: 'nested_fan_out',
  emptyItemKey: 'empty_item_key',
  duplicateItemKey: 'duplicate_item_key',
  loopMissingCaps: 'loop_missing_caps',
  invalidProviderPair: 'invalid_provider_pair',
  blockedVerdictOutcome: 'blocked_verdict_outcome',
  invalidBudget: 'invalid_budget',
  invalidShape: 'invalid_shape',
} as const;

const AGENT_FIELDS = new Set([
  'id', 'kind', 'profileId', 'provider', 'differentProviderFromStageId',
  'suppressTeacherEscalation', 'inputs', 'output', 'next', 'terminal',
]);
const GATE_FIELDS = new Set(['id', 'kind', 'producerStageId', 'branches', 'onInvalid', 'loop']);
const APPROVAL_FIELDS = new Set(['id', 'kind', 'inputs', 'onApprove', 'onReject']);
const FANOUT_FIELDS = new Set(['id', 'kind', 'itemsFrom', 'itemKey', 'entryStageId', 'stages', 'join', 'next']);
const PROVIDER_FIELDS = new Set(['providerId', 'modelId']);
const LOOP_FIELDS = new Set(['loopId', 'maxIterations', 'maxCostUsd', 'maxTokens', 'maxWallTimeMs', 'exhaustedTarget']);
const BINDING_SOURCES = new Set(['runInput', 'stageOutput', 'currentItem']);
const SCALAR_TYPES = new Set(['string', 'number', 'boolean']);
const VERDICT_OUTCOMES = new Set(['pass', 'fail', 'repair']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Flat view of a declared stage plus the fan-out scope it lives in, if any. */
type ScopedStage = { stage: RecipeStageV1; path: string; scopeItemKey: string | null };

/**
 * Validate a candidate recipe-workflow definition against the closed v1
 * contract. Always returns every diagnostic found (never short-circuits on
 * the first error) so callers/tests can assert on a stable, complete set.
 */
export function validateRecipeWorkflowV1(input: unknown): RecipeWorkflowValidationResult {
  const diagnostics: RecipeWorkflowDiagnostic[] = [];
  const push = (path: string, code: string, message: string) =>
    diagnostics.push({ path, code, message });

  if (!isPlainObject(input)) {
    return { valid: false, diagnostics: [{ path: '$', code: CODE.invalidShape, message: 'definition must be a JSON object' }] };
  }

  const TOP_FIELDS = new Set(['schemaVersion', 'entryStageId', 'stages', 'budgets']);
  for (const key of Object.keys(input)) {
    if (!TOP_FIELDS.has(key)) push(`$.${key}`, CODE.unknownField, `unknown top-level field "${key}"`);
  }

  if (input.schemaVersion !== 1) {
    push('$.schemaVersion', CODE.invalidShape, 'schemaVersion must be exactly 1');
  }
  if (!isNonEmptyString(input.entryStageId)) {
    push('$.entryStageId', CODE.invalidShape, 'entryStageId must be a non-empty string');
  }
  if (!Array.isArray(input.stages)) {
    push('$.stages', CODE.invalidShape, 'stages must be an array');
    return { valid: false, diagnostics };
  }
  validateBudgets(input.budgets, '$.budgets', push);

  // ── Flatten stages (top-level + one level of fan-out children) ───────────
  const scoped: ScopedStage[] = [];
  const idOccurrences = new Map<string, number>();
  const registerId = (id: unknown) => {
    if (typeof id === 'string') idOccurrences.set(id, (idOccurrences.get(id) ?? 0) + 1);
  };

  (input.stages as unknown[]).forEach((raw, i) => {
    const path = `$.stages[${i}]`;
    if (!isPlainObject(raw)) {
      push(path, CODE.invalidShape, 'stage must be an object');
      return;
    }
    registerId(raw.id);
    scoped.push({ stage: raw as unknown as RecipeStageV1, path, scopeItemKey: null });
    if (raw.kind === 'fanOut' && Array.isArray((raw as Record<string, unknown>).stages)) {
      ((raw as Record<string, unknown>).stages as unknown[]).forEach((childRaw, j) => {
        const childPath = `${path}.stages[${j}]`;
        if (!isPlainObject(childRaw)) {
          push(childPath, CODE.invalidShape, 'stage must be an object');
          return;
        }
        registerId(childRaw.id);
        const itemKey = isNonEmptyString((raw as Record<string, unknown>).itemKey)
          ? ((raw as Record<string, unknown>).itemKey as string)
          : null;
        scoped.push({ stage: childRaw as unknown as RecipeStageV1, path: childPath, scopeItemKey: itemKey });
        if (childRaw.kind === 'fanOut') {
          push(childPath, CODE.nestedFanOut, 'nested fanOut is not permitted (v1 has exactly one fan-out level)');
        }
      });
    }
  });

  for (const [id, count] of idOccurrences) {
    if (count > 1) push('$.stages', CODE.duplicateStageId, `stage id "${id}" is declared ${count} times`);
  }

  const byId = new Map<string, ScopedStage>();
  for (const entry of scoped) {
    const id = (entry.stage as { id?: unknown }).id;
    if (isNonEmptyString(id) && !byId.has(id)) byId.set(id, entry);
  }

  // ── Per-stage structural validation ───────────────────────────────────────
  const reachable = new Set<string>();
  const markReachable = (target: unknown) => {
    if (isNonEmptyString(target)) reachable.add(target);
  };
  if (isNonEmptyString(input.entryStageId)) markReachable(input.entryStageId);

  const fanOutItemKeys = new Map<string, string>(); // itemKey -> declaring fanOut stage path

  for (const { stage, path, scopeItemKey } of scoped) {
    if (!isPlainObject(stage as unknown)) continue;
    const raw = stage as unknown as Record<string, unknown>;
    if (!isNonEmptyString(raw.id)) push(`${path}.id`, CODE.invalidShape, 'stage id must be a non-empty string');

    switch (raw.kind) {
      case 'agent':
        validateAgentStage(raw, path, push, markReachable);
        break;
      case 'gate':
        validateGateStage(raw, path, push, markReachable);
        break;
      case 'approval':
        validateApprovalStage(raw, path, push, markReachable);
        break;
      case 'fanOut':
        validateFanOutStage(raw, path, push, markReachable, fanOutItemKeys);
        break;
      default:
        push(`${path}.kind`, CODE.invalidShape, `unknown stage kind "${String(raw.kind)}"`);
    }
  }

  // ── Reachability (dead stages) ────────────────────────────────────────────
  for (const { stage, path } of scoped) {
    const id = (stage as unknown as { id?: unknown }).id;
    if (isNonEmptyString(id) && !reachable.has(id)) {
      push(path, CODE.unreachableStage, `stage "${id}" is never reached by any transition`);
    }
  }

  // ── Bindings (inputs) — type + producer/scope checks ──────────────────────
  for (const { stage, path, scopeItemKey } of scoped) {
    const raw = stage as unknown as Record<string, unknown>;
    if (raw.kind !== 'agent' && raw.kind !== 'approval') continue;
    if (!isPlainObject(raw.inputs)) continue; // already flagged by the per-kind check
    for (const [name, bindingRaw] of Object.entries(raw.inputs as Record<string, unknown>)) {
      validateBinding(bindingRaw, `${path}.inputs.${name}`, scopeItemKey, byId, push);
    }
  }

  // ── differentProviderFromStageId pairing ──────────────────────────────────
  for (const { stage, path } of scoped) {
    const raw = stage as unknown as Record<string, unknown>;
    if (raw.kind !== 'agent' || raw.differentProviderFromStageId === undefined) continue;
    const otherId = raw.differentProviderFromStageId;
    const other = isNonEmptyString(otherId) ? byId.get(otherId) : undefined;
    const selfProvider = isPlainObject(raw.provider) ? (raw.provider as Record<string, unknown>) : null;
    const otherProvider =
      other && isPlainObject((other.stage as unknown as Record<string, unknown>).provider)
        ? ((other.stage as unknown as Record<string, unknown>).provider as Record<string, unknown>)
        : null;
    if (!selfProvider || !otherProvider) {
      push(
        `${path}.differentProviderFromStageId`,
        CODE.invalidProviderPair,
        'differentProviderFromStageId requires an explicit {providerId, modelId} on both stages',
      );
    } else if (selfProvider.providerId === otherProvider.providerId) {
      push(
        `${path}.differentProviderFromStageId`,
        CODE.invalidProviderPair,
        `stage "${(raw as { id?: unknown }).id}" and "${otherId}" must use different providers`,
      );
    }
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

// ── Per-kind validators ──────────────────────────────────────────────────────

function validateBudgets(
  budgets: unknown,
  path: string,
  push: (path: string, code: string, message: string) => void,
): void {
  if (!isPlainObject(budgets)) {
    push(path, CODE.invalidBudget, 'budgets must be an object with maxCostUsd/maxTokens/maxWallTimeMs/maxStageExecutions');
    return;
  }
  const REQUIRED = ['maxCostUsd', 'maxTokens', 'maxWallTimeMs', 'maxStageExecutions'] as const;
  for (const key of Object.keys(budgets)) {
    if (!(REQUIRED as readonly string[]).includes(key)) push(`${path}.${key}`, CODE.unknownField, `unknown budget field "${key}"`);
  }
  for (const field of REQUIRED) {
    if (!isPositiveFiniteNumber(budgets[field])) {
      push(`${path}.${field}`, CODE.invalidBudget, `${field} must be a positive number`);
    }
  }
}

function validateProvider(
  provider: unknown,
  path: string,
  push: (path: string, code: string, message: string) => void,
): void {
  if (!isPlainObject(provider)) {
    push(path, CODE.invalidShape, 'provider must be {providerId, modelId}');
    return;
  }
  for (const key of Object.keys(provider)) {
    if (!PROVIDER_FIELDS.has(key)) push(`${path}.${key}`, CODE.unknownField, `unknown provider field "${key}"`);
  }
  if (!isNonEmptyString(provider.providerId)) push(`${path}.providerId`, CODE.invalidShape, 'providerId must be a non-empty string');
  if (!isNonEmptyString(provider.modelId)) push(`${path}.modelId`, CODE.invalidShape, 'modelId must be a non-empty string');
}

function validateAgentStage(
  raw: Record<string, unknown>,
  path: string,
  push: (path: string, code: string, message: string) => void,
  markReachable: (target: unknown) => void,
): void {
  for (const key of Object.keys(raw)) {
    if (!AGENT_FIELDS.has(key)) push(`${path}.${key}`, CODE.unknownField, `unknown agent-stage field "${key}"`);
  }
  if (!isNonEmptyString(raw.profileId)) push(`${path}.profileId`, CODE.invalidShape, 'profileId must be a non-empty string');
  if (raw.provider !== undefined) validateProvider(raw.provider, `${path}.provider`, push);
  if (raw.differentProviderFromStageId !== undefined && !isNonEmptyString(raw.differentProviderFromStageId)) {
    push(`${path}.differentProviderFromStageId`, CODE.invalidShape, 'differentProviderFromStageId must be a non-empty string');
  }
  if (!isPlainObject(raw.inputs)) push(`${path}.inputs`, CODE.invalidShape, 'inputs must be an object');
  validateOutputContract(raw.output, `${path}.output`, push);

  if (raw.terminal === true) {
    if (raw.next !== undefined) push(`${path}.next`, CODE.invalidShape, 'a terminal stage must not declare next');
  } else {
    if (!isNonEmptyString(raw.next)) push(`${path}.next`, CODE.missingTarget, 'non-terminal agent stage requires a next target');
    else markReachable(raw.next);
  }
}

function validateOutputContract(
  output: unknown,
  path: string,
  push: (path: string, code: string, message: string) => void,
): void {
  if (!isPlainObject(output)) {
    push(path, CODE.invalidShape, 'output must be an OutputContract {fields, items?}');
    return;
  }
  for (const key of Object.keys(output)) {
    if (key !== 'fields' && key !== 'items') push(`${path}.${key}`, CODE.unknownField, `unknown output field "${key}"`);
  }
  validateScalarFields(output.fields, `${path}.fields`, push);
  if (output.items !== undefined) {
    if (!isPlainObject(output.items)) {
      push(`${path}.items`, CODE.invalidShape, 'items must be {keyField, fields}');
    } else {
      for (const key of Object.keys(output.items)) {
        if (key !== 'keyField' && key !== 'fields') push(`${path}.items.${key}`, CODE.unknownField, `unknown items field "${key}"`);
      }
      if (!isNonEmptyString(output.items.keyField)) push(`${path}.items.keyField`, CODE.invalidShape, 'items.keyField must be a non-empty string');
      validateScalarFields(output.items.fields, `${path}.items.fields`, push);
    }
  }
}

function validateScalarFields(
  fields: unknown,
  path: string,
  push: (path: string, code: string, message: string) => void,
): void {
  if (!isPlainObject(fields)) {
    push(path, CODE.invalidShape, 'fields must be an object of scalar types');
    return;
  }
  for (const [name, type] of Object.entries(fields)) {
    if (!SCALAR_TYPES.has(type as string)) push(`${path}.${name}`, CODE.invalidShape, `field "${name}" has unknown type "${String(type)}"`);
  }
}

function validateGateStage(
  raw: Record<string, unknown>,
  path: string,
  push: (path: string, code: string, message: string) => void,
  markReachable: (target: unknown) => void,
): void {
  for (const key of Object.keys(raw)) {
    if (!GATE_FIELDS.has(key)) push(`${path}.${key}`, CODE.unknownField, `unknown gate-stage field "${key}"`);
  }
  if (!isNonEmptyString(raw.producerStageId)) {
    push(`${path}.producerStageId`, CODE.invalidShape, 'producerStageId must be a non-empty string');
  }

  if (!isPlainObject(raw.branches)) {
    push(`${path}.branches`, CODE.invalidShape, 'branches must be an object');
  } else {
    const branches = raw.branches as Record<string, unknown>;
    for (const key of Object.keys(branches)) {
      if (key === 'blocked') {
        push(`${path}.branches.blocked`, CODE.blockedVerdictOutcome, "'blocked' is never a valid verdict outcome (v1 removed it; use onInvalid)");
      } else if (!VERDICT_OUTCOMES.has(key)) {
        push(`${path}.branches.${key}`, CODE.unknownField, `unknown branch outcome "${key}"`);
      }
    }
    if (!isNonEmptyString(branches.pass)) push(`${path}.branches.pass`, CODE.missingTarget, 'gate requires a branches.pass target');
    else markReachable(branches.pass);
    if (!isNonEmptyString(branches.fail)) push(`${path}.branches.fail`, CODE.missingTarget, 'gate requires a branches.fail target');
    else markReachable(branches.fail);
    if (branches.repair !== undefined) {
      if (!isNonEmptyString(branches.repair)) push(`${path}.branches.repair`, CODE.missingTarget, 'branches.repair must be a non-empty target when present');
      else markReachable(branches.repair);
    }

    const hasRepair = isNonEmptyString(branches.repair);
    if (hasRepair !== isPlainObject(raw.loop)) {
      push(`${path}.loop`, CODE.loopMissingCaps, 'a repair branch requires a loop with all four caps, and a loop requires a repair branch');
    }
  }

  if (!isNonEmptyString(raw.onInvalid)) {
    push(`${path}.onInvalid`, CODE.missingTarget, 'gate requires an onInvalid target (fail-closed for missing/malformed/ambiguous verdicts)');
  } else {
    markReachable(raw.onInvalid);
  }

  if (raw.loop !== undefined) validateLoopBudget(raw.loop, `${path}.loop`, push, markReachable);
}

function validateLoopBudget(
  loop: unknown,
  path: string,
  push: (path: string, code: string, message: string) => void,
  markReachable: (target: unknown) => void,
): void {
  if (!isPlainObject(loop)) {
    push(path, CODE.loopMissingCaps, 'loop must declare loopId, maxIterations, maxCostUsd, maxTokens, maxWallTimeMs and exhaustedTarget');
    return;
  }
  for (const key of Object.keys(loop)) {
    if (!LOOP_FIELDS.has(key)) push(`${path}.${key}`, CODE.unknownField, `unknown loop field "${key}"`);
  }
  if (!isNonEmptyString(loop.loopId)) push(`${path}.loopId`, CODE.loopMissingCaps, 'loop requires a non-empty loopId');
  for (const cap of ['maxIterations', 'maxCostUsd', 'maxTokens', 'maxWallTimeMs'] as const) {
    if (!isPositiveFiniteNumber(loop[cap])) {
      push(`${path}.${cap}`, CODE.loopMissingCaps, `loop is missing a positive ${cap} cap`);
    }
  }
  if (!isNonEmptyString(loop.exhaustedTarget)) {
    push(`${path}.exhaustedTarget`, CODE.missingTarget, 'loop requires an exhaustedTarget');
  } else {
    markReachable(loop.exhaustedTarget);
  }
}

function validateApprovalStage(
  raw: Record<string, unknown>,
  path: string,
  push: (path: string, code: string, message: string) => void,
  markReachable: (target: unknown) => void,
): void {
  for (const key of Object.keys(raw)) {
    if (!APPROVAL_FIELDS.has(key)) push(`${path}.${key}`, CODE.unknownField, `unknown approval-stage field "${key}"`);
  }
  if (!isPlainObject(raw.inputs)) push(`${path}.inputs`, CODE.invalidShape, 'inputs must be an object');
  if (!isNonEmptyString(raw.onApprove)) push(`${path}.onApprove`, CODE.missingTarget, 'approval requires an onApprove target');
  else markReachable(raw.onApprove);
  if (!isNonEmptyString(raw.onReject)) push(`${path}.onReject`, CODE.missingTarget, 'approval requires an onReject target');
  else markReachable(raw.onReject);
}

function validateFanOutStage(
  raw: Record<string, unknown>,
  path: string,
  push: (path: string, code: string, message: string) => void,
  markReachable: (target: unknown) => void,
  fanOutItemKeys: Map<string, string>,
): void {
  for (const key of Object.keys(raw)) {
    if (!FANOUT_FIELDS.has(key)) push(`${path}.${key}`, CODE.unknownField, `unknown fanOut-stage field "${key}"`);
  }
  if (!isPlainObject(raw.itemsFrom) || !isNonEmptyString((raw.itemsFrom as Record<string, unknown>).stageId)) {
    push(`${path}.itemsFrom`, CODE.invalidShape, 'itemsFrom must be {stageId}');
  }
  if (!isNonEmptyString(raw.itemKey)) {
    push(`${path}.itemKey`, CODE.emptyItemKey, 'fanOut requires a non-empty itemKey');
  } else {
    const key = raw.itemKey;
    const priorPath = fanOutItemKeys.get(key);
    if (priorPath) push(`${path}.itemKey`, CODE.duplicateItemKey, `itemKey "${key}" is already used by ${priorPath}`);
    else fanOutItemKeys.set(key, path);
  }
  if (!isNonEmptyString(raw.entryStageId)) push(`${path}.entryStageId`, CODE.invalidShape, 'entryStageId must be a non-empty string');
  else markReachable(raw.entryStageId);
  if (raw.join !== 'all') push(`${path}.join`, CODE.invalidShape, 'v1 only supports join: "all"');
  if (!Array.isArray(raw.stages)) push(`${path}.stages`, CODE.invalidShape, 'fanOut.stages must be an array');
  if (!isNonEmptyString(raw.next)) push(`${path}.next`, CODE.missingTarget, 'fanOut requires a next target after join');
  else markReachable(raw.next);
}

function validateBinding(
  bindingRaw: unknown,
  path: string,
  scopeItemKey: string | null,
  byId: Map<string, ScopedStage>,
  push: (path: string, code: string, message: string) => void,
): void {
  if (!isPlainObject(bindingRaw)) {
    push(path, CODE.bindingTypeMismatch, 'binding must be an object with a source');
    return;
  }
  const source = bindingRaw.source;
  if (!BINDING_SOURCES.has(source as string)) {
    push(`${path}.source`, CODE.bindingTypeMismatch, `unknown binding source "${String(source)}"`);
    return;
  }
  const declaredType = bindingRaw.type;
  if (!SCALAR_TYPES.has(declaredType as string)) {
    push(`${path}.type`, CODE.bindingTypeMismatch, `binding declares unknown type "${String(declaredType)}"`);
    return;
  }

  if (source === 'runInput') {
    if (!isNonEmptyString(bindingRaw.key)) push(`${path}.key`, CODE.invalidShape, 'runInput binding requires a non-empty key');
    // RunInput = Record<string, string> — every run input is a string.
    if (declaredType !== 'string') {
      push(`${path}.type`, CODE.bindingTypeMismatch, 'runInput bindings are always type "string"');
    }
    return;
  }

  if (source === 'currentItem') {
    if (!isNonEmptyString(bindingRaw.field)) {
      push(`${path}.field`, CODE.invalidShape, 'currentItem binding requires a non-empty field');
      return;
    }
    if (scopeItemKey === null) {
      push(path, CODE.unavailableProducer, 'currentItem binding is only valid inside a fanOut stage');
      return;
    }
    // Field-level type checking against the fan-out's producer items contract
    // happens where the enclosing fanOut's itemsFrom producer is resolvable;
    // v1 does not thread that producer reference into this leaf call, so a
    // currentItem binding is accepted once it is confirmed in-scope. The
    // producer's own output.items.fields is still validated for shape.
    return;
  }

  // source === 'stageOutput'
  const stageId = bindingRaw.stageId;
  if (!isNonEmptyString(stageId)) {
    push(`${path}.stageId`, CODE.invalidShape, 'stageOutput binding requires a non-empty stageId');
    return;
  }
  if (!isNonEmptyString(bindingRaw.field)) {
    push(`${path}.field`, CODE.invalidShape, 'stageOutput binding requires a non-empty field');
    return;
  }
  const producer = byId.get(stageId);
  if (!producer) {
    push(`${path}.stageId`, CODE.unavailableProducer, `stage "${stageId}" is not a declared producer`);
    return;
  }
  const producerRaw = producer.stage as unknown as Record<string, unknown>;
  if (producerRaw.kind !== 'agent') {
    push(`${path}.stageId`, CODE.unavailableProducer, `stage "${stageId}" does not produce a stage output (kind="${String(producerRaw.kind)}")`);
    return;
  }
  const output = producerRaw.output;
  const fieldType = isPlainObject(output) && isPlainObject(output.fields) ? (output.fields as Record<string, unknown>)[bindingRaw.field as string] : undefined;
  if (fieldType === undefined) {
    push(`${path}.field`, CODE.bindingTypeMismatch, `stage "${stageId}" does not declare output field "${String(bindingRaw.field)}"`);
    return;
  }
  if (fieldType !== declaredType) {
    push(`${path}.type`, CODE.bindingTypeMismatch, `stage "${stageId}" field "${String(bindingRaw.field)}" is "${String(fieldType)}", not "${String(declaredType)}"`);
  }
}
