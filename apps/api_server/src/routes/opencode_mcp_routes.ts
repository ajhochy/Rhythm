/**
 * OPC-M4-3 — MCP server management routes.
 *
 * Mounted at /opencode/mcp in app.ts.
 *
 * Routes:
 *   GET    /opencode/mcp                  → list all MCP servers (status map → array)
 *   POST   /opencode/mcp                  → add a new MCP server (name + command or url)
 *   POST   /opencode/mcp/:name/connect    → connect a named server
 *   POST   /opencode/mcp/:name/disconnect → disconnect a named server
 *   DELETE /opencode/mcp/:name            → remove a named server
 *
 * All SDK errors are forwarded to next(err) — the error handler converts
 * AppError instances to structured JSON with the correct HTTP status code.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app_error';
import { opencodeClient } from '../services/opencode_engine';

export const opencodeMcpRouter = Router();

// ── GET / — list all MCP servers ────────────────────────────────────────────

opencodeMcpRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const statusMap = await opencodeClient.listMcp();
      // Convert map { name → entry } → array [{ name, status, error?, … }]
      const entries = Object.entries(statusMap).map(([name, entry]) => ({
        name,
        ...entry,
      }));
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST / — add a new MCP server ───────────────────────────────────────────

opencodeMcpRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, command, url } = req.body as {
        name?: string;
        command?: string;
        url?: string;
      };

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return next(
          new AppError(400, 'BAD_REQUEST', 'name is required to add an MCP server'),
        );
      }

      if ((!command || command.trim() === '') && (!url || url.trim() === '')) {
        return next(
          new AppError(
            400,
            'BAD_REQUEST',
            'Either command (for local servers) or url (for remote servers) is required',
          ),
        );
      }

      let config: import('@opencode-ai/sdk').McpLocalConfigInput | import('@opencode-ai/sdk').McpRemoteConfigInput;

      if (url && url.trim() !== '') {
        config = { type: 'remote', url: url.trim() };
      } else {
        // Split command string into argv array.
        const argv = (command as string).trim().split(/\s+/);
        config = { type: 'local', command: argv };
      }

      const updated = await opencodeClient.addMcp(name.trim(), config);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /rhythm/ensure — auto-install/refresh the rhythm MCP server ─────────
opencodeMcpRouter.post(
  '/rhythm/ensure',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { apiToken, apiUrl } = req.body as {
        apiToken?: string;
        apiUrl?: string;
      };
      if (!apiToken || apiToken.trim() === '') {
        return next(new AppError(400, 'BAD_REQUEST', 'apiToken is required'));
      }
      const result = await opencodeClient.ensureRhythmMcp(
        apiToken.trim(),
        (apiUrl && apiUrl.trim()) || 'https://api.vcrcapps.com',
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /:name/connect ──────────────────────────────────────────────────────

opencodeMcpRouter.post(
  '/:name/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const ok = await opencodeClient.connectMcp(name);
      res.json({ ok });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /:name/disconnect ───────────────────────────────────────────────────

opencodeMcpRouter.post(
  '/:name/disconnect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const ok = await opencodeClient.disconnectMcp(name);
      res.json({ ok });
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /:name ─────────────────────────────────────────────────────────────

opencodeMcpRouter.delete(
  '/:name',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      await opencodeClient.removeMcp(name);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
