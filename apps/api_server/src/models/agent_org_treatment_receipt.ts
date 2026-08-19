/**
 * C2-B — the durable, immutable, sanitized treatment receipt.
 *
 * A receipt is bound to exactly one enrollment/run episode and carries only
 * safe identity/revision/hash EVIDENCE: never raw prompt/system-prompt/
 * output/tool/credential bytes. It exists so a later phase can filter
 * outcomes to runs that PROVABLY received their bound treatment, and prove
 * baseline vs candidate produced distinct effective prompts, without ever
 * persisting the prompt text itself.
 */

export type TreatmentReceiptAdapter = 'system-prompt-v1';

/** Closed adapter registry — the same single shipped family C2 validates. */
export const TREATMENT_RECEIPT_ADAPTERS: readonly TreatmentReceiptAdapter[] = [
  'system-prompt-v1',
] as const;

export const TREATMENT_RECEIPT_SCHEMA_VERSION = 1 as const;

export type TreatmentReceiptCohort = 'baseline' | 'candidate';

export interface TreatmentReceipt {
  schemaVersion: typeof TREATMENT_RECEIPT_SCHEMA_VERSION;
  id: string;
  enrollmentId: string;
  runEpisodeId: string;
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: TreatmentReceiptCohort;
  assignmentDigest: string;
  adapter: TreatmentReceiptAdapter;
  /** Exactly `agent_config:<profileId>`. */
  targetRef: string;
  /** The existing durable target fingerprint format: `sha256:<64hex>`. */
  baselineTargetRevisionHash: string;
  profileRevision: number;
  /** Bare lowercase 64-hex — no `sha256:` prefix, matching treatmentSpecHash's existing convention. */
  treatmentSpecHash: string;
  /** Bare lowercase 64-hex hash of the exact effective system-prompt override. Never the prompt bytes themselves. */
  effectivePromptHash: string;
  finalizedAt: string;
}

/** Bare lowercase 64-hex digest — the closed hash format for treatment/effective hashes. */
const HEX64_RE = /^[0-9a-f]{64}$/;
export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64_RE.test(value);
}

/** The existing durable target revision format: `sha256:` + a lowercase 64-hex digest. */
const TARGET_REVISION_HASH_RE = /^sha256:[0-9a-f]{64}$/;
export function isTargetRevisionHash(value: unknown): value is string {
  return typeof value === 'string' && TARGET_REVISION_HASH_RE.test(value);
}

export function buildTargetRef(profileId: string): string {
  return `agent_config:${profileId}`;
}
