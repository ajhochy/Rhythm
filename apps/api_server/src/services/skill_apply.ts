/**
 * skill_apply.ts — #794 (skill-unify2-03)
 *
 * The auto-apply step of the self-improvement loop, RE-TARGETED at the LIVE
 * engine skill set (handwritten / imported / external / managed) instead of the
 * old DB-row-only `reviseInPlace`. There is NO proposal queue and NO human gate:
 * a passing candidate is applied immediately (a SKILL.md is written), the sidecar
 * row is moved to `status='measuring'`, and the measurement + auto-revert step
 * (#795) decides whether the revision stays or is rolled back.
 *
 * Two apply paths, chosen by where the live target's file lives:
 *
 *   • MANAGED target (file already inside the Rhythm-managed dir): revise in
 *     place — snapshot the current managed body into agent_skill_versions, write
 *     the revised body via writeManagedSkill, bump version, reloadSkills. Sidecar
 *     row: is_external=0.
 *
 *   • EXTERNAL / handwritten target (location OUTSIDE the managed dir): FORK to a
 *     same-`name` managed shadow via writeManagedSkill + reloadSkills. THE
 *     ORIGINAL EXTERNAL FILE IS NEVER WRITTEN — only a managed shadow is created.
 *     The external original's bytes are snapshotted into agent_skill_versions as
 *     the base_version so #795 can revert by removing the shadow. Sidecar row:
 *     is_external=1, origin_location recorded.
 *
 * ALL writes go through `writeManagedSkill` / the managed-dir boundary
 * (`isManagedLocation` + `slugForSkillName`). A write to a location outside the
 * managed dir is impossible by construction (writeManagedSkill only ever resolves
 * inside the managed dir) and rejected for bad names (InvalidSkillNameError) —
 * defence in depth.
 *
 * Operational guards (mirror skill_extractor / skill_refiner VERBATIM):
 *   • isTestEnv() → ZERO LLM calls and ZERO real file writes. A test exercising
 *     the real branch must clear VITEST/NODE_ENV AND inject `writeSkill` /
 *     `reloadSkills` / `readOriginal` doubles (so still no real FS).
 *   • Postgres (env.dbClient === 'postgres') is a no-op — agent skills are
 *     local-SQLite-only, never synced to production.
 *   • NEVER throws — the loop callers are fire-and-forget.
 *   • Cold-start throttle (#746) is enforced by the queueing caller, not here.
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  writeManagedSkill,
  isManagedLocation,
  InvalidSkillNameError,
} from './rhythm_managed_skills';
import { opencodeClient } from './opencode_engine';
import type { AgentSkill } from '../models/agent_skill';

/** Mirrors opencode_agent_writer.ts isTestEnv() VERBATIM. */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/** The extractor confidence floor — a candidate below this is never applied. */
export const CONFIDENCE_FLOOR = 0.6;

/** A live engine skill as reported by the unified read (GET /opencode/skills). */
export interface LiveEngineSkill {
  name: string;
  description?: string;
  location: string;
}

/** The revised skill ready to apply to a live engine skill of the same `name`. */
export interface ApplyCandidate {
  /** Engine skill `name` (SKILL.md frontmatter) this revision targets. */
  name: string;
  /** The full revised SKILL.md body to write. */
  body: string;
  /** Optional one-line description for the written SKILL.md frontmatter. */
  description?: string | null;
  /** Candidate confidence — must clear the floor AND >= the existing confidence. */
  confidence: number;
  /** Provenance label written to the sidecar row's `source`. */
  source: string;
}

export type ApplyOutcome =
  | 'applied-managed'
  | 'applied-external-fork'
  | 'skipped-gate'
  | 'skipped-duplicate'
  | 'no-target'
  | 'skipped';

export interface ApplyDeps {
  /** Injectable repo (defaults to a fresh AgentSkillsRepository). */
  repo?: AgentSkillsRepository;
  /** Injectable live-set reader (defaults to opencodeClient.listSkills). */
  listSkills?: () => Promise<LiveEngineSkill[]>;
  /** Injectable managed write (defaults to writeManagedSkill). Returns location. */
  writeSkill?: (name: string, description: string | undefined, body: string) => string;
  /** Injectable re-scan (defaults to opencodeClient.reloadSkills). */
  reloadSkills?: () => Promise<unknown>;
  /**
   * Injectable reader for a live skill's current on-disk body, used to snapshot
   * the pre-apply bytes for revert. Defaults to a guarded `fs.readFileSync` of
   * the live `location` (which is a SKILL.md path). Returns null if unreadable.
   */
  readOriginal?: (location: string) => string | null;
}

/** Stable hash of a candidate body, used by the duplicate-apply guard. */
export function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Default reader: read the live skill file off disk. Guarded; never throws. */
function defaultReadOriginal(location: string): string | null {
  try {
    // Lazy require so the fs import never lands in a test bundle's hot path.
    // (Under isTestEnv this is never reached — apply() short-circuits first.)
    const { readFileSync } = require('fs') as typeof import('fs');
    return readFileSync(location, 'utf8');
  } catch (err) {
    logger.warn(`[skill-apply] could not read original at ${location} (non-fatal): ${String(err)}`);
    return null;
  }
}

/**
 * Resolve the apply target among the LIVE engine skills by exact (case-insensitive)
 * `name`. Relevance-based same-skill matching is the refiner's job (it already
 * resolves the candidate `name` from getRelevantSkills/findByName before calling
 * here); this is the final exact-name confirmation against the live set so we
 * never apply to a name the engine does not actually have.
 */
export function resolveLiveTarget(
  name: string,
  live: LiveEngineSkill[],
): LiveEngineSkill | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  return live.find((s) => (s.name ?? '').trim().toLowerCase() === want) ?? null;
}

/**
 * Apply a revision to a live engine skill. Returns an {@link ApplyOutcome}.
 * NEVER throws.
 */
export async function applyToEngineSkill(
  candidate: ApplyCandidate,
  deps: ApplyDeps = {},
): Promise<ApplyOutcome> {
  try {
    // Hard guard: ZERO real LLM/FS side effects under test. A test exercising the
    // real branch clears VITEST/NODE_ENV AND injects writeSkill/reloadSkills.
    if (isTestEnv() && !deps.writeSkill) return 'skipped';
    // Local-agent only — never apply on the production Postgres path.
    if (env.dbClient === 'postgres') return 'skipped';

    const repo = deps.repo ?? new AgentSkillsRepository();
    const listSkills = deps.listSkills ?? (() => opencodeClient.listSkills());
    const writeSkill =
      deps.writeSkill ??
      ((name, description, body) => writeManagedSkill({ name, description, body }));
    const reloadSkills = deps.reloadSkills ?? (() => opencodeClient.reloadSkills());
    const readOriginal = deps.readOriginal ?? defaultReadOriginal;

    // 1. Target resolution over the LIVE set.
    const live = await listSkills();
    const target = resolveLiveTarget(candidate.name, live);
    if (!target) {
      logger.info(`[skill-apply] no live engine skill named '${candidate.name}' — skipping`);
      return 'no-target';
    }

    // 2. Pre-apply gate (cheap, unchanged): confidence floor AND >= existing.
    if (candidate.confidence < CONFIDENCE_FLOOR) {
      logger.info(
        `[skill-apply] '${candidate.name}' confidence ${candidate.confidence} < floor ${CONFIDENCE_FLOOR} — not applied`,
      );
      return 'skipped-gate';
    }
    const sidecar = repo.findByName(target.name);
    const existingConfidence = sidecar?.confidence ?? 0;
    if (candidate.confidence < existingConfidence) {
      logger.info(
        `[skill-apply] '${candidate.name}' confidence ${candidate.confidence} < existing ${existingConfidence} — not applied`,
      );
      return 'skipped-gate';
    }

    // The engine version the revision is based on. For a row whose revision is
    // already in flight (`measuring`) or rolled back (`reverted`), the base the
    // candidate is conceptually based on is the row's RECORDED base_version (the
    // pre-apply version), not its bumped `version` — so a re-distill of the same
    // body while measuring resolves to the same base and the duplicate guard
    // fires. Otherwise (active/draft/first-seen) the base is the current version.
    const inFlight = sidecar?.status === 'measuring' || sidecar?.status === 'reverted';
    const baseVersion = inFlight
      ? sidecar?.baseVersion ?? sidecar?.version ?? 1
      : sidecar?.version ?? 1;
    const candidateHash = hashBody(candidate.body);

    // 3. Duplicate-apply guard: skip if this exact revision is in flight
    //    (measuring) or already lost (reverted) for the same name+base.
    if (repo.hasAutoAppliedRow(target.name, baseVersion, candidateHash)) {
      logger.info(
        `[skill-apply] duplicate apply for '${candidate.name}' (base v${baseVersion}) — skipping`,
      );
      return 'skipped-duplicate';
    }

    const managed = isManagedLocation(target.location);

    // For an EXTERNAL target the revert must restore the original file by removing
    // the shadow, so snapshot its bytes. For a MANAGED target snapshot the current
    // managed body so revert restores the prior in-place content.
    const priorBody = readOriginal(target.location);

    // 4. Apply — write ALWAYS goes through the managed-dir boundary (writeSkill).
    //    For managed: overwrites the same managed SKILL.md (revise in place).
    //    For external: writes a same-`name` managed SHADOW; the external original
    //    at target.location is NEVER touched.
    try {
      writeSkill(target.name, candidate.description ?? target.description, candidate.body);
    } catch (err) {
      if (err instanceof InvalidSkillNameError) {
        // Defence in depth: a name that can't resolve inside the managed dir is
        // rejected rather than written anywhere unsafe.
        logger.warn(`[skill-apply] rejected unsafe skill name '${candidate.name}': ${err.message}`);
        return 'skipped';
      }
      throw err;
    }

    // 5. Record the sidecar `measuring` row + base_version snapshot (rollback fuel).
    repo.recordAutoApply({
      name: target.name,
      baseVersion,
      revisedBody: candidate.body,
      priorBody,
      candidateHash,
      isExternal: !managed,
      originLocation: target.location,
      confidence: candidate.confidence,
      source: candidate.source,
      description: candidate.description ?? target.description ?? null,
    });

    // 6. Re-scan so the engine immediately serves the revised/forked skill.
    await reloadSkills();

    logger.info(
      `[skill-apply] applied '${candidate.name}' (${managed ? 'managed in-place' : 'external fork-to-shadow'}, base v${baseVersion} → measuring)`,
    );
    return managed ? 'applied-managed' : 'applied-external-fork';
  } catch (err) {
    // NEVER throw — the loop callers are fire-and-forget.
    logger.warn(`[skill-apply] FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}

/**
 * #794 + #795 wiring — apply a revision AND immediately measure it in the SAME
 * fire-and-forget pass. `applyToEngineSkill` leaves the sidecar row at
 * `status='measuring'`; without this chain the row would stay `measuring`
 * forever (never measured, never auto-reverted). Here we hand the just-applied
 * `measuring` row to #795's `measureAppliedSkill`, which scores baseline vs.
 * post and either KEEPS it (→ active) or AUTO-REVERTS it (→ reverted).
 *
 * Operational envelope is preserved end-to-end:
 *   • NEVER throws — the loop callers are fire-and-forget.
 *   • Under isTestEnv / VITEST with no injected `writeSkill`, `applyToEngineSkill`
 *     short-circuits to 'skipped' BEFORE any apply, so measure is never reached
 *     (zero LLM calls / zero writes).
 *   • Postgres is a no-op via the same short-circuit in `applyToEngineSkill`.
 *   • The measure step is itself never-throws and fail-closed.
 *
 * Only an outcome that actually moved a row to `measuring`
 * (`applied-managed` / `applied-external-fork`) triggers a measure; every other
 * outcome (gate/duplicate/no-target/skipped) is returned untouched.
 *
 * `skill_measurement` is imported lazily to avoid an eval-time circular import
 * (skill_apply → skill_measurement → skill_refiner → skill_apply), mirroring the
 * lazy-import pattern used elsewhere in the loop.
 */
export async function applyAndMeasure(
  candidate: ApplyCandidate,
  deps: ApplyDeps & { measure?: MeasureFn } = {},
): Promise<ApplyOutcome> {
  const outcome = await applyToEngineSkill(candidate, deps);
  if (outcome !== 'applied-managed' && outcome !== 'applied-external-fork') {
    return outcome;
  }
  try {
    const repo = deps.repo ?? new AgentSkillsRepository();
    // The just-applied measuring row, resolved by the same name key.
    const row = repo.findByName(candidate.name);
    if (!row || row.status !== 'measuring') {
      // Defensive: nothing to measure (e.g. status raced) — leave as-is.
      return outcome;
    }
    const measure =
      deps.measure ??
      (async (skill) => {
        const { measureAppliedSkill } = await import('./skill_measurement');
        // Thread the same repo so apply + measure operate on one DB; measure's
        // own deps default to the real scorer / managed-skill IO / reloadSkills.
        return measureAppliedSkill(skill, { repo });
      });
    await measure(row);
  } catch (err) {
    // NEVER throw — apply already succeeded; a measure failure is non-fatal and
    // the startup crash-recovery (#795) will revert any row left stuck measuring.
    logger.warn(`[skill-apply] measure-after-apply FAILED (non-fatal): ${String(err)}`);
  }
  return outcome;
}

/** Injectable measure hook (defaults to #795's measureAppliedSkill). */
export type MeasureFn = (skill: AgentSkill) => Promise<unknown>;

/** Re-exported for the refiner so a single AgentSkill maps to an apply target. */
export type { AgentSkill };
