/** Durable pre-review evaluation records. Candidate and result rows are append-only. */

/** The proposal kinds accepted by the existing org proposal queue/applier registry. */
export const ORG_EVALUATION_PROPOSAL_KINDS = [
  'create-agent',
  'grant-delegation',
  'expand-delegation',
  'broaden-scope',
  'tighten-scope',
  'prune-scope',
  'create-recipe',
  'refine-recipe',
  'refine-skill',
  'consolidate-skill',
  'external-adoption',
  'webhook-wiring',
  'refine-config',
  'refine-scope',
  'workflow-prompt-fix',
  'refine-task',
  'publish-skill-to-org',
  'tool-install',
] as const;

export type OrgEvaluationProposalKind = (typeof ORG_EVALUATION_PROPOSAL_KINDS)[number];
export type OrgEvaluationStatus =
  | 'planning'
  | 'exploring'
  | 'validating'
  | 'qualified'
  | 'inconclusive'
  | 'failed';
export type OrgEvaluationStage =
  | 'generator'
  | 'original-probe'
  | 'candidate-probe'
  | 'composition'
  | 'judge'
  | 'final-validation'
  | 'retry';

export interface OrgEvaluationJob {
  id: string;
  /** Null for the review-cycle budget root; children share that root's cap. */
  budgetRootId: string | null;
  sourceAuditRunId: string | null;
  ownerUserId: number | null;
  status: OrgEvaluationStatus;
  /** Whole-run cap, including every child, judge, retry, and validation call. */
  maxTokens: number;
  /** Held for final independent comparison; exploration cannot consume this floor. */
  validationReserveTokens: number;
  originalHash: string;
  targetRef: string;
  targetRevision: string;
  /** Frozen request, task set, guardrails, model choices, and validation split. */
  inputJson: string;
  finalCandidateId: string | null;
  qualifiedProposalId: string | null;
  failureReason: string | null;
  /** Monotonic compare-and-swap token for coordinator transitions. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type OrgEvaluationCandidateRole = 'original' | 'variant' | 'composition' | 'final';

export interface OrgEvaluationCandidate {
  id: string;
  jobId: string;
  role: OrgEvaluationCandidateRole;
  ordinal: number;
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  /** SHA-256 of the exact effective configuration exercised by the isolated run. */
  configHash: string;
  /** Exact isolated effective configuration/version exercised, never a live path. */
  effectiveConfigJson: string;
  /** Frozen proposal payload; execution never applies this to the live target. */
  changeJson: string;
  parentCandidateIds: string[];
  compositionParts?: OrgEvaluationCompositionPart[];
  createdAt: string;
}

/** One portion retained or rejected during composition, with supporting receipts. */
export interface OrgEvaluationCompositionPart {
  sourceCandidateId: string;
  /** RFC 6901 pointer into both source and composed change JSON. */
  changePath: string;
  /** Exact substring retained or rejected inside a string leaf; omitted means whole-value equality. */
  sourceFragment?: string;
  retained: boolean;
  reason: string;
  evidenceResultIds: string[];
}

/** Provider-reported usage. Total includes all billable categories only once. */
export interface OrgEvaluationTokenUsage {
  totalTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
}

/** Trusted isolated worker's observable effect evidence, bound to the candidate manifest. */
export interface OrgEvaluationEffectProof {
  manifestHash: string;
  events: Array<{
    kind: string;
    source: 'worker-db' | 'worker-file' | 'engine-session' | 'engine-tool' |
      'engine-permission' | 'loopback-receiver' | 'docker-vetter';
    observedAt: string;
    subject: string;
    evidenceHash: string;
  }>;
  negativeGuardsPassed: boolean;
  workerId: string;
  workerRootHash: string;
  engineBootId: string;
}

export interface OrgEvaluationExecutionReceipt {
  sessionId: string;
  engineVersion: string;
  taskFixtureHash: string;
  effectiveConfigHash: string;
  toolEvents: unknown[];
  effectProof: OrgEvaluationEffectProof;
}

export interface OrgEvaluationResult {
  id: string;
  jobId: string;
  candidateId: string;
  phase: 'probe' | 'validation';
  /** Immutable task/fixture identity; validation tasks are withheld from exploration. */
  taskKey: string;
  /** Digest of an immutable execution receipt, not a model-written verdict alone. */
  receiptHash: string;
  /** Actual session IDs, model/version, task checks, tool effects, and output evidence. */
  receiptJson: string;
  status: 'pass' | 'fail' | 'inconclusive';
  score: number | null;
  tokenUsage: OrgEvaluationTokenUsage | null;
  failureReason: string | null;
  createdAt: string;
}

export interface OrgEvaluationTokenReservation {
  jobId: string;
  /** Stable idempotency key for one external call, including retries after restart. */
  reservationKey: string;
  stage: OrgEvaluationStage;
  maxTokens: number;
  status: 'reserved' | 'settled' | 'unknown';
  actualTokens: number | null;
  createdAt: string;
  settledAt: string | null;
}

export interface OrgEvaluationBudget {
  maxTokens: number;
  validationReserveTokens: number;
  settledTokens: number;
  outstandingTokens: number;
  /** Remaining admission capacity for non-validation stages. */
  explorationAvailableTokens: number;
  /** Remaining capacity across the whole job, including the held validation floor. */
  totalAvailableTokens: number;
  hasUnknownUsage: boolean;
}
