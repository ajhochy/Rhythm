/**
 * AgentOrgProposal — a single proposed change from the org self-optimizer.
 *
 * Foundation store every optimizer generator and the human review queue write
 * to (see docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §5 for the
 * full design). Dual-engine (proposals-parity fix, #1113 sibling): also
 * present in postgres_bootstrap.ts. The decision doc's original "local SQLite
 * only, never synced to production" call predates #1111/#1113, which made
 * the org-optimizer's own seed run against a Postgres-backed deployment
 * (gated on the deployment ROLE, not the DB engine — see
 * org_optimizer_seed.ts) — so the optimizer, and every proposal it writes,
 * now genuinely runs there too. See AgentOrgProposalsRepository's dual-engine
 * branch for the read/write paths.
 *
 * Lifecycle/revert mechanics mirror the `agent_skills` sidecar
 * (see models/agent_skill.ts): `before_snapshot_json` plays the role
 * `agent_skill_versions` plays for skills — the exact prior state to restore
 * on revert.
 *
 * Status state machine (enforced by AgentOrgProposalsRepository.updateStatusAsync):
 *
 *   proposed  -> approved | rejected | applied | failed
 *   approved  -> applied
 *   applied   -> measuring
 *   measuring -> active | reverted
 *   active    -> reverted   (#857 — human-triggered undo of an already-kept proposal)
 *   failed    -> applied | failed   (#1056 — retryable: a re-approve re-runs
 *                                    the same apply step)
 *
 * `proposed -> applied` (skipping `approved`) is the auto-apply lane for
 * low-risk, reversible proposals per the maintainer's full-autonomy-with-
 * rollback policy (2026-07-02) — only new-agent and external-adoption kinds
 * are human-gated in practice, but that gating is a caller-side policy
 * decision made before calling updateStatusAsync, not something the state
 * machine itself enforces.
 */
export interface AgentOrgProposal {
  id: string;
  /** Groups proposals from one optimizer run. Null for ad hoc/manual proposals. */
  auditRunId: string | null;
  /**
   * create-agent|grant-delegation|expand-delegation|broaden-scope|
   * tighten-scope|prune-scope|create-recipe|refine-recipe|refine-skill|
   * consolidate-skill|external-adoption|webhook-wiring|refine-config|
   * refine-scope|workflow-prompt-fix|refine-task|publish-skill-to-org
   */
  kind: string;
  /** 'low' | 'high' — from classifyProposalRisk. */
  risk: string;
  /** 1 for external-adoption (extra vetting gate); 0 otherwise. */
  external: number;
  /**
   * proposed|approved|rejected|applied|measuring|active|reverted|failed.
   * See the state machine documented above.
   */
  status: string;
  title: string;
  /** Human-readable why + the signal it cites. */
  rationale: string | null;
  /** Pointer/JSON to the evidence (gap id, session ids, counts). */
  signalRef: string | null;
  /** What it touches (agent_config_id, skill name, recipe id, server id). */
  targetRef: string | null;
  /** The proposed change payload (apply input). Opaque TEXT — not parsed here. */
  changeJson: string | null;
  /** Rollback payload captured at apply time. Opaque TEXT — not parsed here. */
  beforeSnapshotJson: string | null;
  /**
   * external-adoption: source/stars/downloads/last-updated/maintainer/license/
   * install-cmd; webhook-wiring: security note. Opaque TEXT — not parsed here.
   */
  provenanceJson: string | null;
  /** Stable hash for idempotency (kind+target+change). */
  dedupKey: string | null;
  baselineScore: number | null;
  postScore: number | null;
  measureReason: string | null;
  decidedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Input shape for {@link AgentOrgProposalsRepository.createAsync}. */
export interface AgentOrgProposalInput {
  id?: string;
  auditRunId?: string | null;
  kind: string;
  risk: string;
  external?: number;
  status?: string;
  title: string;
  rationale?: string | null;
  signalRef?: string | null;
  targetRef?: string | null;
  changeJson?: string | null;
  beforeSnapshotJson?: string | null;
  provenanceJson?: string | null;
  dedupKey?: string | null;
  baselineScore?: number | null;
  postScore?: number | null;
  measureReason?: string | null;
  decidedByUserId?: number | null;
}

/**
 * Build an {@link AgentOrgProposal} from a plain JSON object (camelCase keys).
 * Round-trips losslessly with {@link agentOrgProposalToJson}.
 */
export function agentOrgProposalFromJson(json: Record<string, unknown>): AgentOrgProposal {
  return {
    id: json.id as string,
    auditRunId: (json.auditRunId as string | null) ?? null,
    kind: json.kind as string,
    risk: json.risk as string,
    external: (json.external as number) ?? 0,
    status: json.status as string,
    title: json.title as string,
    rationale: (json.rationale as string | null) ?? null,
    signalRef: (json.signalRef as string | null) ?? null,
    targetRef: (json.targetRef as string | null) ?? null,
    changeJson: (json.changeJson as string | null) ?? null,
    beforeSnapshotJson: (json.beforeSnapshotJson as string | null) ?? null,
    provenanceJson: (json.provenanceJson as string | null) ?? null,
    dedupKey: (json.dedupKey as string | null) ?? null,
    baselineScore: (json.baselineScore as number | null) ?? null,
    postScore: (json.postScore as number | null) ?? null,
    measureReason: (json.measureReason as string | null) ?? null,
    decidedByUserId: (json.decidedByUserId as number | null) ?? null,
    createdAt: json.createdAt as string,
    updatedAt: json.updatedAt as string,
  };
}

/** Serialize an {@link AgentOrgProposal} to a plain JSON object (camelCase keys). */
export function agentOrgProposalToJson(proposal: AgentOrgProposal): Record<string, unknown> {
  return {
    id: proposal.id,
    auditRunId: proposal.auditRunId,
    kind: proposal.kind,
    risk: proposal.risk,
    external: proposal.external,
    status: proposal.status,
    title: proposal.title,
    rationale: proposal.rationale,
    signalRef: proposal.signalRef,
    targetRef: proposal.targetRef,
    changeJson: proposal.changeJson,
    beforeSnapshotJson: proposal.beforeSnapshotJson,
    provenanceJson: proposal.provenanceJson,
    dedupKey: proposal.dedupKey,
    baselineScore: proposal.baselineScore,
    postScore: proposal.postScore,
    measureReason: proposal.measureReason,
    decidedByUserId: proposal.decidedByUserId,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}
