import Database from 'better-sqlite3';

import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  type AgentRunFeedbackEvent,
  type AgentRunOutcome,
  type AgentRunOutcomeView,
  type FeedbackSource,
  type ObjectiveEvidence,
  type RunAttribution,
  type RunVerdict,
  type TerminalStatus,
  type UserVerdict,
} from '../models/agent_run_outcome';
import { buildAttribution, newLedgerId } from '../services/run_outcome_service';

/**
 * W4 — the outcome ledger's only writer.
 *
 * Deliberately INSERT-ONLY. There is no update and no delete method, on either
 * table, because a finalized outcome is immutable (W4-c11) and feedback is
 * append-only (W4-c2). The schema enforces the same thing with triggers, so a
 * future caller that bypasses this class cannot UPDATE or DELETE history.
 *
 * That is the exact guarantee — not "cannot rewrite" in general. SQLite fires
 * BEFORE DELETE for `INSERT OR REPLACE` only under `PRAGMA recursive_triggers`,
 * which is off here, so a REPLACE-shaped writer would slip past the triggers.
 * Nothing in this repository does that, and `migrations.ts` documents why the
 * pragma is not flipped; the boundary is pinned by a test rather than assumed.
 *
 * Dual-engine, following AgentOrgProposalsRepository: SQLite uses synchronous
 * better-sqlite3 with the throwaway `:memory:` fallback for tests that never
 * called initDb(); Postgres queries the pool directly with no fallback.
 */

interface OutcomeRow {
  id: string;
  root_session_id: string;
  session_id: string | null;
  run_episode_id: string | null;
  scheduled_occurrence_id: string | null;
  experiment_variant: string | null;
  proposal_id: string | null;
  profile_id: string | null;
  config_revision: number | null;
  terminal_status: string;
  objective_verdict: string;
  objective_evidence_json: string;
  attribution_json: string;
  finalized_at: string;
  created_at: string;
}

interface FeedbackRow {
  id: string;
  root_session_id: string;
  source: string;
  verdict: string;
  confidence: number;
  actor: string | null;
  reason: string | null;
  created_at: string;
}

export interface FinalizeOutcomeInput {
  rootSessionId: string;
  sessionId?: string | null;
  /** C2-D (S2) — the run episode this outcome belongs to; see the model. */
  runEpisodeId?: string | null;
  scheduledOccurrenceId?: string | null;
  experimentVariant?: string | null;
  proposalId?: string | null;
  profileId?: string | null;
  configRevision?: number | null;
  terminalStatus: TerminalStatus;
  objectiveVerdict: RunVerdict;
  objectiveEvidence: ObjectiveEvidence;
  attribution?: RunAttribution;
}

export interface AppendFeedbackInput {
  rootSessionId: string;
  source: FeedbackSource;
  verdict: UserVerdict;
  confidence: number;
  actor?: string | null;
  reason?: string | null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function outcomeFromRow(row: OutcomeRow): AgentRunOutcome {
  return {
    id: row.id,
    rootSessionId: row.root_session_id,
    sessionId: row.session_id ?? null,
    runEpisodeId: row.run_episode_id ?? null,
    scheduledOccurrenceId: row.scheduled_occurrence_id ?? null,
    experimentVariant: row.experiment_variant ?? null,
    proposalId: row.proposal_id ?? null,
    profileId: row.profile_id ?? null,
    configRevision: row.config_revision ?? null,
    terminalStatus: row.terminal_status as TerminalStatus,
    objectiveVerdict: row.objective_verdict as RunVerdict,
    objectiveEvidence: parseJson<ObjectiveEvidence>(row.objective_evidence_json, {
      producedArtifact: null,
      errorCount: null,
      approvalDenied: null,
    }),
    attribution: parseJson<RunAttribution>(row.attribution_json, buildAttribution()),
    finalizedAt: toIso(row.finalized_at),
    createdAt: toIso(row.created_at),
  };
}

function feedbackFromRow(row: FeedbackRow): AgentRunFeedbackEvent {
  return {
    id: row.id,
    rootSessionId: row.root_session_id,
    source: row.source as FeedbackSource,
    verdict: row.verdict as UserVerdict,
    confidence: Number(row.confidence),
    actor: row.actor ?? null,
    reason: row.reason ?? null,
    createdAt: toIso(row.created_at),
  };
}

/** Latest verdict from one source, or null when that source never spoke. */
function latestVerdict(
  feedback: AgentRunFeedbackEvent[],
  source: FeedbackSource,
): UserVerdict | null {
  for (let i = feedback.length - 1; i >= 0; i -= 1) {
    if (feedback[i].source === source) return feedback[i].verdict;
  }
  return null;
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Walks `agent_sessions.parent_session_id` to the top of the tree. Bounded so a
 * corrupt cycle degrades to "treat this session as its own root" instead of
 * hanging the terminal hook.
 */
const MAX_SESSION_TREE_DEPTH = 64;

/**
 * The route validates its own input, but the repository is the surface W5 and
 * W6 will call directly, and TypeScript disappears at runtime. Junk verdicts
 * persisted silently until this existed.
 */
const TERMINAL_STATUSES = new Set(['completed', 'error', 'aborted', 'timeout']);
const VERDICTS = new Set(['success', 'partial', 'failure', 'inconclusive']);
const FEEDBACK_VERDICTS = new Set(['success', 'partial', 'failure']);
const FEEDBACK_SOURCES = new Set(['explicit_user', 'inferred']);

function assertEnum(value: string, allowed: Set<string>, field: string): void {
  if (!allowed.has(value)) {
    throw new Error(
      `agent run ledger: '${field}' must be one of ${[...allowed].sort().join(' | ')}, got '${value}'`,
    );
  }
}

function assertConfidence(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`agent run ledger: 'confidence' must be a finite number in [0,1], got ${String(value)}`);
  }
}

export class AgentRunOutcomesRepository {
  /** SQLite-only handle. Never populated (and never used) under Postgres. */
  private db: Database.Database | null;

  constructor(db?: Database.Database) {
    if (env.dbClient === 'postgres') {
      this.db = null;
      return;
    }
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        this.db = makeInMemoryDb();
      }
    }
  }

  /**
   * W4-c12 — resolve a (possibly delegated child) session to its ROOT run. A
   * child's terminal event must land on the root's single outcome row; writing
   * the child's own id would satisfy the unique constraint while quietly
   * producing several outcomes for one run.
   */
  async resolveRootSessionIdAsync(sessionId: string): Promise<string> {
    let current = sessionId;
    for (let depth = 0; depth < MAX_SESSION_TREE_DEPTH; depth += 1) {
      let parent: string | null = null;
      if (env.dbClient === 'postgres') {
        const r = await getPostgresPool().query(
          `SELECT parent_session_id FROM agent_sessions WHERE id = $1`,
          [current],
        );
        if (r.rows.length === 0) return current;
        parent = (r.rows[0] as { parent_session_id: string | null }).parent_session_id;
      } else {
        const row = this.db!
          .prepare(`SELECT parent_session_id FROM agent_sessions WHERE id = ?`)
          .get(current) as { parent_session_id: string | null } | undefined;
        if (!row) return current;
        parent = row.parent_session_id;
      }
      if (!parent || parent === current) return current;
      current = parent;
    }
    return current;
  }

  /**
   * Objective tool telemetry for one session, read from the existing
   * `tool_events` table. Returns null when the session has NO events at all:
   * that is indistinguishable from telemetry being switched off, and guessing
   * "zero errors" there is exactly the fail-open this campaign forbids.
   *
   * Only the tool NAME, the status and a count are read — never arguments,
   * never output.
   */
  async findToolEvidenceAsync(
    sessionId: string,
  ): Promise<{ errorCount: number; tools: string[] } | null> {
    const sql = (placeholder: string) =>
      `SELECT tool, status FROM tool_events WHERE session_id = ${placeholder}`;
    let rows: Array<{ tool: string; status: string }>;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql('$1'), [sessionId]);
      rows = r.rows as Array<{ tool: string; status: string }>;
    } else {
      rows = this.db!.prepare(sql('?')).all(sessionId) as Array<{
        tool: string;
        status: string;
      }>;
    }
    if (rows.length === 0) return null;
    return {
      errorCount: rows.filter((row) => row.status === 'error').length,
      tools: [...new Set(rows.map((row) => row.tool))].sort(),
    };
  }

  /**
   * The owning user of a run, read from its root session. Null means the run is
   * unowned (a system/scheduled run), which every identified caller may see.
   */
  async findRunOwnerUserIdAsync(rootSessionId: string): Promise<number | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT owner_user_id FROM agent_sessions WHERE id = $1`,
        [rootSessionId],
      );
      return (r.rows[0] as { owner_user_id: number | null } | undefined)?.owner_user_id ?? null;
    }
    const row = this.db!
      .prepare(`SELECT owner_user_id FROM agent_sessions WHERE id = ?`)
      .get(rootSessionId) as { owner_user_id: number | null } | undefined;
    return row?.owner_user_id ?? null;
  }

  /**
   * W4-c5 — idempotent. The unique constraint on `root_session_id` is what
   * actually decides the race; a second finalizer simply reads back the row the
   * first one wrote rather than producing a competing verdict.
   */
  async finalizeAsync(input: FinalizeOutcomeInput): Promise<AgentRunOutcome> {
    assertEnum(input.terminalStatus, TERMINAL_STATUSES, 'terminalStatus');
    assertEnum(input.objectiveVerdict, VERDICTS, 'objectiveVerdict');
    const row = {
      id: newLedgerId(),
      root_session_id: input.rootSessionId,
      session_id: input.sessionId ?? null,
      run_episode_id: input.runEpisodeId ?? null,
      scheduled_occurrence_id: input.scheduledOccurrenceId ?? null,
      experiment_variant: input.experimentVariant ?? null,
      proposal_id: input.proposalId ?? null,
      profile_id: input.profileId ?? null,
      config_revision: input.configRevision ?? null,
      terminal_status: input.terminalStatus,
      objective_verdict: input.objectiveVerdict,
      objective_evidence_json: JSON.stringify(input.objectiveEvidence),
      attribution_json: JSON.stringify(input.attribution ?? buildAttribution()),
      finalized_at: new Date().toISOString(),
    };

    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO agent_run_outcomes
           (id, root_session_id, session_id, run_episode_id, scheduled_occurrence_id, experiment_variant,
            proposal_id, profile_id, config_revision, terminal_status, objective_verdict,
            objective_evidence_json, attribution_json, finalized_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (root_session_id) DO NOTHING`,
        Object.values(row),
      );
    } else {
      this.db!
        .prepare(
          `INSERT INTO agent_run_outcomes
             (id, root_session_id, session_id, run_episode_id, scheduled_occurrence_id, experiment_variant,
              proposal_id, profile_id, config_revision, terminal_status, objective_verdict,
              objective_evidence_json, attribution_json, finalized_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT (root_session_id) DO NOTHING`,
        )
        .run(...Object.values(row));
    }

    const stored = await this.findOutcomeAsync(input.rootSessionId);
    // The row was just inserted or already existed; a null here means the write
    // was rejected outright, which the caller must see rather than swallow.
    if (!stored) throw new Error(`Run outcome for ${input.rootSessionId} was not persisted`);
    return stored;
  }

  async appendFeedbackAsync(input: AppendFeedbackInput): Promise<AgentRunFeedbackEvent> {
    assertEnum(input.verdict, FEEDBACK_VERDICTS, 'verdict');
    assertEnum(input.source, FEEDBACK_SOURCES, 'source');
    assertConfidence(input.confidence);
    const row = {
      id: newLedgerId(),
      root_session_id: input.rootSessionId,
      source: input.source,
      verdict: input.verdict,
      confidence: input.confidence,
      actor: input.actor ?? null,
      reason: input.reason ?? null,
      created_at: new Date().toISOString(),
    };
    // ponytail: `seq` is derived inside the INSERT so a single statement both
    // reads and writes it. Two concurrent inserts under Postgres read-committed
    // can still land on the same seq; ordering then falls back to created_at,id,
    // which is good enough for a human clicking a feedback button. Move to a
    // per-root advisory lock only if a machine ever writes feedback in bursts.
    const seqSelect = `(SELECT COALESCE(MAX(f.seq), 0) + 1 FROM agent_run_feedback_events f WHERE f.root_session_id = `;
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO agent_run_feedback_events
           (id, root_session_id, seq, source, verdict, confidence, actor, reason, created_at)
         VALUES ($1,$2,${seqSelect}$2),$3,$4,$5,$6,$7,$8)`,
        Object.values(row),
      );
    } else {
      this.db!
        .prepare(
          `INSERT INTO agent_run_feedback_events
             (id, root_session_id, seq, source, verdict, confidence, actor, reason, created_at)
           VALUES (?,?,${seqSelect}?),?,?,?,?,?,?)`,
        )
        .run(
          row.id,
          row.root_session_id,
          row.root_session_id,
          row.source,
          row.verdict,
          row.confidence,
          row.actor,
          row.reason,
          row.created_at,
        );
    }
    return feedbackFromRow(row as unknown as FeedbackRow);
  }

  async findOutcomeAsync(rootSessionId: string): Promise<AgentRunOutcome | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_run_outcomes WHERE root_session_id = $1`,
        [rootSessionId],
      );
      return r.rows.length > 0 ? outcomeFromRow(r.rows[0] as OutcomeRow) : null;
    }
    const row = this.db!
      .prepare(`SELECT * FROM agent_run_outcomes WHERE root_session_id = ?`)
      .get(rootSessionId) as OutcomeRow | undefined;
    return row ? outcomeFromRow(row) : null;
  }

  /**
   * W6-c5 — the experiment service's cohort read. READ ONLY: W6 adds no update
   * path to this ledger and no column to it, so an experiment is identified
   * here by the proposal it judges, which is the only experiment-shaped
   * identifier the ledger carries. Rows with no `experiment_variant` are not
   * cohort members and are excluded.
   *
   * STATED LIMITATION (W6-c5): no production caller populates
   * `experiment_variant` today — every terminal hook passes it implicitly null,
   * so in production every cohort is empty until run-creation wiring lands,
   * which is deliberately out of W6's scope. The pairing behaviour is proven
   * against a seeded ledger fixture.
   */
  async listByExperimentAsync(proposalId: string): Promise<AgentRunOutcome[]> {
    const sql = (placeholder: string) =>
      `SELECT * FROM agent_run_outcomes
        WHERE proposal_id = ${placeholder} AND experiment_variant IS NOT NULL
        ORDER BY finalized_at, id`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql('$1'), [proposalId]);
      return (r.rows as OutcomeRow[]).map(outcomeFromRow);
    }
    const rows = this.db!.prepare(sql('?')).all(proposalId) as OutcomeRow[];
    return rows.map(outcomeFromRow);
  }

  /**
   * C2-D (S2) — the receipt-backed cohort read. Same shape as
   * {@link listByExperimentAsync}, plus an INNER JOIN requiring a matching
   * `agent_org_experiment_treatment_receipts` row for the exact same
   * `run_episode_id`, bound to this exact experiment and proposal. An
   * outcome from an untreated dispatch (no receipt — e.g. `treatment_failed`
   * or a pre-C2-D run with no episode id at all), or one whose receipt
   * belongs to a different experiment/proposal, is never counted here.
   *
   * This is the capability the C2 contract's global invariant requires
   * ("no experiment may establish outcome_status=verified unless both
   * cohorts contain valid, finalized treatment receipts..."). Wiring it into
   * the live judge/promote path is C3/C4 (tracked separately in #1448); this
   * method exists and is proven correct here so that wiring is additive.
   */
  async listReceiptBackedByExperimentAsync(
    experimentId: string,
    proposalId: string,
  ): Promise<AgentRunOutcome[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT o.* FROM agent_run_outcomes o
           JOIN agent_org_experiment_treatment_receipts r
             ON r.run_episode_id = o.run_episode_id
          WHERE o.proposal_id = $1
            AND o.experiment_variant IS NOT NULL
            AND r.experiment_id = $2
            AND r.proposal_id = $1
          ORDER BY o.finalized_at, o.id`,
        [proposalId, experimentId],
      );
      return (r.rows as OutcomeRow[]).map(outcomeFromRow);
    }
    const rows = this.db!
      .prepare(
        `SELECT o.* FROM agent_run_outcomes o
           JOIN agent_org_experiment_treatment_receipts r
             ON r.run_episode_id = o.run_episode_id
          WHERE o.proposal_id = ?
            AND o.experiment_variant IS NOT NULL
            AND r.experiment_id = ?
            AND r.proposal_id = ?
          ORDER BY o.finalized_at, o.id`,
      )
      .all(proposalId, experimentId, proposalId) as OutcomeRow[];
    return rows.map(outcomeFromRow);
  }

  /**
   * C5 — every finalized outcome for one profile, regardless of experiment
   * membership. This is the evidence builder's fact source
   * (proposal_evidence_builder.ts): unlike {@link listByExperimentAsync},
   * which only returns COHORT-labelled rows for one experiment, this reads
   * the profile's entire behavioral history so a NEW proposal (with no
   * experiment yet) can still be evidenced from real prior facts.
   */
  async listByProfileAsync(profileId: string): Promise<AgentRunOutcome[]> {
    const sql = (placeholder: string) =>
      `SELECT * FROM agent_run_outcomes WHERE profile_id = ${placeholder} ORDER BY finalized_at, id`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql('$1'), [profileId]);
      return (r.rows as OutcomeRow[]).map(outcomeFromRow);
    }
    const rows = this.db!.prepare(sql('?')).all(profileId) as OutcomeRow[];
    return rows.map(outcomeFromRow);
  }

  /**
   * C3 — the LATEST explicit-user verdict per root session, batched. Same
   * "last one wins" precedence as {@link findByRootSessionIdAsync}'s
   * `explicitUserVerdict`, just resolved for many rows at once so the
   * explicit-user-verdict-rate metric (feedback_metric_adapter.ts) is not an
   * N+1 query per cohort member. A root session absent from the returned map
   * never responded — the caller must read that as `null`, never as a score.
   *
   * ponytail: one query plus an in-memory scan, not a window function — cohort
   * sizes here are small (self-improvement experiments, not high-traffic
   * production tables). Revisit if a cohort ever runs into the thousands.
   */
  async listLatestExplicitUserVerdictsAsync(
    rootSessionIds: string[],
  ): Promise<Map<string, UserVerdict>> {
    const result = new Map<string, UserVerdict>();
    if (rootSessionIds.length === 0) return result;
    const unique = [...new Set(rootSessionIds)];
    const placeholders = unique.map((_, i) => (env.dbClient === 'postgres' ? `$${i + 1}` : '?')).join(',');
    const sql = `SELECT root_session_id, verdict, seq FROM agent_run_feedback_events
                  WHERE root_session_id IN (${placeholders}) AND source = 'explicit_user'
                  ORDER BY root_session_id, seq, created_at, id`;
    let rows: Array<{ root_session_id: string; verdict: string }>;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql, unique);
      rows = r.rows as Array<{ root_session_id: string; verdict: string }>;
    } else {
      rows = this.db!.prepare(sql).all(...unique) as Array<{ root_session_id: string; verdict: string }>;
    }
    // Ascending order, so the last write for a given id wins — same
    // precedence rule `latestVerdict` applies above.
    for (const row of rows) {
      result.set(row.root_session_id, row.verdict as UserVerdict);
    }
    return result;
  }

  async listFeedbackAsync(rootSessionId: string): Promise<AgentRunFeedbackEvent[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_run_feedback_events
          WHERE root_session_id = $1 ORDER BY seq, created_at, id`,
        [rootSessionId],
      );
      return (r.rows as FeedbackRow[]).map(feedbackFromRow);
    }
    const rows = this.db!
      .prepare(
        `SELECT * FROM agent_run_feedback_events
          WHERE root_session_id = ? ORDER BY seq, created_at, id`,
      )
      .all(rootSessionId) as FeedbackRow[];
    return rows.map(feedbackFromRow);
  }

  /**
   * W4-c4 — the composed read. Objective, explicit and inferred verdicts are
   * three named fields; `authoritativeVerdict` states the precedence once, so
   * no caller has to re-derive (and mis-derive) it.
   */
  async findByRootSessionIdAsync(
    rootSessionId: string,
  ): Promise<AgentRunOutcomeView | null> {
    const outcome = await this.findOutcomeAsync(rootSessionId);
    if (!outcome) return null;
    const feedback = await this.listFeedbackAsync(rootSessionId);
    const explicitUserVerdict = latestVerdict(feedback, 'explicit_user');
    const inferredVerdict = latestVerdict(feedback, 'inferred');
    return {
      outcome,
      objectiveVerdict: outcome.objectiveVerdict,
      explicitUserVerdict,
      inferredVerdict,
      // An explicit human verdict outranks inference, which outranks the
      // objective reading. Inference can never displace a human.
      authoritativeVerdict:
        explicitUserVerdict ?? inferredVerdict ?? outcome.objectiveVerdict,
      feedback,
    };
  }
}
