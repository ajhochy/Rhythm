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
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  writeManagedSkill,
  deleteManagedSkill,
  isManagedLocation,
  readSkillContentAtLocation,
  InvalidSkillNameError,
} from '../services/rhythm_managed_skills';

export const opencodeSkillsRouter = Router();

/** Shape returned to clients — no `content` (the full SKILL.md body). */
interface SkillListEntry {
  name: string;
  description?: string;
  location: string;
  /** True when this skill lives in the Rhythm-managed dir (writable/deletable). */
  managed: boolean;
}

/**
 * #793 — the #792 sidecar metadata joined onto a live engine skill by `name`.
 * Auto-apply lifecycle (`active`/`measuring`/`reverted`) + baseline/post scores;
 * NOT a review queue. Present only when the caller passes `?withMetadata=true`.
 */
interface SkillMetadata {
  confidence: number | null;
  version: number;
  status: 'active' | 'measuring' | 'reverted' | null;
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
};

const VALID_STATUSES = new Set(['active', 'measuring', 'reverted']);

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
      }));

      if (req.query.withMetadata !== 'true') {
        res.json(entries);
        return;
      }

      // Join the #792 sidecar metadata onto each live engine skill by `name`.
      // O(n) over the live set: one query per name via findByName (the repo
      // collates name → the `title` column). The live set is the source of
      // truth for which names exist — the join never adds or drops a name, so
      // a sidecar row that targets no live skill simply does not appear, and a
      // sidecar row with status measuring/reverted surfaces only as metadata.
      const repo = new AgentSkillsRepository();
      const withMetadata: SkillListEntryWithMetadata[] = entries.map((entry) => {
        const row = repo.findByName(entry.name);
        if (!row) {
          return { ...entry, metadata: { ...DEFAULT_METADATA } };
        }
        const status = VALID_STATUSES.has(row.status)
          ? (row.status as 'active' | 'measuring' | 'reverted')
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
      throw err;
    }

    // Re-scan so the new/edited skill is immediately discoverable.
    await opencodeClient.reloadSkills();

    res.json({
      name: name.trim(),
      description,
      location,
      managed: true,
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
