/**
 * Unify-2 — Skills source-of-truth routes.
 *
 * Mounted at /opencode/skills in app.ts.
 *
 * The opencode fork's filesystem skill store is the single source of truth for
 * skills. These routes let Flutter (and agent_profile_sync) read the fork's live
 * discovered skills and let users author Rhythm-owned skills into a dedicated
 * managed dir that the fork scans (registered via config.skills.paths).
 *
 * Routes:
 *   GET    /opencode/skills              → live fork skills (content stripped) + `managed` flag
 *   GET    /opencode/skills/:name/content → full SKILL.md body for one skill (managed OR external)
 *   POST   /opencode/skills              → create/overwrite a Rhythm-managed skill, then reload
 *   PUT    /opencode/skills/:name        → overwrite a Rhythm-managed skill, then reload
 *   DELETE /opencode/skills/:name        → delete a Rhythm-managed skill, then reload
 *
 * Write/delete are confined to the Rhythm-managed dir. External skills (plugins,
 * ~/.claude/skills, superpowers, anthropic-skills) are read-only here — they are
 * shown (and VIEWABLE via the content route) and can be scoped, but never
 * written or deleted.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  writeManagedSkill,
  deleteManagedSkill,
  isManagedLocation,
  readSkillContentAtLocation,
  InvalidSkillNameError,
  ContextInjectionBlockedError,
} from '../services/rhythm_managed_skills';
import { parseSkillFrontmatter, type SkillFrontmatter } from '../services/skill_frontmatter';
import { checkRequiredEnv } from '../services/skill_env_validator';
import { isSkillVisible } from '../services/skill_visibility';
import { resolveSessionToolsets } from '../services/session_toolset_resolver';
import { countSkillToolUses } from '../services/skill_usage_tracker';

export const opencodeSkillsRouter = Router();

/** Provenance of a live skill, surfaced to the Flutter Skills UI (#1055). */
type SkillSource = 'managed' | 'org' | 'external';

/**
 * Root dir the opencode engine caches `skills.urls`-pulled org skills under
 * (`<xdg-cache>/opencode/skills` — see apps/opencode_fork's
 * `skill/discovery.ts` `Discovery.pull`, which downloads each org skill's
 * files under `Global.Path.cache/skills/<name>/`). Rhythm mirrors the same
 * plain `~/.cache` default (`xdg-basedir`'s fallback when `XDG_CACHE_HOME` is
 * unset — no macOS-specific translation) rather than importing the vendored
 * fork (AGENTS.md: never wire `apps/opencode_fork` into the api_server build).
 * Overridable for tests via `RHYTHM_ORG_SKILLS_CACHE_DIR`, mirroring
 * `RHYTHM_MANAGED_SKILLS_DIR` in rhythm_managed_skills.ts. #1054 wires the
 * engine's `skills.urls` at this same default; this route only needs to
 * recognize the resulting location.
 */
function orgSkillsCacheRoot(): string {
  return (
    process.env.RHYTHM_ORG_SKILLS_CACHE_DIR ??
    join(homedir(), '.cache', 'opencode', 'skills')
  );
}

/** True when a fork-reported skill `location` lives inside the org skills cache. */
function isOrgLocation(location: string | undefined | null): boolean {
  if (!location) return false;
  const root = resolve(orgSkillsCacheRoot());
  const loc = resolve(location);
  return loc === root || loc.startsWith(root + sep);
}

/**
 * #1055 — classify a live engine skill's provenance: `managed` (Rhythm-authored,
 * writable), `org` (pulled from the shared org index via `skills.urls` —
 * read-only), or `external` (everything else: engine built-ins,
 * `~/.claude/skills`, plugins, etc — also read-only).
 */
function classifySkillSource(location: string | undefined | null): SkillSource {
  if (isManagedLocation(location)) return 'managed';
  if (isOrgLocation(location)) return 'org';
  return 'external';
}

/** Shape returned to clients — no `content` (the full SKILL.md body). */
interface SkillListEntry {
  name: string;
  description?: string;
  location: string;
  /** True when this skill lives in the Rhythm-managed dir (writable/deletable). */
  managed: boolean;
  /** #1055 — provenance for the Skills UI source badge. */
  source: SkillSource;
}

/**
 * #793 — the #792 sidecar metadata joined onto a live engine skill by `name`.
 * Auto-apply lifecycle (`active`/`measuring`/`reverted`) + baseline/post scores;
 * NOT a review queue. Present only when the caller passes `?withMetadata=true`.
 */
interface SkillMetadata {
  confidence: number | null;
  version: number;
  /**
   * #929 — 'draft' / 'disabled' / 'rewrite-needed' are the harvested-skill
   * self-regulation lifecycle (see harvested_skill_evaluator.ts), sourced from
   * the draft's OWN frontmatter rather than a #792 sidecar row (harvested
   * drafts have none — see docs/ai/decisions/2026-07-08-harvest-to-file
   * -autobind.md). 'disabled' never actually surfaces here in practice — a
   * disabled draft is moved out of the live/discoverable set entirely — but
   * the type includes it for completeness with the archive's own frontmatter.
   */
  status: 'active' | 'measuring' | 'reverted' | 'draft' | 'disabled' | 'rewrite-needed' | null;
  source: string | null;
  uses: number | null;
  baselineScore: number | null;
  postScore: number | null;
  /**
   * #845 — the LLM-judge's one-sentence rationale for the most recent
   * measurement (see skill_measurement.ts): a scored keep/revert narrative
   * (e.g. `baseline=60 (ok); post=82 (better); decision=keep`) or a
   * `reverted:hash:<sha256>` marker for a revert event. Null when the skill
   * has never been measured.
   */
  measureReason: string | null;
  isExternalFork: boolean;
  /**
   * #874 (setup-04) — required-env-var status parsed from this skill's raw
   * SKILL.md `required_environment_variables` frontmatter. A skill that
   * doesn't declare the field reports `missing: []` / `satisfied: true` —
   * identical to a skill that declares it and has every var already set, so
   * a skill with no declaration behaves exactly as before (no UI change).
   */
  env: {
    missing: string[];
    satisfied: boolean;
  };
}

interface SkillListEntryWithMetadata extends SkillListEntry {
  metadata: SkillMetadata;
}

/**
 * Default metadata returned when a live engine skill has no #792 sidecar row.
 * `version: 1` and `status: 'active'` mirror a freshly-discovered skill that has
 * never been auto-revised; all measurement fields are null.
 */
const DEFAULT_METADATA: SkillMetadata = {
  confidence: null,
  version: 1,
  status: 'active',
  source: null,
  uses: null,
  baselineScore: null,
  postScore: null,
  measureReason: null,
  isExternalFork: false,
  env: { missing: [], satisfied: true },
};

const VALID_STATUSES = new Set(['active', 'measuring', 'reverted', 'draft', 'disabled', 'rewrite-needed']);

// ── GET / — list the fork's live discovered skills ───────────────────────────

opencodeSkillsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const directory =
        typeof req.query.directory === 'string' ? req.query.directory : undefined;
      const skills = await opencodeClient.listSkills(directory);
      const entries: SkillListEntry[] = skills.map((s) => ({
        name: s.name,
        description: s.description,
        location: s.location,
        managed: isManagedLocation(s.location),
        source: classifySkillSource(s.location),
      }));

      // #874/#875/#929 — read each skill's OWN frontmatter straight off disk via
      // its `location`, NOT via the engine's listSkillsWithContent (the fork
      // strips the frontmatter block from `content` before returning it —
      // confirmed live: every skill's `content` starts at the body, never at
      // the leading `---`, so parseSkillFrontmatter(s.content) always saw an
      // empty block and silently fell back to defaults for EVERY skill,
      // including harvested drafts whose real lifecycle lives entirely in
      // frontmatter). readSkillContentAtLocation reads the real file (or
      // returns null for a non-file location like a fork `<built-in>` skill,
      // which degrades to the same "no extended frontmatter" defaults as
      // before). Needed for `required_environment_variables` (#874),
      // `metadata.rhythm.{requires,fallback}_toolsets` (#875), and a harvested
      // draft's OWN status/confidence/source (#929).
      const frontmatterByName = new Map<string, SkillFrontmatter>(
        entries.map((entry) => [
          entry.name,
          parseSkillFrontmatter(readSkillContentAtLocation(entry.location) ?? ''),
        ]),
      );

      // #875 — resolve which toolsets are connected for this session/request.
      // `terminalEnabled` is an optional override (?terminalEnabled=false) for
      // callers/tests that need to simulate terminal being disabled; Rhythm
      // has no per-session terminal toggle yet so it otherwise defaults on
      // (see session_toolset_resolver.ts).
      const terminalEnabledParam = req.query.terminalEnabled;
      const toolsetConfig = await resolveSessionToolsets({
        terminalEnabled: terminalEnabledParam === 'false' ? false : undefined,
      });

      // Apply the #875 visibility gate BEFORE anything else — an invisible
      // skill is absent from both the plain list and the withMetadata list.
      // This is an ADDITIONAL filter alongside (never a replacement for) the
      // allowed_skills_json allowlist enforced later at session-scope time
      // (agent_profile_scope.ts / ws_gateway.ts / agent_runner.ts) — that
      // allowlist is about WHO may use a skill; this is about WHETHER the
      // skill's own declared requirements are met in this environment.
      const visibleEntries = entries.filter((entry) => {
        const fm = frontmatterByName.get(entry.name);
        if (!fm) return true; // no parseable frontmatter → no conditions → visible
        return isSkillVisible(fm, toolsetConfig);
      });

      if (req.query.withMetadata !== 'true') {
        res.json(visibleEntries);
        return;
      }

      // Join the #792 sidecar metadata onto each live engine skill by `name`.
      // O(n) over the live set: one query per name via findByName (the repo
      // collates name → the `title` column). The live set is the source of
      // truth for which names exist — the join never adds or drops a name, so
      // a sidecar row that targets no live skill simply does not appear, and a
      // sidecar row with status measuring/reverted surfaces only as metadata.
      const repo = new AgentSkillsRepository();
      // #929 — real skill-tool-invocation counts (not the legacy DB-preface hint
      // proxy). The ONLY usage signal available for a harvested draft, which has
      // no #792 sidecar row to increment (see skill_usage_tracker.ts header).
      const realUses = countSkillToolUses();

      const withMetadata: SkillListEntryWithMetadata[] = visibleEntries.map((entry) => {
        const fm = frontmatterByName.get(entry.name);
        const check = checkRequiredEnv(fm?.requiredEnv ?? []);
        const env = { missing: check.missing.map((v) => v.name), satisfied: check.allSatisfied };
        const row = repo.findByName(entry.name);
        if (!row) {
          // #929 — a harvested draft (or its disabled-archive counterpart) has
          // no sidecar row, but DOES self-report lifecycle metadata in its own
          // frontmatter (see rhythm_managed_skills.renderDraftSkillMarkdown).
          // Prefer that over the generic DEFAULT_METADATA fallback so the Skills
          // UI shows real status/uses for it instead of a false 'active'.
          if (fm?.status !== undefined) {
            const status = VALID_STATUSES.has(fm.status)
              ? (fm.status as SkillMetadata['status'])
              : null;
            return {
              ...entry,
              metadata: {
                confidence: fm.confidence ?? null,
                version: 1,
                status,
                source: fm.source ?? null,
                uses: realUses.get(entry.name) ?? 0,
                baselineScore: null,
                postScore: fm.postScore ?? null,
                measureReason: fm.measureReason ?? null,
                isExternalFork: false,
                env,
              },
            };
          }
          return { ...entry, metadata: { ...DEFAULT_METADATA, env } };
        }
        const status = VALID_STATUSES.has(row.status)
          ? (row.status as SkillMetadata['status'])
          : null;
        return {
          ...entry,
          metadata: {
            confidence: row.confidence ?? null,
            version: row.version ?? 1,
            status,
            source: row.source ?? null,
            uses: row.uses ?? null,
            baselineScore: row.baselineScore ?? null,
            postScore: row.postScore ?? null,
            measureReason: row.measureReason ?? null,
            isExternalFork: (row.isExternal ?? 0) === 1,
            env,
          },
        };
      });
      res.json(withMetadata);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /:name/content — full SKILL.md body for one skill (view/edit) ────────
//
// Resolves the skill's `location` from the live fork list (the single source of
// truth for which skill names exist) and reads the SKILL.md off disk. Works for
// BOTH managed and external skills so the editor can populate its content box on
// edit and external skills are viewable for reference. Viewing is read-only and
// does NOT change the write-boundary: POST/PUT/DELETE remain confined to the
// managed dir. 404 when the name is not in the live set or the file is missing.

opencodeSkillsRouter.get(
  '/:name/content',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const directory =
        typeof req.query.directory === 'string' ? req.query.directory : undefined;
      const skills = await opencodeClient.listSkills(directory);
      const match = skills.find((s) => s.name === name);
      if (!match) {
        return next(
          new AppError(404, 'NOT_FOUND', `No skill named '${name}' is currently discovered`),
        );
      }
      const content = readSkillContentAtLocation(match.location);
      if (content === null) {
        return next(
          new AppError(
            404,
            'NOT_FOUND',
            `Skill '${name}' has no readable SKILL.md at its location`,
          ),
        );
      }
      res.json({ name: match.name, content });
    } catch (err) {
      next(err);
    }
  },
);

// ── shared create/overwrite handler for POST / and PUT /:name ────────────────

async function upsertManagedSkill(
  name: string,
  description: string | undefined,
  content: string,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(
        new AppError(400, 'BAD_REQUEST', 'name is required to write a skill'),
      );
    }
    if (typeof content !== 'string' || content.trim() === '') {
      return next(
        new AppError(400, 'BAD_REQUEST', 'content (the skill body) is required'),
      );
    }

    let location: string;
    try {
      location = writeManagedSkill({ name: name.trim(), description, body: content });
    } catch (err) {
      if (err instanceof InvalidSkillNameError) {
        return next(new AppError(400, 'BAD_REQUEST', err.message));
      }
      // #873 — the body failed the prompt-injection context scan. Surface the
      // block warning to the client; the skill is not written.
      if (err instanceof ContextInjectionBlockedError) {
        return next(new AppError(400, 'CONTEXT_INJECTION_BLOCKED', err.warning));
      }
      throw err;
    }

    // Re-scan so the new/edited skill is immediately discoverable.
    await opencodeClient.reloadSkills();

    res.json({
      name: name.trim(),
      description,
      location,
      managed: true,
      source: 'managed',
    } satisfies SkillListEntry);
  } catch (err) {
    next(err);
  }
}

// ── POST / — create or overwrite a Rhythm-managed skill ──────────────────────

opencodeSkillsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    const { name, description, content } = req.body as {
      name?: string;
      description?: string;
      content?: string;
    };
    await upsertManagedSkill(name ?? '', description, content ?? '', res, next);
  },
);

// ── PUT /:name — overwrite a Rhythm-managed skill ────────────────────────────

opencodeSkillsRouter.put(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    const { name } = req.params;
    const { description, content } = req.body as {
      description?: string;
      content?: string;
    };
    await upsertManagedSkill(name, description, content ?? '', res, next);
  },
);

// ── DELETE /:name — delete a Rhythm-managed skill ────────────────────────────

opencodeSkillsRouter.delete(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      let removed: boolean;
      try {
        removed = deleteManagedSkill(name);
      } catch (err) {
        if (err instanceof InvalidSkillNameError) {
          return next(new AppError(400, 'BAD_REQUEST', err.message));
        }
        throw err;
      }
      if (!removed) {
        // No managed skill by that name. Either it never existed or it is an
        // external (non-managed) skill — which Rhythm must not delete.
        return next(
          new AppError(
            404,
            'NOT_MANAGED',
            `No Rhythm-managed skill named '${name}' (external skills cannot be deleted)`,
          ),
        );
      }
      await opencodeClient.reloadSkills();
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
