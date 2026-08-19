/**
 * D2.1 (#1431) — the post-apply monitor/repair/revert lifecycle record.
 *
 * One row per APPLIED proposal (`proposal_id` is UNIQUE — see
 * PostApplyEventsRepository.createAsync): once a proposal's change lands on
 * a live agent_config, this is the durable trail of what happened to it
 * afterward — guardrail monitoring (D2.2), up to
 * {@link MAX_REPAIR_ATTEMPTS} corrective repair attempts (D2.3), and an
 * eventual revert or "clear" (D2.4).
 *
 * Never a raw prompt/secret/tool payload: `preChangeSnapshotJson` is meant
 * to carry an opaque CAS pointer (profile id + revision + a fingerprint —
 * see `buildProfileRevisionFingerprint` in org_proposal_experiment_service.ts
 * for the established, non-reversible hashing precedent this should reuse),
 * never the prior field VALUE itself, and both JSON columns are additionally
 * passed through `redactSecrets` inside the repository before every write —
 * defense-in-depth, not the only guard.
 */

export type PostApplyChangeType = 'prompt' | 'tool' | 'scope';

export const POST_APPLY_CHANGE_TYPES: readonly PostApplyChangeType[] = [
  'prompt',
  'tool',
  'scope',
] as const;

export function isPostApplyChangeType(value: unknown): value is PostApplyChangeType {
  return typeof value === 'string' && (POST_APPLY_CHANGE_TYPES as readonly string[]).includes(value);
}

export type GuardrailStatus = 'monitoring' | 'clear' | 'tripped';

export const GUARDRAIL_STATUSES: readonly GuardrailStatus[] = [
  'monitoring',
  'clear',
  'tripped',
] as const;

export type PostApplyRevertStatus = 'none' | 'reverted' | 'not_needed' | 'revert_failed';

export const POST_APPLY_REVERT_STATUSES: readonly PostApplyRevertStatus[] = [
  'none',
  'reverted',
  'not_needed',
  'revert_failed',
] as const;

/** Repairs are a bounded 3-strike loop (D2.3) — never an unbounded retry. */
export const MAX_REPAIR_ATTEMPTS = 3;

export interface PostApplyEvent {
  id: string;
  proposalId: string;
  profileId: string;
  changeType: PostApplyChangeType;
  /** Opaque CAS pointer — never the raw pre-change field value. */
  preChangeSnapshotJson: string;
  monitoringWindowStart: string;
  monitoringWindowEnd: string;
  guardrailStatus: GuardrailStatus;
  /** JSON array of 0-{@link MAX_REPAIR_ATTEMPTS} corrective proposal ids, in attempt order. */
  repairProposalIdsJson: string;
  revertStatus: PostApplyRevertStatus;
  /** JSON alert payload (redacted of secrets), or null until an alert is generated. */
  alertPayloadJson: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input shape for {@link PostApplyEventsRepository.createAsync}. */
export interface CreatePostApplyEventInput {
  id?: string;
  proposalId: string;
  profileId: string;
  changeType: PostApplyChangeType;
  preChangeSnapshotJson: string;
  monitoringWindowStart: string;
  monitoringWindowEnd: string;
}

/** Patch shape for {@link PostApplyEventsRepository.updateStatusAsync}. */
export interface UpdatePostApplyEventPatch {
  guardrailStatus?: GuardrailStatus;
  /** A full JSON array of proposal ids — truncated to the most recent {@link MAX_REPAIR_ATTEMPTS}. */
  repairProposalIdsJson?: string;
  revertStatus?: PostApplyRevertStatus;
  alertPayloadJson?: string | null;
  monitoringWindowEnd?: string;
}

/** Parse a repair-attempts JSON array; malformed/foreign input degrades to []. */
export function parseRepairProposalIds(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
