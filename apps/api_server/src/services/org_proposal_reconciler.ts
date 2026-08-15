/**
 * W5 — the READ-ONLY lifecycle reconciler.
 *
 * This is NOT the W1 recovery sweep (`org_proposal_recovery_service.ts`). That
 * one ACTS: it re-projects lagging profiles and durably marks incoherent
 * `approved`/`applied` claims. This one only REPORTS, and only about rows that
 * have already reached the terminal `active` state — the 69 rows the plan's
 * live audit found, whose stored rollback payload can no longer be trusted.
 *
 * It has no write powers on purpose. The audit's finding was that replaying
 * those old whole-field snapshots would clobber unrelated changes on 57 of
 * them, regrant 42 servers, remove 27 currently-granted ones, and destroy
 * per-tool narrowing on 8. Nothing about that is safe to automate, so the
 * honest deliverable is a classification an operator can read.
 *
 * A row that cannot be PROVEN is `unverifiable`. It is never assumed effective:
 * "we could not check" and "we checked and it is fine" are different facts, and
 * conflating them is what let the drift accumulate unseen.
 */

import { getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { readScopeFieldValue, type ScopeFieldName } from './scope_pair_classification';
import { isScopeSnapshotVersion, verifyScopeSnapshotForRevert } from './scope_mutation_contract';
import { parseStrictJson } from './strict_json';

export type ScopeReconciliation =
  /** The target still holds the exact bytes this proposal applied. */
  | 'effective'
  /** The change was undone out of band — the removed entries are back. */
  | 'reintroduced-drifted'
  /**
   * The stored rollback payload is the pre-V2 whole-field blob. Replaying it
   * would overwrite every unrelated change since. Human-only, permanently.
   */
  | 'unsafe-legacy-rollback'
  /** A later, unrelated edit moved the target away from both known values. */
  | 'conflicted'
  /** Nothing could be proven: no snapshot, no target, or a snapshot that no
   * longer verifies. Never treated as effective. */
  | 'unverifiable';

export const SCOPE_KINDS = new Set(['tighten-scope', 'prune-scope', 'refine-scope', 'broaden-scope']);

export interface ReconciledScopeRow {
  proposalId: string;
  kind: string;
  targetRef: string | null;
  classification: ScopeReconciliation;
  /** Operator-facing explanation. Stable text — the script's JSON is diffed. */
  detail: string;
}

export interface ScopeReconcileReport {
  total: number;
  byClassification: Record<ScopeReconciliation, number>;
  rows: ReconciledScopeRow[];
}

export interface ReconcilerDeps {
  proposalsRepo?: AgentOrgProposalsRepository;
  configsRepo?: AgentConfigsRepository;
}

function emptyCounts(): Record<ScopeReconciliation, number> {
  return {
    effective: 0,
    'reintroduced-drifted': 0,
    'unsafe-legacy-rollback': 0,
    conflicted: 0,
    unverifiable: 0,
  };
}

/** Names currently present in an allowlist field, in either supported shape. */
function currentNames(value: string | null): string[] | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === 'string');
  if (parsed && typeof parsed === 'object') return Object.keys(parsed as Record<string, unknown>);
  return null;
}

function classifyRow(
  proposal: { id: string; kind: string; targetRef: string | null; changeJson: string | null; beforeSnapshotJson: string | null },
  configsRepo: AgentConfigsRepository,
): ReconciledScopeRow {
  const base = { proposalId: proposal.id, kind: proposal.kind, targetRef: proposal.targetRef };

  if (!proposal.beforeSnapshotJson || !proposal.changeJson) {
    return { ...base, classification: 'unverifiable', detail: 'no stored change/rollback payload to check against' };
  }

  let snapshot: unknown;
  try {
    snapshot = parseStrictJson(proposal.beforeSnapshotJson, 'proposal before_snapshot_json');
  } catch {
    return { ...base, classification: 'unverifiable', detail: 'the stored rollback payload is not strictly parseable' };
  }

  // The legacy whole-field blob predates the versioned contract entirely. It is
  // named BEFORE any verification attempt, because the point is that it can
  // never be replayed — not that it failed a check.
  if (!isScopeSnapshotVersion(snapshot)) {
    return {
      ...base,
      classification: 'unsafe-legacy-rollback',
      detail: 'pre-V2 whole-field rollback payload; replaying it would clobber every unrelated change since',
    };
  }

  const verified = verifyScopeSnapshotForRevert(snapshot, proposal.kind, proposal.changeJson);
  if (!verified) {
    return { ...base, classification: 'unverifiable', detail: 'the versioned snapshot no longer verifies against the stored change bytes' };
  }

  const target = configsRepo.getById(verified.prepared.agentConfigId);
  if (!target) {
    return { ...base, classification: 'unverifiable', detail: `target agent config '${verified.prepared.agentConfigId}' no longer exists` };
  }

  const live = readScopeFieldValue(target, verified.prepared.field as ScopeFieldName);
  if (live === verified.prepared.expectedAppliedValue) {
    return { ...base, classification: 'effective', detail: 'the target still holds the exact applied bytes' };
  }

  const removed = verified.prepared.remove ?? [];
  const names = currentNames(live);
  const reintroduced =
    live === verified.prepared.priorValue ||
    (removed.length > 0 && names !== null && removed.every((name) => names.includes(name)));
  if (reintroduced) {
    return {
      ...base,
      classification: 'reintroduced-drifted',
      detail: removed.length > 0
        ? `entries removed by this proposal are present again: ${removed.join(',')}`
        : 'the target has returned to its pre-apply bytes',
    };
  }

  return {
    ...base,
    classification: 'conflicted',
    detail: 'the target holds neither the applied nor the prior bytes — a later, unrelated edit moved it',
  };
}

/**
 * Classify every ACTIVE scope proposal against the live config. Reads only.
 * Rows are returned sorted by id so the operator script's JSON is diffable.
 */
export async function reconcileActiveScopeProposals(
  deps: ReconcilerDeps = {},
): Promise<ScopeReconcileReport> {
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();

  const rows = (await proposalsRepo.listByStatusAsync('active'))
    .filter((proposal) => SCOPE_KINDS.has(proposal.kind))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((proposal) => classifyRow(proposal, configsRepo));

  const byClassification = emptyCounts();
  for (const row of rows) byClassification[row.classification] += 1;
  return { total: rows.length, byClassification, rows };
}

// ═══════════════════════════════════════════════════════════════════════════
// W5-c9 — stuck measurement, classified rather than retried forever.
//
// W1 already converts PERMANENTLY unprovable measuring rows to a durable
// `reconciliation-required`. The remaining case is the legitimately RETRYABLE
// one: telemetry unavailable, engine down. Those rows return `skipped`, stay
// `measuring`, and get picked up again on every single sweep — forever, in
// silence, while an operator sees a row that still looks healthy.
//
// The plan offers "retry/deadline accounting OR a deterministic inconclusive
// classification". This takes the second branch, because W5 owns no schema file
// (W4 is editing migrations.ts in parallel) and because a durable attempt
// counter would have to be written to `agent_org_proposals` — where the AFTER
// UPDATE auto-bump trigger would advance the lifecycle CAS token on every
// single retry, invalidating tokens held in flight by approve/apply/revert.
//
// So the classification is DERIVED, from `updated_at`, which is exactly the
// right clock: a retry that decides nothing writes nothing, so `updated_at`
// still holds the moment the row entered `measuring`.
// ═══════════════════════════════════════════════════════════════════════════

/** 24h. A measurement that has not concluded in a day is not going to. */
export const MEASURING_BUDGET_MS = 24 * 60 * 60 * 1000;

export type MeasurementVerdict = 'within-budget' | 'inconclusive';

export interface StuckMeasurementVerdict {
  verdict: MeasurementVerdict;
  ageMs: number;
  reason: string;
}

/**
 * Pure. An unreadable timestamp is `inconclusive`, not "assume it is fresh":
 * a row whose clock cannot be read is precisely the row nobody will ever look
 * at again if the sweep keeps quietly retrying it.
 */
export function classifyStuckMeasurement(
  row: { status: string; updatedAt: string | null },
  options: { now?: number; budgetMs?: number } = {},
): StuckMeasurementVerdict {
  const now = options.now ?? Date.now();
  const budgetMs = options.budgetMs ?? MEASURING_BUDGET_MS;
  const startedAt = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN;
  if (!Number.isFinite(startedAt)) {
    return {
      verdict: 'inconclusive',
      ageMs: Number.POSITIVE_INFINITY,
      reason: 'inconclusive: the row carries no readable timestamp, so its retry budget cannot be proven',
    };
  }
  const ageMs = now - startedAt;
  if (ageMs <= budgetMs) {
    return { verdict: 'within-budget', ageMs, reason: 'still inside its measurement budget' };
  }
  return {
    verdict: 'inconclusive',
    ageMs,
    reason:
      `inconclusive: this row has been retryable-but-undecided for ${Math.floor(ageMs / 3_600_000)}h, ` +
      'past its measurement budget — it needs an operator, not another silent retry',
  };
}

export interface StuckMeasurementRow {
  proposalId: string;
  kind: string;
  ageMs: number;
  reason: string;
}

export interface StuckMeasurementReport {
  total: number;
  withinBudget: StuckMeasurementRow[];
  inconclusive: StuckMeasurementRow[];
}

/**
 * Classify every `measuring` row against its budget. Reads only — the verdict
 * is reported, never written, so the lifecycle CAS token is untouched.
 */
export async function reconcileStuckMeasurements(
  options: { now?: number; budgetMs?: number; proposalsRepo?: AgentOrgProposalsRepository } = {},
): Promise<StuckMeasurementReport> {
  const proposalsRepo = options.proposalsRepo ?? new AgentOrgProposalsRepository();
  const withinBudget: StuckMeasurementRow[] = [];
  const inconclusive: StuckMeasurementRow[] = [];

  const rows = (await proposalsRepo.listByStatusAsync('measuring'))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of rows) {
    const verdict = classifyStuckMeasurement(row, options);
    const entry: StuckMeasurementRow = {
      proposalId: row.id,
      kind: row.kind,
      ageMs: verdict.ageMs,
      reason: verdict.reason,
    };
    if (verdict.verdict === 'inconclusive') inconclusive.push(entry);
    else withinBudget.push(entry);
  }
  return { total: rows.length, withinBudget, inconclusive };
}

/*
 * W5-c12 — the retirement sidecar.
 *
 * `agent_org_proposals` carries an AFTER UPDATE trigger that advances
 * `revision` on ANY update, and that revision is the lifecycle CAS token held
 * in flight by approve/apply/revert/measure. "An operator has been told about
 * this row" is not a domain change, so recording it on the row itself would
 * silently invalidate a concurrent operation's token. It goes in a sidecar
 * instead — the same shape `agent_profile_projections` uses for the same
 * reason.
 *
 * The table used to be created lazily here (`ensureReconciliationSidecar`),
 * outside migrations.ts and SQLite-only. That put it outside
 * skill_schema_parity.test.ts, whose DDL parser only reads migrations.ts and
 * postgres_bootstrap.ts — so the guard could not see the table and the two
 * engines diverged unobserved, the exact drift class this repo has already
 * shipped a production bug for. The DDL now lives in migrations.ts with a
 * Postgres twin in postgres_bootstrap.ts, and the lazy creation is gone: every
 * caller reaches this module through a DB that has run runMigrations().
 */

// ═══════════════════════════════════════════════════════════════════════════
// The operator entry point. Lives here rather than in scripts/ because
// tsconfig's rootDir excludes scripts/ from both the build and typechecking —
// a CLI whose logic sits outside the compiler is a CLI nobody is testing.
// ═══════════════════════════════════════════════════════════════════════════

export interface ReconcileCliOptions {
  now?: number;
  budgetMs?: number;
  write?: (line: string) => void;
}

export interface ReconcileCliResult {
  applied: boolean;
  /** Proposal ids whose stale metadata this invocation retired. */
  retired: string[];
  json: string;
}

/**
 * Dry-run by DEFAULT. `--apply` is limited to recording, in the sidecar, that
 * a row has been handed to an operator. It never restores or removes a
 * permission: the plan lists automatic permission mutation under "deferred by
 * design", and the live audit is the reason — replaying those legacy snapshots
 * would regrant 42 servers and remove 27 currently-granted ones.
 */
export async function runReconcileCli(
  argv: string[],
  options: ReconcileCliOptions = {},
): Promise<ReconcileCliResult> {
  const apply = argv.includes('--apply');
  const now = options.now ?? Date.now();
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  const activeScope = await reconcileActiveScopeProposals();
  const stuckMeasurements = await reconcileStuckMeasurements({ now, budgetMs: options.budgetMs });

  const retired: string[] = [];
  if (apply) {
    const db = getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO agent_org_proposal_retirements
         (proposal_id, classification, detail, proposal_revision, retired_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const readRevision = db.prepare('SELECT revision FROM agent_org_proposals WHERE id = ?');
    for (const row of activeScope.rows) {
      // An `effective` row is not stale — there is nothing to retire.
      if (row.classification === 'effective') continue;
      const current = readRevision.get(row.proposalId) as { revision: number } | undefined;
      if (!current) continue;
      const info = insert.run(
        row.proposalId,
        row.classification,
        row.detail,
        current.revision,
        new Date(now).toISOString(),
      );
      if (info.changes > 0) retired.push(row.proposalId);
    }
  }

  const json = JSON.stringify(
    { mode: apply ? 'apply' : 'dry-run', activeScope, stuckMeasurements, retired },
    null,
    2,
  );
  write(json);
  return { applied: apply, retired, json };
}
