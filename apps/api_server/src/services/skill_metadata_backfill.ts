/**
 * skill_metadata_backfill.ts — #797 (skill-unify2-06)
 *
 * One-time, idempotent reconciliation of HISTORICAL `agent_skills` rows onto the
 * unified model. Existing rows predate the sidecar model: they carry the legacy
 * `draft`/`published` statuses and (for published rows) may or may not already
 * have a materialized SKILL.md in the Rhythm-managed dir.
 *
 * The unified read (#793, GET /opencode/skills?withMetadata=true) joins a sidecar
 * row onto the LIVE engine skill of the same `name` (= the row's `title`). For
 * that join to show legacy rows correctly WITHOUT duplicating engine skills, this
 * backfill:
 *
 *   • PUBLISHED rows — reconcile by name/title to the managed engine skill they
 *     materialize to:
 *       – If a managed SKILL.md (or any live engine skill) already exists for that
 *         name → JOIN ONLY: leave the row as metadata, do NOT re-materialize a
 *         second file. (#778 already materializes on publish; this covers rows
 *         that predate #778 but whose file is already present.)
 *       – If none exists (e.g. a prior materialize failed) → materialize ONCE via
 *         the standard materializer so the file appears, then reload.
 *     Either way the legacy `published` status is normalized to `active`.
 *
 *   • DRAFT (never-materialized) rows — carried over as sidecar metadata with
 *     `status='active'` (the auto-apply lifecycle has no `draft`/`proposed`). They
 *     surface in the unified read under their `name` with the file ABSENT (no
 *     SKILL.md) until the loop or a user materializes one. NOT materialized here.
 *
 *   • COLLISIONS — a row whose `title` equals an existing engine skill `name` is
 *     the published "file already exists" case above: JOINED (status→active), the
 *     existing file is untouched, never duplicated.
 *
 * Lifecycle-only rows (already `active`/`measuring`/`reverted`) are left ALONE —
 * they are the new model and were never legacy. `agent_skill_versions` history is
 * never touched and no row is ever deleted.
 *
 * Operational guards (mirror skill_seed_importer / skill_apply):
 *   • ONE-TIME: guarded by a `schema_meta` marker ({@link BACKFILL_MARKER}); a
 *     second run is a no-op (never re-materializes, never re-touches rows). This
 *     mirrors `seedAgentStackSkills`' run-once gate, using the same `schema_meta`
 *     idempotency-marker pattern already used by `backfill_scheduled_date_v1`.
 *   • Postgres (env.dbClient === 'postgres') is a NO-OP — agent skills are
 *     local-SQLite-only, never synced to production (the schema_meta marker table
 *     and the materializer's managed dir are both SQLite/local-oriented).
 *   • NEVER throws — startup wiring is fire-and-forget; a failure must not block
 *     boot. A failure does NOT write the marker, so a later boot retries.
 *   • All writes go through the materializer → the managed-dir boundary
 *     (`writeManagedSkill`); a write outside the managed dir is impossible by
 *     construction.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { getDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { opencodeClient } from './opencode_engine';
import { materializeSkill, skillToManagedName } from './skill_materializer';
import type { AgentSkill } from '../models/agent_skill';

/** schema_meta key for the run-once idempotency gate. */
export const BACKFILL_MARKER = 'agent_skills_unify_backfill_v1';

/** A live engine skill as reported by the unified read (GET /opencode/skills). */
export interface LiveEngineSkill {
  name: string;
  description?: string;
  location: string;
}

export interface BackfillDeps {
  /** Injectable repo (defaults to a fresh AgentSkillsRepository over the global DB). */
  repo?: AgentSkillsRepository;
  /** Injectable live-set reader (defaults to opencodeClient.listSkills). */
  listSkills?: () => Promise<LiveEngineSkill[]>;
  /**
   * Injectable materialize (defaults to the real materializeSkill). Writes a DB
   * skill to a managed SKILL.md and reloads the fork. Never throws.
   */
  materialize?: (skill: AgentSkill) => Promise<void>;
  /**
   * Injectable run-once check — has the backfill already run? Defaults to a
   * `schema_meta` marker read. Returns true to short-circuit.
   */
  alreadyDone?: () => boolean;
  /** Injectable run-once record — marks the backfill complete. Defaults to a `schema_meta` upsert. */
  markDone?: () => void;
}

export interface BackfillResult {
  /** Legacy published rows reconciled (status normalized to active). */
  publishedReconciled: number;
  /** Of those, the ones materialized here because no file existed yet. */
  publishedMaterialized: number;
  /** Legacy draft rows carried over to status='active' (file absent). */
  draftCarriedOver: number;
  /** Rows left untouched (already lifecycle-only, or not legacy). */
  skipped: number;
  /** True when the run short-circuited because the marker already existed. */
  alreadyDone: boolean;
}

const EMPTY_RESULT: BackfillResult = {
  publishedReconciled: 0,
  publishedMaterialized: 0,
  draftCarriedOver: 0,
  skipped: 0,
  alreadyDone: false,
};

/** Default run-once check: a `schema_meta` marker row exists for {@link BACKFILL_MARKER}. */
function defaultAlreadyDone(): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT key FROM schema_meta WHERE key = ?`)
      .get(BACKFILL_MARKER) as { key: string } | undefined;
    return row !== undefined;
  } catch {
    // No global DB / no schema_meta — treat as not done (the per-run repo is
    // an in-memory DB in that path; the caller injects alreadyDone in tests).
    return false;
  }
}

/** Default run-once record: upsert the {@link BACKFILL_MARKER} marker with an ISO timestamp. */
function defaultMarkDone(): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(BACKFILL_MARKER, new Date().toISOString());
  } catch (err) {
    logger.warn(
      `[skill-backfill] could not write run-once marker (non-fatal): ${String(err)}`,
    );
  }
}

/**
 * Reconcile legacy `agent_skills` rows onto the unified model. One-time + idempotent.
 *
 * Returns a {@link BackfillResult} describing what was done. NEVER throws — on any
 * error it logs and returns the partial result WITHOUT writing the run-once marker,
 * so a later boot retries.
 */
export async function backfillSkillMetadata(
  deps: BackfillDeps = {},
): Promise<BackfillResult> {
  // Postgres no-op — agent skills are local-SQLite-only (mirrors seed importer).
  if (env.dbClient === 'postgres') {
    return { ...EMPTY_RESULT, alreadyDone: true };
  }

  const repo = deps.repo ?? new AgentSkillsRepository();
  const alreadyDone = deps.alreadyDone ?? defaultAlreadyDone;
  const markDone = deps.markDone ?? defaultMarkDone;
  const listSkills =
    deps.listSkills ?? (() => opencodeClient.listSkills());
  const materialize = deps.materialize ?? materializeSkill;

  try {
    // Run-once gate (mirrors seedAgentStackSkills' guard).
    if (alreadyDone()) {
      return { ...EMPTY_RESULT, alreadyDone: true };
    }

    // The live engine name set defines what already has a discoverable file.
    // Case-insensitive, matching the repository's NOCASE join key (findByName).
    const liveNames = new Set(
      (await listSkills()).map((s) => s.name.trim().toLowerCase()),
    );

    const result: BackfillResult = { ...EMPTY_RESULT };

    for (const skill of repo.list()) {
      const status = (skill.status ?? '').toLowerCase();

      if (status === 'published') {
        const name = skillToManagedName(skill);
        const fileExists = liveNames.has(name.toLowerCase());
        if (!fileExists) {
          // No discoverable file (materialize previously failed / predates #778)
          // — materialize ONCE so the unified read shows it with a file present.
          await materialize(skill);
          result.publishedMaterialized += 1;
          // Mark the name live so a duplicate title in the same batch joins.
          liveNames.add(name.toLowerCase());
        }
        // Either way: normalize legacy 'published' → 'active' (JOIN as metadata).
        repo.update(skill.id, { status: 'active' });
        result.publishedReconciled += 1;
        continue;
      }

      if (status === 'draft') {
        // Never-materialized legacy draft → carry over as active sidecar metadata.
        // NOT materialized: it surfaces in the unified read with the file absent.
        repo.update(skill.id, { status: 'active' });
        result.draftCarriedOver += 1;
        continue;
      }

      // active / measuring / reverted (or anything else) — already the new model.
      result.skipped += 1;
    }

    // Only mark done AFTER the full pass succeeded — a thrown error skips this so
    // a later boot retries from a clean slate (re-run is a no-op for done rows).
    markDone();

    logger.info(
      `[skill-backfill] reconciled legacy agent_skills: publishedReconciled=${result.publishedReconciled} ` +
        `publishedMaterialized=${result.publishedMaterialized} draftCarriedOver=${result.draftCarriedOver} ` +
        `skipped=${result.skipped}`,
    );
    return result;
  } catch (err) {
    logger.warn(`[skill-backfill] backfill failed (non-fatal): ${String(err)}`);
    return { ...EMPTY_RESULT };
  }
}
