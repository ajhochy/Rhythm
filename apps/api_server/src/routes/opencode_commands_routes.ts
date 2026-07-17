/**
 * OCU-09 (#1050) — Playbooks backend: custom slash-command CRUD.
 *
 * Mirrors opencode_skills_routes.ts. Engine slash commands live at
 * `<config-dir>/commands/<name>.md`. These routes let Flutter author
 * Rhythm-managed command files, then POST /config/reload so they go live
 * without an engine restart.
 *
 * Routes (mounted at /opencode/commands):
 *   GET    /                 → engine command.list merged with on-disk managed
 *                              flag (managed=true → Rhythm-editable)
 *   GET    /:name/content    → frontmatter + body for one managed command
 *   POST   /                 → create a managed command (kebab-case, no
 *                              collision with a built-in/mcp/skill → 409), reload
 *   PUT    /:name            → overwrite a managed command (preserves unknown
 *                              frontmatter keys), reload
 *   DELETE /:name            → delete a managed command (managed files only —
 *                              refuses built-ins with 400), reload
 *
 * Write/delete are confined to the Rhythm-managed dir. Built-in (init/review),
 * MCP-prompt, and skill-sourced commands are read-only here.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';
import {
  writeManagedCommand,
  readManagedCommand,
  deleteManagedCommand,
  isManagedCommand,
  validateCommandName,
  InvalidCommandNameError,
} from '../services/rhythm_managed_commands';

export const opencodeCommandsRouter = Router();

/** Frontmatter keys this module models explicitly (everything else is preserved verbatim on PUT). */
const KNOWN_FM_KEYS = new Set(['description', 'agent', 'model', 'subtask']);

// ── GET / — list engine commands with a managed flag ─────────────────────────

opencodeCommandsRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const commands = await opencodeClient.listCommands();
      const entries = commands.map((c) => ({
        name: c.name,
        description: c.description,
        source: c.source ?? 'command',
        // A row is Rhythm-managed (editable/deletable) only when a managed file
        // actually exists for it — a built-in 'command'-source row like
        // init/review has no managed file and stays read-only.
        managed: isManagedCommand(c.name),
      }));
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /:name/content — frontmatter + body for one managed command ──────────

opencodeCommandsRouter.get(
  '/:name/content',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      let entry;
      try {
        entry = readManagedCommand(name);
      } catch (err) {
        if (err instanceof InvalidCommandNameError) {
          return next(new AppError(400, 'BAD_REQUEST', err.message));
        }
        throw err;
      }
      if (!entry) {
        return next(
          new AppError(404, 'NOT_FOUND', `No Rhythm-managed command named '${name}'`),
        );
      }
      res.json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST / — create a managed command ────────────────────────────────────────

opencodeCommandsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as {
      name?: string;
      description?: string;
      agent?: string;
      model?: string;
      subtask?: boolean;
      template?: string;
    };
    try {
      let name: string;
      try {
        name = validateCommandName(body.name ?? '');
      } catch (err) {
        if (err instanceof InvalidCommandNameError) {
          return next(new AppError(400, 'BAD_REQUEST', err.message));
        }
        throw err;
      }
      if (typeof body.template !== 'string' || body.template.trim() === '') {
        return next(new AppError(400, 'BAD_REQUEST', 'template (the command body) is required'));
      }

      // Collision guard: refuse to shadow a built-in / MCP / skill command, and
      // refuse to silently overwrite an existing managed command on POST (use
      // PUT for edits). Any engine command name that is NOT already a managed
      // file is off-limits for create.
      const engineNames = new Set((await opencodeClient.listCommands()).map((c) => c.name));
      if (engineNames.has(name) && !isManagedCommand(name)) {
        return next(
          new AppError(409, 'CONFLICT', `Command '${name}' collides with a built-in/MCP/skill command`),
        );
      }
      if (isManagedCommand(name)) {
        return next(
          new AppError(409, 'CONFLICT', `A managed command named '${name}' already exists (use PUT to edit)`),
        );
      }

      writeManagedCommand({
        name,
        description: body.description,
        agent: body.agent,
        model: body.model,
        subtask: body.subtask,
        template: body.template,
      });
      await opencodeClient.reloadConfig();
      res.json(readManagedCommand(name));
    } catch (err) {
      next(err);
    }
  },
);

// ── PUT /:name — overwrite a managed command (preserving unknown frontmatter) ─

opencodeCommandsRouter.put(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as {
      description?: string;
      agent?: string;
      model?: string;
      subtask?: boolean;
      template?: string;
    };
    try {
      let name: string;
      try {
        name = validateCommandName(req.params.name);
      } catch (err) {
        if (err instanceof InvalidCommandNameError) {
          return next(new AppError(400, 'BAD_REQUEST', err.message));
        }
        throw err;
      }
      // PUT is edit-only: refuse to create via PUT if the name isn't already a
      // managed file, and refuse to write over a built-in/MCP/skill name.
      if (!isManagedCommand(name)) {
        const engineNames = new Set((await opencodeClient.listCommands()).map((c) => c.name));
        if (engineNames.has(name)) {
          return next(
            new AppError(409, 'CONFLICT', `Command '${name}' is a built-in/MCP/skill command and cannot be edited`),
          );
        }
        return next(new AppError(404, 'NOT_FOUND', `No Rhythm-managed command named '${name}'`));
      }
      if (typeof body.template !== 'string' || body.template.trim() === '') {
        return next(new AppError(400, 'BAD_REQUEST', 'template (the command body) is required'));
      }

      // Preserve any unknown frontmatter keys already on the file.
      const existing = readManagedCommand(name);
      const extraFrontmatter: Record<string, unknown> = {};
      if (existing) {
        for (const [k, v] of Object.entries(existing.frontmatter)) {
          if (!KNOWN_FM_KEYS.has(k)) extraFrontmatter[k] = v;
        }
      }

      writeManagedCommand(
        {
          name,
          description: body.description,
          agent: body.agent,
          model: body.model,
          subtask: body.subtask,
          template: body.template,
        },
        extraFrontmatter,
      );
      await opencodeClient.reloadConfig();
      res.json(readManagedCommand(name));
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /:name — delete a managed command (managed files only) ────────────

opencodeCommandsRouter.delete(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      let removed: boolean;
      try {
        removed = deleteManagedCommand(name);
      } catch (err) {
        if (err instanceof InvalidCommandNameError) {
          return next(new AppError(400, 'BAD_REQUEST', err.message));
        }
        throw err;
      }
      if (!removed) {
        return next(
          new AppError(
            400,
            'NOT_MANAGED',
            `No Rhythm-managed command named '${name}' (built-in/MCP/skill commands cannot be deleted)`,
          ),
        );
      }
      await opencodeClient.reloadConfig();
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
