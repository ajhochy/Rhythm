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

it('backfills legacy Canva and local artifact rows without losing their compatibility fields', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE agent_designs (id TEXT PRIMARY KEY, title TEXT, canva_url TEXT, artifact_type TEXT, file_path TEXT, thumbnail_url TEXT, session_id TEXT, created_at TEXT)`);
  db.prepare(`INSERT INTO agent_designs (id, canva_url, file_path) VALUES ('canva', 'https://www.canva.com/design/legacy', NULL), ('local', NULL, '/tmp/legacy.png')`).run();
  runMigrations(db);
  expect(db.prepare(`SELECT provider, project_url FROM agent_designs WHERE id = 'canva'`).get()).toEqual({ provider: 'canva', project_url: 'https://www.canva.com/design/legacy' });
  expect(db.prepare(`SELECT provider FROM agent_designs WHERE id = 'local'`).get()).toEqual({ provider: 'local' });
});

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

  it('persists provider-neutral remote artifacts and legacy Canva project URLs', async () => {
    const res = await fetch(`${baseUrl}/agent-designs`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: ' Church Banner ',
        provider: 'canva',
        artifactUrl: 'https://cdn.example.test/banner.png',
        canvaUrl: 'https://canva.com/design/abc',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.title).toBe('Church Banner');
    expect(body.provider).toBe('canva');
    expect(body.artifactUrl).toBe('https://cdn.example.test/banner.png');
    expect(body.projectUrl).toBe('https://canva.com/design/abc');
    expect(body.canvaUrl).toBe('https://canva.com/design/abc');
    expect(body.artifactType).toBe('png');
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
        body: JSON.stringify({ title: 'Local slide', provider: 'comfyui', localPath: image }),
      });
      expect(create.status).toBe(201);
      const design = (await create.json()) as { id: string; artifactType: string; provider: string; filePath?: string };
      expect(design.artifactType).toBe('png');
      expect(design.provider).toBe('comfyui');
      expect(design.filePath).toBeUndefined();
      const artifact = await fetch(`${baseUrl}/agent-designs/${design.id}/artifact`, { headers: authHeader });
      expect(artifact.status).toBe(200);
      expect(await artifact.text()).toBe('synthetic-png');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects unsafe paths, editable sources, and unsafe URL schemes', async () => {
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
          body: JSON.stringify({ title: 'Unsafe', provider: 'local', localPath: finalPath }),
        });
        expect(response.status).toBe(400);
      }
      const forgedPathApproval = await fetch(`${baseUrl}/agent-designs`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Forged path approval',
          provider: 'local',
          localPath: secret,
          userApprovedPath: true,
        }),
      });
      expect(forgedPathApproval.status).toBe(400);
      for (const body of [
        { title: 'Unsafe URL', provider: 'built-in', artifactUrl: 'http://example.test/file.png' },
        { title: 'Unsafe URL', provider: 'built-in', artifactUrl: 'file:///secret.png' },
        { title: 'Unsafe URL', provider: 'built-in', artifactUrl: 'javascript:alert(1)' },
        { title: 'Unsafe URL', provider: 'built-in', artifactUrl: 'https://example.test/edit.blend' },
        { title: 'Unsafe URL', provider: 'built-in', artifactUrl: 'https://example.test/workflow.json' },
        { title: 'Unsafe URL', provider: 'built-in', artifactUrl: 'https://example.test/file.png', projectUrl: 'file:///project' },
      ]) {
        const response = await fetch(`${baseUrl}/agent-designs`, {
          method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
      }
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('validates required title, provider, and exactly one deliverable locator', async () => {
    for (const body of [
      { provider: 'local', artifactUrl: 'https://example.test/file.png' },
      { title: 'Title', artifactUrl: 'https://example.test/file.png' },
      { title: 'Title', provider: 'local' },
      { title: 'Title', provider: 'local', artifactUrl: 'https://example.test/file.png', localPath: '/tmp/file.png' },
      { title: 'Title', provider: 'Not A Provider', artifactUrl: 'https://example.test/file.png' },
    ]) {
      const response = await fetch(`${baseUrl}/agent-designs`, {
        method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it.each([
    ['built-in', 'webp'], ['comfyui', 'exr'], ['blender', 'glb'], ['openmontage', 'mov'], ['document-tools', 'docx'],
    ['built-in', 'png'], ['built-in', 'jpg'], ['built-in', 'jpeg'], ['built-in', 'gif'], ['built-in', 'svg'], ['built-in', 'tif'], ['built-in', 'tiff'], ['built-in', 'pdf'], ['built-in', 'pptx'],
    ['built-in', 'xlsx'], ['built-in', 'csv'], ['built-in', 'mp4'], ['built-in', 'webm'], ['built-in', 'gltf'], ['built-in', 'obj'],
  ])('accepts %s finished %s output', async (provider, extension) => {
    const response = await fetch(`${baseUrl}/agent-designs`, {
      method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${provider} ${extension}`, provider, artifactUrl: `https://example.test/output.${extension}` }),
    });
    expect(response.status).toBe(201);
    expect((await response.json() as { artifactType: string }).artifactType).toBe(extension);
  });

  it('GET /agent-designs/:id returns the design', async () => {
    const createRes = await fetch(`${baseUrl}/agent-designs`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'My Design', provider: 'built-in', artifactUrl: 'https://example.test/my-design.png' }),
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
      body: JSON.stringify({ title: 'To delete', provider: 'built-in', artifactUrl: 'https://example.test/to-delete.png' }),
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
