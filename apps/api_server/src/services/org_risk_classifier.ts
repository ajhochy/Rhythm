/**
 * org_risk_classifier.ts — #820 (org-optimizer-04)
 *
 * `classifyProposalRisk` is the SINGLE SOURCE OF TRUTH for whether an
 * `agent_org_proposals` row auto-applies (low) or is human-gated (high). Both
 * the auto path (#821 org_proposal_apply.ts) and the review queue
 * (org-optimizer-10) must call THIS function — risk is never independently
 * decided anywhere else.
 *
 * Per docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §2, amended by
 * docs/ai/decisions/2026-07-02-autonomy-and-vault-intent.md (full autonomy
 * with rollback): reversible/narrowing kinds auto-apply behind measure/revert;
 * privilege-granting, expanding, inbound-surface, and external-code changes
 * are human-gated. The predicate DEFAULTS TO HIGH (fail-closed) — an unknown
 * or unlisted `kind` is never auto-applied.
 *
 * Pure function: no DB access, no IO, no network — deterministic given the
 * same input every time. This is a hard acceptance criterion (#820), not
 * incidental; the predicate must be safely callable from both the (fire-and-
 * forget) optimizer loop and synchronous request handlers without a DB
 * round-trip or the possibility of drifting between callers.
 *
 * The change-shape override (§ below) exists so a proposal's `kind` label
 * cannot be trusted blindly: even a proposal SELF-LABELED as a low-risk kind
 * is escalated to 'high' if its `changeJson` payload actually performs a
 * hard-ruled privileged mutation (delegation-graph write, agent_configs
 * INSERT, allowlist addition, webhook-endpoint create). This defends against
 * a buggy or malicious generator mislabeling its own proposal kind.
 */

/** Kinds that auto-apply behind measure/revert (proposed -> applied directly). */
const LOW_RISK_KINDS = new Set<string>([
  'refine-skill',
  'consolidate-skill',
  'tighten-scope',
  'prune-scope',
  'refine-recipe',
]);

/** Kinds that always stop in the human review queue. */
const HIGH_RISK_KINDS = new Set<string>([
  'create-agent',
  'grant-delegation',
  'expand-delegation',
  'broaden-scope',
  'create-recipe',
  'webhook-wiring',
  'external-adoption',
  // #981 — refine-task edits a scheduled-task definition (instructions/schedule/
  // agent binding). Always human-gated: a bad schedule/binding edit runs on a
  // cron, so it never auto-applies.
  'refine-task',
]);

/** Kinds whose review-queue UI must block Approve until a security/provenance note is present. */
const SECURITY_NOTE_KINDS = new Set<string>(['webhook-wiring', 'external-adoption']);

export type ProposalRisk = 'low' | 'high';

/**
 * The minimal shape `classifyProposalRisk` needs. Intentionally a structural
 * subset of `AgentOrgProposal` (not imported from the model) so this module
 * stays a leaf with zero repository/DB coupling — importing the model type
 * here would be harmless today but risks a future edit dragging in the
 * models barrel and its transitive DB-adjacent imports.
 */
export interface ProposalRiskInput {
  kind: string;
  /** Opaque JSON string — the proposed change payload, as stored on the row. */
  changeJson?: string | null;
  /** 1/true for external-adoption's extra vetting gate. */
  external?: number | boolean | null;
}

/** Parsed shape of a `changeJson` payload we inspect for hard-rule overrides. */
interface ParsedChange {
  /** Any write to the delegation graph is HIGH regardless of stated kind. */
  allowed_delegates_json?: unknown;
  /** Any new agent_configs row is HIGH regardless of stated kind. */
  insertAgentConfig?: unknown;
  /** Allowlist ADDITIONS are HIGH; removals are LOW (tighten/prune narrow). */
  add?: unknown;
  /** Any webhook-endpoint creation is HIGH regardless of stated kind. */
  createWebhookEndpoint?: unknown;
}

function safeParseChange(changeJson: string | null | undefined): ParsedChange | null {
  if (!changeJson) return null;
  try {
    const parsed = JSON.parse(changeJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ParsedChange;
    }
    return null;
  } catch {
    // Malformed JSON is not itself a risk signal here — the apply step (#821)
    // is responsible for refusing to act on unparseable payloads. This
    // predicate only escalates on a payload it CAN positively identify as
    // privileged; anything else falls through to the kind-based classification.
    return null;
  }
}

/**
 * True if the parsed change payload performs a hard-ruled privileged
 * mutation regardless of the proposal's stated `kind`. Any hit forces HIGH.
 */
function changeShapeIsHardRuledHigh(change: ParsedChange | null): boolean {
  if (!change) return false;
  if (change.allowed_delegates_json !== undefined) return true;
  if (change.insertAgentConfig !== undefined) return true;
  if (change.createWebhookEndpoint !== undefined) return true;
  if (change.add !== undefined) return true; // allowlist addition
  return false;
}

/**
 * Classify a proposal's risk tier. THE single source of truth — see module
 * doc comment. Default is HIGH (fail-closed): any `kind` not explicitly
 * enumerated in {@link LOW_RISK_KINDS} is gated.
 */
export function classifyProposalRisk(input: ProposalRiskInput): ProposalRisk {
  // external=1 (external-adoption's extra vetting flag) is always HIGH,
  // independent of whatever kind label accompanies it.
  if (input.external === 1 || input.external === true) {
    return 'high';
  }

  // Hard-rule change-shape override: a payload that performs a privileged
  // mutation is HIGH even if mislabeled with a low-risk kind.
  const change = safeParseChange(input.changeJson);
  if (changeShapeIsHardRuledHigh(change)) {
    return 'high';
  }

  const kind = (input.kind ?? '').trim();

  if (LOW_RISK_KINDS.has(kind)) {
    return 'low';
  }
  if (HIGH_RISK_KINDS.has(kind)) {
    return 'high';
  }

  // Fail-closed default: unknown/unlisted kind is never auto-applied.
  return 'high';
}

/**
 * True only for the two HIGH kinds whose review-queue UI must show a
 * mandatory security/provenance note and block Approve until it is present:
 * `external-adoption` (provenance_json: source/stars/downloads/maintainer/
 * license/install-cmd) and `webhook-wiring` (security note: trigger source,
 * target agent/recipe scope, HMAC setup, SSRF/allowlist constraints).
 */
export function requiresSecurityNote(kind: string): boolean {
  return SECURITY_NOTE_KINDS.has((kind ?? '').trim());
}
