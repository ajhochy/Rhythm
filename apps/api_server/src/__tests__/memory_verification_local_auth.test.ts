import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

describe('MEM-OKF #1190 local human-verification authentication', () => {
  let db: Database.Database;
  let memoryDir: string;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let parseMemoryNote: typeof import('../services/memory_note_format').parseMemoryNote;
  let authHeaders: Record<string, string>;

  beforeAll(async () => {
    vi.resetModules();
    memoryDir = mkdtempSync(path.join(tmpdir(), 'mem-verify-local-auth-'));
    vi.stubEnv('AGENT_LOCAL', 'true');
    vi.stubEnv('MEMORY_VAULT_PATH', memoryDir);
    vi.stubEnv('MEMORY_VAULT_SUBDIR', '');

    const [
      { createApp },
      { setDb },
      { runMigrations },
      { UsersRepository },
      { SessionsRepository },
      memoryFormat,
    ] = await Promise.all([
      import('../app'),
      import('../database/db'),
      import('../database/migrations'),
      import('../repositories/users_repository'),
      import('../repositories/sessions_repository'),
      import('../services/memory_note_format'),
    ]);
    parseMemoryNote = memoryFormat.parseMemoryNote;

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    // This user made the old fallback exploitable: an unauthenticated request
    // was silently attributed to the first non-system row.
    const victim = new UsersRepository().create({
      name: 'Victim',
      email: 'victim@example.com',
    });
    const session = await new SessionsRepository().createAsync(victim.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };

    const server = createApp().listen(0);
    server.maxRequestsPerSocket = 1;
    await new Promise<void>((resolve) =>
      server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  afterAll(async () => {
    await closeServer();
    db.close();
    rmSync(memoryDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('cannot mint human trust without req.auth, while the MCP lane stays machine-only', async () => {
    const createdResponse = await fetch(`${baseUrl}/agent-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'fact',
        content: 'Unauthenticated human-trust adversarial marker.',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      id: string;
      path: string;
    };

    const humanResponse = await fetch(
      `${baseUrl}/agent-memory/${created.id}/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ by: 'human:victim@example.com' }),
      },
    );
    expect(humanResponse.status).toBe(401);

    const notePath = path.join(memoryDir, created.path);
    expect(parseMemoryNote(readFileSync(notePath, 'utf8')).verified).toEqual([]);

    const authenticatedHumanResponse = await fetch(
      `${baseUrl}/agent-memory/${created.id}/verify`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ by: 'human:forged@example.com' }),
      },
    );
    expect(authenticatedHumanResponse.status).toBe(200);
    expect(parseMemoryNote(readFileSync(notePath, 'utf8')).verified)
      .toMatchObject([{ by: 'human:victim@example.com' }]);

    const machineResponse = await fetch(
      `${baseUrl}/agent-memory/${created.id}/agent-lifecycle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          by: 'human:victim@example.com',
        }),
      },
    );
    expect(machineResponse.status).toBe(200);
    const note = parseMemoryNote(readFileSync(notePath, 'utf8'));
    expect(note.verified).toHaveLength(2);
    expect(note.verified[0].by).toBe('human:victim@example.com');
    expect(note.verified[1].by).toBe('agent:rhythm-mcp/1');
    expect(note.verified.some(({ by }) => by === 'human:forged@example.com'))
      .toBe(false);
  });
});
