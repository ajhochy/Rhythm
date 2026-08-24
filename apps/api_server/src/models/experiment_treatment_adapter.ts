/**
 * C2 — the closed ExperimentTreatmentAdapter registry (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C2).
 *
 * `system-prompt-v1` is the first and only shipped adapter: a strict
 * refine-config spec targeting `system_prompt` on one exact AgentConfig. The
 * shape is closed by exact key-set comparison, mirroring EXPERIMENT_ADAPTERS'
 * (proposal_evidence_bundle.ts) fail-closed-on-unknown-shape pattern — an
 * extra/smuggled key is a validation failure, never a silently-ignored field.
 */

export interface SystemPromptV1TreatmentSpec {
  agentConfigId: string;
  field: 'system_prompt';
  priorValue: string;
  currentValue: string;
  candidateValue: string;
  evidenceTarget: { ref: string; hash: string };
}

export type TreatmentSpecValidation =
  | { valid: true; spec: SystemPromptV1TreatmentSpec }
  | { valid: false; reasons: string[] };

const SPEC_KEYS = ['agentConfigId', 'candidateValue', 'currentValue', 'evidenceTarget', 'field', 'priorValue'];
const EVIDENCE_TARGET_KEYS = ['hash', 'ref'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateSystemPromptV1Spec(input: unknown): TreatmentSpecValidation {
  if (!isPlainObject(input)) {
    return { valid: false, reasons: ['the treatment spec must be a JSON object'] };
  }

  const reasons: string[] = [];

  const extraKeys = Object.keys(input).filter((k) => !SPEC_KEYS.includes(k));
  if (extraKeys.length > 0) {
    reasons.push(`unsupported/smuggled key(s): ${extraKeys.sort().join(', ')}`);
  }

  if (!nonEmptyString(input.agentConfigId)) {
    reasons.push('agentConfigId must name the exact AgentConfig target');
  }
  if (input.field !== 'system_prompt') {
    reasons.push(`field must be 'system_prompt' (got '${String(input.field)}')`);
  }
  if (typeof input.priorValue !== 'string') reasons.push('priorValue must be a string');
  if (typeof input.currentValue !== 'string') reasons.push('currentValue must be a string');
  if (typeof input.candidateValue !== 'string') reasons.push('candidateValue must be a string');

  const target = input.evidenceTarget;
  if (!isPlainObject(target)) {
    reasons.push('evidenceTarget must be an object carrying { ref, hash }');
  } else {
    const targetExtras = Object.keys(target).filter((k) => !EVIDENCE_TARGET_KEYS.includes(k));
    if (targetExtras.length > 0) {
      reasons.push(`evidenceTarget carries unsupported/smuggled key(s): ${targetExtras.sort().join(', ')}`);
    }
    if (!nonEmptyString(target.ref)) reasons.push('evidenceTarget.ref must name what the change touches');
    if (!nonEmptyString(target.hash)) reasons.push('evidenceTarget.hash must pin the exact bytes the spec was built against');
  }

  if (reasons.length > 0) return { valid: false, reasons };
  return { valid: true, spec: input as unknown as SystemPromptV1TreatmentSpec };
}

export interface TreatmentAdapter {
  name: string;
  validate: (input: unknown) => TreatmentSpecValidation;
}

/** The CLOSED registry. system-prompt-v1 is the only shippable treatment family. */
export const TREATMENT_ADAPTERS: Record<string, TreatmentAdapter> = {
  'system-prompt-v1': { name: 'system-prompt-v1', validate: validateSystemPromptV1Spec },
};

/**
 * The exact effective system prompt a cohort receives at prompt dispatch.
 * Baseline gets the exact pre-change value; candidate gets the exact
 * proposed value — never priorValue, which exists only for revert.
 */
export function resolveEffectiveSystemPrompt(
  spec: SystemPromptV1TreatmentSpec,
  cohort: 'baseline' | 'candidate',
): string {
  return cohort === 'baseline' ? spec.currentValue : spec.candidateValue;
}

/**
 * C2-B — the strict `refine-config` proposal `changeJson` shape a
 * reservable/preparable system-prompt-v1 treatment must be backed by.
 *
 * Deliberately narrower than the general refine-config applier's accepted
 * changeJson (which may also carry `diagnosis`/`concreteFix`/etc for human
 * review): a proposal that backs a running experiment's treatment must have
 * an unambiguous, minimal payload — outer `configPatch` only, inner exactly
 * `{ agentConfigId, field, value }` — so no smuggled key can ever influence
 * what gets dispatched as an "exact" candidate/baseline prompt.
 */
export interface RefineConfigChangePatch {
  agentConfigId: string;
  field: 'system_prompt';
  value: string;
}

export type RefineConfigChangeValidation =
  | { valid: true; patch: RefineConfigChangePatch }
  | { valid: false; reasons: string[] };

const CHANGE_JSON_KEYS = ['configPatch'];
const CONFIG_PATCH_KEYS = ['agentConfigId', 'field', 'value'];

export function validateStrictRefineConfigChange(input: unknown): RefineConfigChangeValidation {
  if (!isPlainObject(input)) {
    return { valid: false, reasons: ['the change payload must be a JSON object'] };
  }

  const reasons: string[] = [];

  const extraKeys = Object.keys(input).filter((k) => !CHANGE_JSON_KEYS.includes(k));
  if (extraKeys.length > 0) {
    reasons.push(`unsupported/smuggled key(s): ${extraKeys.sort().join(', ')}`);
  }

  const patch = input.configPatch;
  if (!isPlainObject(patch)) {
    reasons.push('configPatch must be an object carrying { agentConfigId, field, value }');
    return { valid: false, reasons };
  }

  const patchExtras = Object.keys(patch).filter((k) => !CONFIG_PATCH_KEYS.includes(k));
  if (patchExtras.length > 0) {
    reasons.push(`configPatch carries unsupported/smuggled key(s): ${patchExtras.sort().join(', ')}`);
  }
  if (!nonEmptyString(patch.agentConfigId)) {
    reasons.push('configPatch.agentConfigId must name the exact AgentConfig target');
  }
  if (patch.field !== 'system_prompt') {
    reasons.push(`configPatch.field must be 'system_prompt' (got '${String(patch.field)}')`);
  }
  if (typeof patch.value !== 'string') {
    reasons.push('configPatch.value must be a string');
  }

  if (reasons.length > 0) return { valid: false, reasons };
  return { valid: true, patch: patch as unknown as RefineConfigChangePatch };
}
