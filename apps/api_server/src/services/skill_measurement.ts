/**
 * skill_measurement.ts — skill-unify2-04 (#795)
 *
 * The SAFETY NET for the auto-apply self-improvement loop. #794 has already
 * auto-applied a revision to an engine skill (managed = revised in place;
 * external = a same-`name` managed shadow) and left the sidecar `agent_skills`
 * row in `status='measuring'` carrying:
 *   - applied_for_name : engine skill `name` the revision targets
 *   - base_version     : the engine/skill version it was based on = rollback target
 *   - origin_location  : the live SKILL.md location at apply time
 *   - is_external      : 1 when the target lived OUTSIDE the managed dir
 *   - measure_reason   : 'hash:<sha256-of-revised-body>' (#794's candidate hash)
 *
 * This service MEASURES whether the applied revision actually improved the
 * skill, then KEEPS it (status → active) or AUTO-REVERTS it (status → reverted)
 * if it did not.
 *
 * Improvement metric (v1, see decision doc + #795): a PERSISTED, purpose-
 * anchored numeric score (0–100) from the upgraded LLM judge (skill_refiner's
 * `scoreSkillBody`). `baseline_score` scores the PRIOR body; `post_score` scores
 * the REVISED body; same rubric/prompt. Decision: improvement iff
 * `post_score > baseline_score` (STRICTLY greater). Ties → NO improvement →
 * revert (FAIL-CLOSED).
 *
 * 2026-07-11 incident — an UNKNOWN score (unparseable/absent/errored judge, see
 * `ScoreResult.unknown`) short-circuits that comparison to `revert`. It used to
 * be coerced to 0, which was wrong in BOTH directions: an unknown POST reverted
 * (harmless), but an unknown BASELINE scored 0 and made ANY post score look
 * like an improvement, so an unmeasured revision was kept over a good prior
 * body.
 *
 * BODY AUTHORITY (#1082, reaffirmed by 2026-07-11 incident): the FILE is the source of truth
 * for a skill body; `agent_skills.body` is lifecycle metadata that a
 * file-authored skill never populates. Every restore path here therefore
 * prefers the raw pre-apply FILE snapshot, and the DB-history fallback now
 * REFUSES to write an empty body rather than "restoring" nothing over real
 * content.
 *
 * Revert:
 *   - Managed target → rollback(skillId, base_version) (snapshots the
 *     reverted-away revision first), then writeManagedSkill(priorBody) +
 *     reloadSkills() so the live file matches the restored prior body.
 *   - External fork (is_external=1) → deleteManagedSkill(name) + reloadSkills()
 *     to remove the shadow, restoring the external original as live. The
 *     origin_location file is NEVER written; this service only ever touches the
 *     managed dir.
 *
 * Crash recovery: a row stuck `measuring` at service start (apply happened,
 * measure never completed) is treated as not-yet-confirmed and reverted
 * defensively (fail-closed).
 *
 * Operational envelope (mirrors skill_refiner / skill_materializer):
 *   • isTestEnv() short-circuits the real scorer to ZERO side effects; a test
 *     must inject deps.scorer AND clear VITEST to exercise the real branch.
 *   • NEVER throws — callers are fire-and-forget.
 *   • Postgres is a no-op (agent data is local-SQLite-only).
 *   • Best-effort reload: a reloadSkills() failure logs but does not crash; the
 *     DB status transition only commits AFTER the file write/delete succeeded.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { opencodeClient } from './opencode_engine';
import {
  writeManagedSkill,
  restoreManagedSkillBytes,
  readManagedSkillSnapshotBytes,
  deleteManagedSkillSnapshot,
  deleteManagedSkill,
} from './rhythm_managed_skills';
import {
  scoreSkillBody,
  type ScoreCall,
  type SkillPurpose,
} from './skill_refiner';
import type { AgentSkill } from '../models/agent_skill';

/** Mirrors skill_refiner.isTestEnv() VERBATIM. */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/** Sha256 of a body, used as the candidate-hash in the reverted duplicate guard. */
export function candidateHash(body: string | null): string {
  return createHash('sha256').update(body ?? '').digest('hex');
}

/** `measure_reason` marker keying the #794 duplicate guard on a reverted loser. */
export function revertedMarker(hash: string): string {
  return `reverted:hash:${hash}`;
}

export interface MeasureDeps {
  /** Injectable repo (defaults to a fresh AgentSkillsRepository over the global DB). */
  repo?: AgentSkillsRepository;
  /** Injectable purpose-anchored scorer (defaults to the real opencode-backed impl). */
  scorer?: ScoreCall;
  /** Injectable engine re-scan (defaults to opencodeClient.reloadSkills). */
  reload?: () => Promise<unknown>;
  /** Injectable managed-dir write (defaults to writeManagedSkill). */
  write?: (skill: { name: string; description?: string; body: string }) => string;
  /** Injectable byte-exact managed restore (defaults to restoreManagedSkillBytes). */
  restore?: (name: string, contents: string | NodeJS.ArrayBufferView) => string;
  /** Injectable pre-apply file snapshot reader for a managed rollback. */
  readSnapshot?: (name: string) => Buffer | null;
  /** Injectable terminal pre-apply file snapshot cleanup. */
  deleteSnapshot?: (name: string) => boolean;
  /** Injectable managed-dir delete (defaults to deleteManagedSkill). */
  remove?: (name: string) => boolean;
}

export type MeasureOutcome = 'kept' | 'reverted' | 'skipped';

function restoreContentsToUtf8(
  contents: string | NodeJS.ArrayBufferView,
): string {
  if (typeof contents === 'string') return contents;
  return Buffer.from(
    contents.buffer,
    contents.byteOffset,
    contents.byteLength,
  ).toString('utf8');
}

/** The PRIOR (base_version) body of a measuring row, read from version history. */
function priorBodyOf(repo: AgentSkillsRepository, skill: AgentSkill): {
  body: string | null;
  description: string | null;
} | null {
  if (skill.baseVersion == null) return null;
  const snap = repo
    .listVersions(skill.id)
    .find((v) => v.versionNo === skill.baseVersion);
  if (!snap) return null;
  return { body: snap.body ?? null, description: snap.description ?? null };
}

/** Read a file's bytes, or null if it does not exist / cannot be read. */
function readBytesOrNull(path: string | null | undefined): Buffer | null {
  if (!path || !existsSync(path)) return null;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** Preserve the apply-time candidate hash even after DB body content is absent. */
function candidateHashForSkill(skill: AgentSkill): string {
  const recorded = skill.measureReason?.match(/^hash:([a-f0-9]{64})$/i)?.[1];
  return recorded ?? candidateHash(skill.body ?? null);
}

/** Best-effort removal after a measurement reaches a terminal state. */
function cleanupSnapshot(
  name: string,
  deleteSnapshot: ((name: string) => boolean) | undefined,
): void {
  if (!deleteSnapshot) return;
  try {
    deleteSnapshot(name);
  } catch (err) {
    logger.warn(`[skill-measure] could not remove rollback snapshot for '${name}' (non-fatal): ${String(err)}`);
  }
}

/**
 * Measure one `measuring` sidecar row and KEEP or REVERT it. Returns the
 * outcome. NEVER throws.
 *
 * @param skill a sidecar row already known to be in `status='measuring'`.
 */
export async function measureAppliedSkill(
  skill: AgentSkill,
  deps: MeasureDeps = {},
): Promise<MeasureOutcome> {
  const repo = deps.repo ?? new AgentSkillsRepository();
  const reload = deps.reload ?? (() => opencodeClient.reloadSkills());
  const write = deps.write ?? writeManagedSkill;
  const restore =
    deps.restore ??
    (deps.write
      ? (name: string, contents: string | NodeJS.ArrayBufferView) =>
          deps.write!({
            name,
            body: restoreContentsToUtf8(contents),
          })
        : restoreManagedSkillBytes);
  // A fake managed writer has no real file to snapshot. Production and the
  // file-backed e2e path use the default raw-byte reader instead.
  const readSnapshot =
    deps.readSnapshot ?? (deps.write ? undefined : readManagedSkillSnapshotBytes);
  const deleteSnapshot =
    deps.deleteSnapshot ?? (deps.write ? undefined : deleteManagedSkillSnapshot);
  const remove = deps.remove ?? deleteManagedSkill;

  try {
    const name = skill.appliedForName ?? skill.title;
    // Prefer the exact pre-apply file snapshot over legacy DB content/history.
    // The sidecar can become metadata-only while the live file remains fully
    // reversible during measurement.
    const fileSnapshot = skill.isExternal === 1 ? null : readSnapshot?.(name) ?? null;
    const prior =
      fileSnapshot == null
        ? priorBodyOf(repo, skill)
        : { body: fileSnapshot.toString('utf8'), description: null };
    const purpose: SkillPurpose = {
      name,
      description: skill.description ?? null,
      whenToUse: skill.whenToUse ?? null,
    };

    // Score baseline (prior body) and post (current revised body). scoreSkillBody
    // never throws; an unparseable/failed scorer yields UNKNOWN (2026-07-11 incident).
    const scorer = deps.scorer ?? undefined;
    const baseline = await scoreSkillBody(purpose, prior?.body ?? null, scorer);
    const post = await scoreSkillBody(purpose, skill.body ?? null, scorer);

    // 2026-07-11 incident — either score being UNKNOWN makes the comparison meaningless, so
    // never let it decide "keep". Note the old `post.score > baseline.score`
    // over unknown-as-0 was wrong in BOTH directions: an unknown BASELINE (0)
    // made any post score look like an improvement, so an unmeasured revision
    // was KEPT over a perfectly good prior body. Unknown → revert, which
    // restores the pre-apply file: the non-destructive direction for a row that
    // is mid-flight by construction (status='measuring').
    const scoreUnavailable = baseline.unknown === true || post.unknown === true;
    const improved = !scoreUnavailable && post.score > baseline.score; // STRICTLY greater
    const reason = scoreUnavailable
      ? `baseline=${baseline.unknown ? 'unknown' : baseline.score} (${baseline.reason}); ` +
        `post=${post.unknown ? 'unknown' : post.score} (${post.reason}); ` +
        `decision=revert (score UNKNOWN — not a judgement about the revision)`
      : `baseline=${baseline.score} (${baseline.reason}); ` +
        `post=${post.score} (${post.reason}); ` +
        `decision=${improved ? 'keep' : 'revert'}`;

    if (improved) {
      // KEEP: persist scores + reason, transition measuring → active.
      repo.update(skill.id, {
        baselineScore: baseline.score,
        postScore: post.score,
        measureReason: reason,
        status: 'active',
      });
      logger.info(
        `[skill-measure] KEEP '${purpose.name}' (post ${post.score} > baseline ${baseline.score})`,
      );
      if (fileSnapshot != null) cleanupSnapshot(name, deleteSnapshot);
      return 'kept';
    }

    // No improvement → REVERT. Always persist the scores first (audit), then do
    // the file-side revert, then commit the status transition ONLY if the file
    // operation succeeded.
    repo.update(skill.id, {
      baselineScore: baseline.score,
      postScore: post.score,
      measureReason: reason,
    });
    return await revertAppliedSkill(skill, prior, fileSnapshot, post, repo, {
      reload,
      write,
      restore,
      deleteSnapshot,
      remove,
    });
  } catch (err) {
    logger.warn(`[skill-measure] measure FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}

/**
 * Revert a non-improving applied revision. Managed → rollback + rewrite the live
 * file to the prior body; external fork → delete the shadow. The origin_location
 * file is NEVER written. NEVER throws.
 */
async function revertAppliedSkill(
  skill: AgentSkill,
  prior: { body: string | null; description: string | null } | null,
  fileSnapshot: Buffer | null,
  post: { score: number; reason: string },
  repo: AgentSkillsRepository,
  io: {
    reload: () => Promise<unknown>;
    write: (skill: { name: string; description?: string; body: string }) => string;
    restore: (name: string, contents: string | NodeJS.ArrayBufferView) => string;
    deleteSnapshot?: (name: string) => boolean;
    remove: (name: string) => boolean;
  },
): Promise<MeasureOutcome> {
  const name = skill.appliedForName ?? skill.title;
  // Candidate hash of the LOSING revised body → retained on the reverted row so
  // #794's duplicate guard (applied_for_name + base_version + hash) skips it.
  const marker = revertedMarker(candidateHashForSkill(skill));

  try {
    if (skill.isExternal === 1) {
      // External fork: remove ONLY the managed shadow. The external original at
      // origin_location is restored as live by virtue of removing the shadow; we
      // must NEVER write origin_location.
      const before = readBytesOrNull(skill.originLocation);
      const removed = io.remove(name);
      // Best-effort reload; failure logs but does not block the status commit.
      try {
        if (removed) await io.reload();
      } catch (err) {
        logger.warn(`[skill-measure] reload after external revert failed (non-fatal): ${String(err)}`);
      }
      // Safety assertion: the external original must be byte-identical.
      const after = readBytesOrNull(skill.originLocation);
      if (before && after && !before.equals(after)) {
        logger.error(
          `[skill-measure] INVARIANT VIOLATION: external original '${skill.originLocation}' changed during revert of '${name}'`,
        );
      }
      // Commit status transition (file delete is the durable revert; even if the
      // shadow was already gone, the desired end-state — no shadow — holds).
      repo.update(skill.id, { status: 'reverted', measureReason: marker });
      logger.info(`[skill-measure] REVERTED external fork '${name}' (shadow removed=${removed})`);
      return 'reverted';
    }

    // Managed target: restore the raw pre-apply file snapshot first. This is the
    // source-of-truth path and works when the DB row is lifecycle metadata only.
    // Retain the legacy DB rollback as a best-effort compatibility update while
    // its body/version history still exists; it is not required for file restore.
    if (fileSnapshot == null && skill.baseVersion == null) {
      logger.warn(
        `[skill-measure] managed '${name}' has neither a file snapshot nor base_version — cannot rollback; leaving measuring`,
      );
      return 'skipped';
    }

    let wroteFile = false;
    try {
      if (fileSnapshot != null) {
        io.restore(name, fileSnapshot);
      } else {
        const restored = repo.rollback(skill.id, skill.baseVersion!);
        if (!restored) {
          logger.warn(
            `[skill-measure] rollback to v${skill.baseVersion} returned null for '${name}' — leaving measuring`,
          );
          return 'skipped';
        }
        // 2026-07-11 incident — the old `?? ''` here would WRITE AN EMPTY FILE whenever
        // neither the version snapshot nor the rolled-back row carried a body,
        // which is the normal state for a file-authored skill (its content
        // lives in the SKILL.md; the DB row is lifecycle metadata, see the
        // authority note in the module docstring). Restoring nothing over real
        // content is worse than not restoring at all: leave the live file and
        // the measuring row alone so the content survives for a human.
        const priorBody = prior?.body ?? restored.body ?? null;
        if (priorBody === null || priorBody.trim() === '') {
          logger.warn(
            `[skill-measure] refusing to restore '${name}' from an EMPTY prior body ` +
              `(no prior content in the file snapshot or v${skill.baseVersion} history) — ` +
              `leaving the live file untouched`,
          );
          return 'skipped';
        }
        io.restore(name, Buffer.from(priorBody, 'utf8'));
      }
      wroteFile = true;
    } catch (err) {
      logger.warn(`[skill-measure] managed file restore failed for '${name}' (non-fatal): ${String(err)}`);
    }

    if (!wroteFile) return 'skipped';

    if (fileSnapshot != null && skill.baseVersion != null) {
      const restored = repo.rollback(skill.id, skill.baseVersion);
      if (!restored) {
        logger.warn(
          `[skill-measure] legacy DB rollback to v${skill.baseVersion} unavailable for '${name}' after file restore`,
        );
      }
    }

    // Best-effort reload; only when the file write succeeded.
    if (wroteFile) {
      try {
        await io.reload();
      } catch (err) {
        logger.warn(`[skill-measure] reload after managed revert failed (non-fatal): ${String(err)}`);
      }
    }

    // Commit the status transition + retain the reverted marker. The DB rollback
    // is now only a compatibility update; the live file is the source of truth.
    repo.update(skill.id, { status: 'reverted', measureReason: marker });
    if (fileSnapshot != null) cleanupSnapshot(name, io.deleteSnapshot);
    logger.info(
      `[skill-measure] REVERTED managed '${name}' via ${fileSnapshot != null ? 'file snapshot' : `v${skill.baseVersion}`} (post ${post.score} ≤ baseline)`,
    );
    return 'reverted';
  } catch (err) {
    logger.warn(`[skill-measure] revert FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}

/**
 * Crash recovery: at service start, any sidecar row stuck in `measuring` (apply
 * happened, measure never confirmed) is reverted defensively (fail-closed —
 * we do not trust an unmeasured revision). Re-scores are NOT attempted here;
 * the safe action is to roll back. NEVER throws.
 *
 * Skipped under VITEST (zero side effects) and under Postgres (no-op), matching
 * the rest of the loop. A test exercising it injects deps + clears VITEST.
 */
export async function recoverStuckMeasurements(deps: MeasureDeps = {}): Promise<number> {
  try {
    if (isTestEnv() && !deps.repo) return 0;
    if (env.dbClient === 'postgres') return 0;

    const repo = deps.repo ?? new AgentSkillsRepository();
    const reload = deps.reload ?? (() => opencodeClient.reloadSkills());
    const write = deps.write ?? writeManagedSkill;
    const restore =
      deps.restore ??
      (deps.write
        ? (name: string, contents: string | NodeJS.ArrayBufferView) =>
          deps.write!({
              name,
              body: restoreContentsToUtf8(contents),
            })
        : restoreManagedSkillBytes);
    const readSnapshot =
      deps.readSnapshot ?? (deps.write ? undefined : readManagedSkillSnapshotBytes);
    const deleteSnapshot =
      deps.deleteSnapshot ?? (deps.write ? undefined : deleteManagedSkillSnapshot);
    const remove = deps.remove ?? deleteManagedSkill;

    const stuck = repo.list().filter((s) => s.status === 'measuring');
    let reverted = 0;
    for (const skill of stuck) {
      const name = skill.appliedForName ?? skill.title;
      const fileSnapshot = skill.isExternal === 1 ? null : readSnapshot?.(name) ?? null;
      const prior =
        fileSnapshot == null
          ? priorBodyOf(repo, skill)
          : { body: fileSnapshot.toString('utf8'), description: null };
      const outcome = await revertAppliedSkill(
        skill,
        prior,
        fileSnapshot,
        { score: 0, reason: 'crash-recovery: measuring at startup → reverted defensively' },
        repo,
        { reload, write, restore, deleteSnapshot, remove },
      );
      if (outcome === 'reverted') reverted++;
    }
    if (reverted > 0) {
      logger.info(`[skill-measure] crash recovery reverted ${reverted} stuck measuring row(s)`);
    }
    return reverted;
  } catch (err) {
    logger.warn(`[skill-measure] crash recovery FAILED (non-fatal): ${String(err)}`);
    return 0;
  }
}
