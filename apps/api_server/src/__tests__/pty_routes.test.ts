/**
 * Route-level tests for PTY lifecycle endpoints:
 *   POST /agent-sessions/:id/pty  — create a PTY in the session's cwd
 *   PATCH /pty/:id                — resize
 *   DELETE /pty/:id               — kill
 *
 * Uses a real HTTP server + global fetch (no supertest).
 * Services are vi.mock'd — no DB, no real opencode process.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';

// --- Hoisted stubs to avoid TDZ issues with vi.mock factories ----------------
const stubs = vi.hoisted(() => ({
  createPty: vi.fn(),
  resizePty: vi.fn(),
  removePty: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    createPty: stubs.createPty,
    resizePty: stubs.resizePty,
    removePty: stubs.removePty,
  },
}));

vi.mock('../repositories/agent_sessions_repository', () => ({
  AgentSessionsRepository: class {
    findById = stubs.findById;
  },
}));

import express from 'express';
import { ptyRouter } from '../routes/pty_routes';
import { AppError } from '../errors/app_error';

let server: http.Server;
let base: string;

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(ptyRouter);
  // Minimal error handler mirroring app's AppError → statusCode mapping.
  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      const status = err instanceof AppError ? err.statusCode : (err.status ?? 500);
      res.status(status).json({ error: err.message });
    },
  );
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('POST /agent-sessions/:id/pty', () => {
  it('200 — creates PTY in session cwd; returns ptyId', async () => {
    stubs.findById.mockReturnValue({ id: 's1', cwd: '/work' });
    stubs.createPty.mockResolvedValue({ id: 'pty_1', pid: 1234, status: 'open' });

    const { status, body } = await req('POST', '/agent-sessions/s1/pty');

    expect(status).toBe(200);
    expect(body).toEqual({ ptyId: 'pty_1' });
    expect(stubs.createPty).toHaveBeenCalledWith({ cwd: '/work' });
  });

  it('404 — session not found', async () => {
    stubs.findById.mockReturnValue(null);

    const { status } = await req('POST', '/agent-sessions/missing/pty');

    expect(status).toBe(404);
  });
});

describe('PATCH /pty/:id', () => {
  it('200 — resize with valid cols/rows; calls resizePty', async () => {
    stubs.resizePty.mockResolvedValue(undefined);

    const { status } = await req('PATCH', '/pty/pty_1', { cols: 80, rows: 24 });

    expect(status).toBe(200);
    expect(stubs.resizePty).toHaveBeenCalledWith('pty_1', 80, 24);
  });

  it('400 — missing cols/rows', async () => {
    const { status } = await req('PATCH', '/pty/pty_1', {});

    expect(status).toBe(400);
  });
});

describe('DELETE /pty/:id', () => {
  it('204 — kills PTY; calls removePty', async () => {
    stubs.removePty.mockResolvedValue(undefined);

    const { status } = await req('DELETE', '/pty/pty_1');

    expect(status).toBe(204);
    expect(stubs.removePty).toHaveBeenCalledWith('pty_1');
  });
});
