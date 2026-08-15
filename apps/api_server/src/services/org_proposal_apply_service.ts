/**
 * Org proposal apply service (#826 / org-optimizer-10).
 *
 * Approve on the human-gate review queue must run "the matching generator's
 * apply step (the same code the auto path would run, but only after explicit
 * human consent)" per the decision doc. As of this issue, none of the
 * per-kind generators (org-optimizer-06 through 09, 12, 13) exist yet — this
 * module provides the pluggable seam they will register into, plus the two
 * gate checks and re-validation step this issue's acceptance criteria require
 * today:
 *
 *   - `requiresSecurityNote(proposal)` — true for `external-adoption` (needs
 *     `provenanceJson`: source/stars/downloads/last-updated/maintainer/
 *     license/install-cmd) and `webhook-wiring` (needs `provenanceJson`
 *     carrying the security note: trigger source/event, target agent/recipe +
 *     scope, HMAC setup, SSRF/allowlist, fencing confirmation). Both gate
 *     approval on presence of a non-empty `provenanceJson` — the review UI is
 *     a UX aid; this predicate is the real gate (#827 safety note).
 *   - `validateProposalChange(proposal)` — kind-specific re-validation run at
 *     apply time, never at proposal time, so a change that was valid when
 *     proposed but has since drifted (e.g. references a name no longer live)
 *     is refused rather than silently applied. Fails CLOSED: an unknown kind
 *     with no registered validator is refused, not passed through.
 *   - `applyProposal(proposal)` — runs the registered apply step for the
 *     proposal's kind. Until a generator lands (org-optimizer-06..09,12,13),
 *     the default apply step is a no-op that only advances status — there is
 *     no bespoke privileged write here; those writes land inside each
 *     generator's own apply function per the decision doc's safety
 *     invariant #6 ("writes happen in the server-side apply step behind the
 *     queue, not from the agent's tool surface"). Kinds are registered via
 *     {@link registerProposalApplier} so future generator issues plug in
 *     without touching this file's control flow.
 */

import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { containsScopeBearingPayload } from './scope_mutation_contract';
import { parseStrictJson } from './strict_json';

export interface ProposalValidationResult {
  valid: boolean;
  reason?: string;
}

export type ProposalValidator = (
  proposal: AgentOrgProposal,
) => ProposalValidationResult | Promise<ProposalValidationResult>;

export interface ProposalApplyResult {
  /** Whether the applied change is measurable (advances to 'measuring') or terminal ('applied' stays). */
  measurable: boolean;
  /** Snapshot of prior state for rollback — stored as before_snapshot_json. */
  beforeSnapshotJson?: string;
  /**
   * Optional reshaped `change_json` the applier wants persisted alongside the
   * `applied` transition. Used by the workflow-prompt-fix applier (#971) to
   * rewrite a prose diagnosis into the `BodyRefinementChange` shape the measure
   * step reads. Undefined leaves `change_json` untouched (the common case).
   */
  changeJson?: string;
  /**
   * Optional target mutation deferred until the controller has atomically
   * claimed the proposal and durably stored beforeSnapshotJson. Scope
   * mutations use this to make an unsnapshotted mutation impossible; existing
   * non-scope eager appliers remain source-compatible.
   */
  applyAfterClaim?: () => void | Promise<void>;
}

export type ProposalApplier = (
  proposal: AgentOrgProposal,
) => ProposalApplyResult | Promise<ProposalApplyResult>;

const KINDS_REQUIRING_SECURITY_NOTE = new Set(['external-adoption', 'webhook-wiring']);

/**
 * True when `proposal.kind` is one of the two kinds the decision doc requires
 * a mandatory provenance/security note for before approval is permitted.
 */
export function requiresSecurityNote(proposal: Pick<AgentOrgProposal, 'kind'>): boolean {
  return KINDS_REQUIRING_SECURITY_NOTE.has(proposal.kind);
}

/**
 * Returns true iff `provenanceJson` is present and is non-empty, parseable
 * JSON with at least one key. An empty object or blank string does not
 * satisfy the gate — the note must actually carry content.
 */
export function hasSecurityNote(proposal: Pick<AgentOrgProposal, 'provenanceJson'>): boolean {
  const raw = proposal.provenanceJson;
  if (!raw || !raw.trim()) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed as Record<string, unknown>).length > 0
    );
  } catch {
    return false;
  }
}

// ── Kind-specific validators (re-run at apply time, never trusted from proposal time) ──

const validators: Record<string, ProposalValidator> = {};

/** Test/generator seam: register a validator for a proposal kind. */
export function registerProposalValidator(kind: string, validator: ProposalValidator): void {
  validators[kind] = validator;
}

/** Test-only: clear all registered validators/appliers back to defaults. */
export function resetProposalPluginsForTests(): void {
  for (const key of Object.keys(validators)) delete validators[key];
  for (const key of Object.keys(appliers)) delete appliers[key];
}

function parseChangeJson(proposal: AgentOrgProposal): Record<string, unknown> | null {
  if (!proposal.changeJson) return null;
  try {
    const parsed: unknown = JSON.parse(proposal.changeJson);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Default validator for `create-agent`: the change payload must at minimum
 * name the agent slug it would create. This stands in for the fuller
 * "names ⊆ live" check org-optimizer-08 will implement once it exists.
 */
function validateCreateAgent(proposal: AgentOrgProposal): ProposalValidationResult {
  const change = parseChangeJson(proposal);
  const agentSlug = change?.agentSlug;
  if (typeof agentSlug !== 'string' || !agentSlug.trim()) {
    return { valid: false, reason: 'change_json.agentSlug is required to create an agent' };
  }
  return { valid: true };
}

/**
 * Default validator for `external-adoption`: requires both the security note
 * (checked separately by the approve gate) and a named target to adopt.
 */
function validateExternalAdoption(proposal: AgentOrgProposal): ProposalValidationResult {
  const change = parseChangeJson(proposal);
  const serverName = change?.serverName ?? change?.skillName ?? change?.packageName;
  if (typeof serverName !== 'string' || !serverName.trim()) {
    return {
      valid: false,
      reason: 'change_json must name the server/skill/package being adopted',
    };
  }
  return { valid: true };
}

/**
 * Default validator for `webhook-wiring`: requires a wiring target (recipe or
 * scheduled task) so approval never fires a webhook into nothing.
 */
function validateWebhookWiring(proposal: AgentOrgProposal): ProposalValidationResult {
  const change = parseChangeJson(proposal);
  const hasTarget =
    typeof change?.targetScheduledTaskId === 'string' ||
    typeof change?.targetRecipeId === 'string';
  if (!hasTarget) {
    return {
      valid: false,
      reason: 'change_json must specify targetScheduledTaskId or targetRecipeId',
    };
  }
  return { valid: true };
}

validators['create-agent'] = validateCreateAgent;
validators['external-adoption'] = validateExternalAdoption;
validators['webhook-wiring'] = validateWebhookWiring;

const SCOPE_PROPOSAL_KINDS = new Set([
  'tighten-scope',
  'prune-scope',
  'refine-scope',
  'broaden-scope',
]);
const PROTECTED_SCOPE_FIELDS = new Set([
  'allowedMcpsJson',
  'allowedSkillsJson',
  'corePermissionsJson',
]);

function strictChangeJsonPreflight(proposal: AgentOrgProposal): void {
  if (proposal.changeJson === null || proposal.changeJson === undefined) return;
  const parsed = parseStrictJson(proposal.changeJson, 'proposal change_json');
  if (SCOPE_PROPOSAL_KINDS.has(proposal.kind)) return;

  if (proposal.kind === 'refine-config') {
    const change = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    const configPatch = change?.configPatch;
    const field = configPatch && typeof configPatch === 'object' && !Array.isArray(configPatch)
      ? (configPatch as Record<string, unknown>).field
      : undefined;
    if (PROTECTED_SCOPE_FIELDS.has(String(field))) {
      throw new Error(`proposal kind 'refine-config' cannot mutate protected scope field '${String(field)}'`);
    }
    const outsideConfigPatch = change
      ? Object.fromEntries(Object.entries(change).filter(([key]) => key !== 'configPatch'))
      : parsed;
    if (containsScopeBearingPayload(outsideConfigPatch)) {
      throw new Error("proposal kind 'refine-config' cannot carry a protected scope mutation");
    }
    return;
  }

  if (containsScopeBearingPayload(parsed)) {
    throw new Error(`proposal kind '${proposal.kind}' cannot carry a protected scope mutation`);
  }
}

/**
 * Re-validate a proposal's `change_json` at apply time. Fail-closed: a kind
 * with no registered validator is refused (never silently applied) so a new
 * proposal `kind` added ahead of its generator/validator cannot slip through
 * approval unchecked.
 */
export async function validateProposalChange(
  proposal: AgentOrgProposal,
): Promise<ProposalValidationResult> {
  try {
    strictChangeJsonPreflight(proposal);
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : 'proposal change_json is invalid',
    };
  }
  const validator = validators[proposal.kind];
  if (!validator) {
    return {
      valid: false,
      reason: `No re-validation is registered for proposal kind '${proposal.kind}'`,
    };
  }
  return validator(proposal);
}

// ── Kind-specific appliers ──────────────────────────────────────────────────

const appliers: Record<string, ProposalApplier> = {};

/** Test/generator seam: register the apply step for a proposal kind. */
export function registerProposalApplier(kind: string, applier: ProposalApplier): void {
  appliers[kind] = applier;
}

/**
 * Default applier used for every kind until its dedicated generator
 * (org-optimizer-06..09, 12, 13) registers a real one. Performs no privileged
 * writes — the privileged writes (agent_configs, allowed_delegates_json,
 * agent_webhook_endpoints, external install) are explicitly deferred to each
 * generator's own apply step per the decision doc's safety invariant #6.
 * `measurable: false` because there is no per-kind metric to measure yet
 * without the generator; once a generator registers its own applier it
 * decides its own measurability.
 */
function defaultApplier(): ProposalApplyResult {
  return { measurable: false };
}

/**
 * Run the apply step for `proposal.kind`. Always re-validates immediately
 * before applying (defense-in-depth even though the controller already
 * calls {@link validateProposalChange} directly, so any future caller of
 * this function gets the same fail-closed guarantee).
 */
export async function applyProposal(proposal: AgentOrgProposal): Promise<ProposalApplyResult> {
  strictChangeJsonPreflight(proposal);
  const validation = await validateProposalChange(proposal);
  if (!validation.valid) {
    throw new Error(validation.reason ?? `Proposal ${proposal.id} failed re-validation`);
  }
  const applier = appliers[proposal.kind] ?? defaultApplier;
  return applier(proposal);
}
