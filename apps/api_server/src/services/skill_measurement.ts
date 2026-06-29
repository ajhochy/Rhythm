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
 * `post_score > baseline_score` (STRICTLY greater). Ties / parse failures /
 * thrown judge → NO improvement → revert (FAIL-CLOSED).
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
import { writeManagedSkill, deleteManagedSkill } from './rhythm_managed_skills';
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
  /** Injectable managed-dir delete (defaults to deleteManagedSkill). */
  remove?: (name: string) => boolean;
}

export type MeasureOutcome = 'kept' | 'reverted' | 'skipped';

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
  const remove = deps.remove ?? deleteManagedSkill;

  try {
    // The PRIOR body is what we revert to + the baseline we score. Without it we
    // cannot safely measure → fail-closed revert (but we still need a target).
    const prior = priorBodyOf(repo, skill);
    const purpose: SkillPurpose = {
      name: skill.appliedForName ?? skill.title,
      description: skill.description ?? null,
      whenToUse: skill.whenToUse ?? null,
    };

    // Score baseline (prior body) and post (current revised body). scoreSkillBody
    // never throws; an unparseable/failed scorer yields 0 (fail-closed).
    const scorer = deps.scorer ?? undefined;
    const baseline = await scoreSkillBody(purpose, prior?.body ?? null, scorer);
    const post = await scoreSkillBody(purpose, skill.body ?? null, scorer);

    const improved = post.score > baseline.score; // STRICTLY greater
    const reason =
      `baseline=${baseline.score} (${baseline.reason}); ` +
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
    return await revertAppliedSkill(skill, prior, post, repo, { reload, write, remove });
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
  post: { score: number; reason: string },
  repo: AgentSkillsRepository,
  io: {
    reload: () => Promise<unknown>;
    write: (skill: { name: string; description?: string; body: string }) => string;
    remove: (name: string) => boolean;
  },
): Promise<MeasureOutcome> {
  const name = skill.appliedForName ?? skill.title;
  // Candidate hash of the LOSING revised body → retained on the reverted row so
  // #794's duplicate guard (applied_for_name + base_version + hash) skips it.
  const marker = revertedMarker(candidateHash(skill.body ?? null));

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

    // Managed target: rollback the sidecar row to base_version (snapshots the
    // reverted-away revision first), then rewrite the live SKILL.md to the prior
    // body so the file matches the restored DB state.
    if (skill.baseVersion == null) {
      logger.warn(`[skill-measure] managed '${name}' has no base_version — cannot rollback; leaving measuring`);
      return 'skipped';
    }
    const restored = repo.rollback(skill.id, skill.baseVersion);
    if (!restored) {
      logger.warn(`[skill-measure] rollback to v${skill.baseVersion} returned null for '${name}' — leaving measuring`);
      return 'skipped';
    }

    const priorBody = prior?.body ?? restored.body ?? '';
    const priorDesc = prior?.description ?? restored.description ?? undefined;
    let wroteFile = false;
    try {
      io.write({ name, description: priorDesc ?? undefined, body: priorBody });
      wroteFile = true;
    } catch (err) {
      logger.warn(`[skill-measure] writeManagedSkill(priorBody) failed for '${name}' (non-fatal): ${String(err)}`);
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
    // already happened; the file write being best-effort, we still mark reverted
    // so the loser is not re-applied (the DB is the system of record for status).
    repo.update(skill.id, { status: 'reverted', measureReason: marker });
    logger.info(
      `[skill-measure] REVERTED managed '${name}' to v${skill.baseVersion} (post ${post.score} ≤ baseline; file rewritten=${wroteFile})`,
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
    const remove = deps.remove ?? deleteManagedSkill;

    const stuck = repo.list().filter((s) => s.status === 'measuring');
    let reverted = 0;
    for (const skill of stuck) {
      const prior = priorBodyOf(repo, skill);
      const outcome = await revertAppliedSkill(
        skill,
        prior,
        { score: 0, reason: 'crash-recovery: measuring at startup → reverted defensively' },
        repo,
        { reload, write, remove },
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
