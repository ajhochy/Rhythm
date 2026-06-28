/**
 * Unify-2 — /opencode/skills proxy + Rhythm-managed write/delete.
 *
 * Verifies the skills source-of-truth routes: the proxy maps the fork's live
 * skills to the client shape with a correct `managed` flag, writes land only in
 * the managed dir, path traversal is rejected, deletes are confined to managed
 * skills, and a write/delete triggers a fork reload.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

// Redirect the managed dir to a throwaway tmp dir BEFORE the app (and the
// rhythm_managed_skills module) is imported, so writes never touch the real
// ~/.config/opencode tree.
const MANAGED_DIR = mkdtempSync(join(tmpdir(), 'rhythm-managed-skills-'));
process.env.RHYTHM_MANAGED_SKILLS_DIR = MANAGED_DIR;

const reloadSkills = vi.fn().mockResolvedValue([]);
const listSkills = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listSkills: (...args: unknown[]) => listSkills(...args),
    reloadSkills: (...args: unknown[]) => reloadSkills(...args),
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('/opencode/skills', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    const { createApp } = await import('../app');
    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    close = started.close;
  });

  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('GET / maps fork skills to entries with a correct managed flag', async () => {
    const managedLoc = join(MANAGED_DIR, 'my-skill', 'SKILL.md');
    listSkills.mockResolvedValueOnce([
      { name: 'my-skill', description: 'Rhythm owned', location: managedLoc },
      { name: 'docx', description: 'External', location: '/Users/x/.claude/skills/docx/SKILL.md' },
    ]);

    const res = await fetch(`${baseUrl}/opencode/skills`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; managed: boolean }>;

    expect(body).toHaveLength(2);
    expect(body.find((s) => s.name === 'my-skill')!.managed).toBe(true);
    expect(body.find((s) => s.name === 'docx')!.managed).toBe(false);
    // content is never surfaced
    expect(body[0]).not.toHaveProperty('content');
  });

  it('POST / writes a SKILL.md inside the managed dir and reloads', async () => {
    const res = await fetch(`${baseUrl}/opencode/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'greeter',
        description: 'Says hello',
        content: '# Greeter\n\nSay hello.',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; location: string; managed: boolean };
    expect(body.managed).toBe(true);

    const expected = join(MANAGED_DIR, 'greeter', 'SKILL.md');
    expect(body.location).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    const md = readFileSync(expected, 'utf8');
    expect(md).toContain('name: greeter');
    expect(md).toContain('Say hello.');
    expect(reloadSkills).toHaveBeenCalledTimes(1);
  });

  it('POST / rejects a name with path traversal and writes nothing', async () => {
    const res = await fetch(`${baseUrl}/opencode/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../escape', content: '# nope' }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(join(MANAGED_DIR, '..', 'escape'))).toBe(false);
    expect(reloadSkills).not.toHaveBeenCalled();
  });

  it('DELETE /:name returns 404 for a non-managed skill (no reload)', async () => {
    const res = await fetch(`${baseUrl}/opencode/skills/docx`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(reloadSkills).not.toHaveBeenCalled();
  });

  it('DELETE /:name removes a managed skill and reloads', async () => {
    // create first
    await fetch(`${baseUrl}/opencode/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'to-delete', content: '# bye' }),
    });
    reloadSkills.mockClear();

    const res = await fetch(`${baseUrl}/opencode/skills/to-delete`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(existsSync(join(MANAGED_DIR, 'to-delete'))).toBe(false);
    expect(reloadSkills).toHaveBeenCalledTimes(1);
  });

  afterAll(() => {
    rmSync(MANAGED_DIR, { recursive: true, force: true });
  });
});
