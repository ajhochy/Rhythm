/**
 * D1 — agent_designs CRUD route tests + graphic-designer role-file validation
 *
 * Criteria covered:
 *   - GET /agent-designs returns [] on empty DB (schema-drift gate)
 *   - POST /agent-designs creates a design record and returns it
 *   - GET /agent-designs/:id returns the design
 *   - DELETE /agent-designs/:id returns 204
 *   - GET /agent-designs/:id returns 404 for unknown id
 *   - graphic-designer.mcp.json parses and scopes only canva
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ── graphic-designer.mcp.json role-file validation ────────────────────────

describe('D1 — graphic-designer.mcp.json role file', () => {
  it('parses without error and scopes only canva', () => {
    const rolePath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '.mcp-roles',
      'graphic-designer.mcp.json',
    );
    expect(fs.existsSync(rolePath)).toBe(true);

    const raw = fs.readFileSync(rolePath, 'utf8');
    const role = JSON.parse(raw) as {
      role: string;
      mcpServers: Record<string, { allowedTools?: string[]; type?: string; url?: string }>;
      disabledMcpServers: string[];
    };

    expect(role.role).toBe('graphic-designer');

    // Must contain exactly canva, no others.
    expect(Object.keys(role.mcpServers)).toContain('canva');
    // Should not accidentally include bash, filesystem, etc.
    expect(Object.keys(role.mcpServers)).not.toContain('bash');
    expect(Object.keys(role.mcpServers)).not.toContain('filesystem');

    // canva must have allowedTools scoped to design tools.
    const canvaTools = role.mcpServers.canva?.allowedTools ?? [];
    expect(canvaTools.length).toBeGreaterThan(0);
    expect(canvaTools).toContain('generate-design');
    expect(canvaTools).toContain('export-design');
    expect(canvaTools).toContain('get-design');

    // disabledMcpServers must include the four dangerous server types.
    const disabled = role.disabledMcpServers;
    expect(disabled).toContain('bash');
    expect(disabled).toContain('computer');
    expect(disabled).toContain('editor');
    expect(disabled).toContain('filesystem');
  });
});

// ── /agent-designs HTTP route ─────────────────────────────────────────────

describe('D1 — /agent-designs CRUD (authenticated)', () => {
  let baseUrl: string;
  let authHeader: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Designer', email: 'designer@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeader = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('GET /agent-designs returns [] on empty DB', async () => {
    const res = await fetch(`${baseUrl}/agent-designs`, {
      headers: authHeader,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('POST /agent-designs creates a design record and returns it', async () => {
    const res = await fetch(`${baseUrl}/agent-designs`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Church Banner',
        canvaUrl: 'https://canva.com/design/abc',
        artifactType: 'png',
        thumbnailUrl: 'https://canva.com/thumb/abc.png',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.title).toBe('Church Banner');
    expect(body.canvaUrl).toBe('https://canva.com/design/abc');
    expect(body.artifactType).toBe('png');
    expect(body.thumbnailUrl).toBe('https://canva.com/thumb/abc.png');
    expect(typeof body.createdAt).toBe('string');
  });

  it('records a local image under Rhythm Studio and serves it safely', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-design-home-'));
    const studio = path.join(home, 'Downloads', 'Rhythm Studio');
    fs.mkdirSync(studio, { recursive: true });
    const image = path.join(studio, 'slide.png');
    fs.writeFileSync(image, 'synthetic-png');
    vi.stubEnv('HOME', home);
    try {
      const create = await fetch(`${baseUrl}/agent-designs`, {
        method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Local slide', localPath: image }),
      });
      expect(create.status).toBe(201);
      const design = (await create.json()) as { id: string; artifactType: string; filePath: string };
      expect(design.artifactType).toBe('png');
      expect(design.filePath).toBe(fs.realpathSync(image));
      const artifact = await fetch(`${baseUrl}/agent-designs/${design.id}/artifact`, { headers: authHeader });
      expect(artifact.status).toBe(200);
      expect(await artifact.text()).toBe('synthetic-png');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects traversal, symlink escape, unsupported local types, and non-Canva URLs', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-design-home-'));
    const studio = path.join(home, 'Downloads', 'Rhythm Studio');
    const outside = path.join(home, 'outside');
    fs.mkdirSync(studio, { recursive: true });
    fs.mkdirSync(outside);
    const secret = path.join(outside, 'secret.png');
    fs.writeFileSync(secret, 'secret');
    fs.symlinkSync(outside, path.join(studio, 'escape'));
    vi.stubEnv('HOME', home);
    try {
      for (const finalPath of [path.join(studio, '..', '..', 'outside', 'secret.png'), path.join(studio, 'escape', 'secret.png'), path.join(studio, 'bad.txt')]) {
        if (finalPath.endsWith('bad.txt')) fs.writeFileSync(finalPath, 'bad');
        const response = await fetch(`${baseUrl}/agent-designs`, {
          method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Unsafe', localPath: finalPath }),
        });
        expect(response.status).toBe(400);
      }
      const response = await fetch(`${baseUrl}/agent-designs`, {
        method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Unsafe URL', canvaUrl: 'file:///secret.png' }),
      });
      expect(response.status).toBe(400);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('GET /agent-designs/:id returns the design', async () => {
    const createRes = await fetch(`${baseUrl}/agent-designs`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'My Design' }),
    });
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${baseUrl}/agent-designs/${created.id}`, {
      headers: authHeader,
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Record<string, unknown>;
    expect(body.id).toBe(created.id);
    expect(body.title).toBe('My Design');
  });

  it('DELETE /agent-designs/:id returns 204', async () => {
    const createRes = await fetch(`${baseUrl}/agent-designs`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'To delete' }),
    });
    const created = (await createRes.json()) as { id: string };

    const delRes = await fetch(`${baseUrl}/agent-designs/${created.id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(delRes.status).toBe(204);

    // Subsequent GET should 404
    const getRes = await fetch(`${baseUrl}/agent-designs/${created.id}`, {
      headers: authHeader,
    });
    expect(getRes.status).toBe(404);
  });

  it('GET /agent-designs/:id returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-designs/nonexistent-id-xyz`, {
      headers: authHeader,
    });
    expect(res.status).toBe(404);
  });
});

describe('D1 — /agent-designs CRUD (unauthenticated)', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'false');

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);

    const { createApp } = await import('../app');
    const { startTestServer } = await import('./helpers/real_server');
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('GET /agent-designs returns 401 when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/agent-designs`);
    expect(res.status).toBe(401);
  });
});
