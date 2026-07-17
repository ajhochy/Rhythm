/**
 * #1053 (OCU-12) — org-skills route contract tests.
 *
 * Covers the acceptance criteria in docs/ai/current-plan.md's #1053 section:
 *  - GET /org-skills/index.json is public, fork-discovery-shape compatible,
 *    and excludes published:false skills.
 *  - GET /org-skills/files/:name/SKILL.md is public and serves the raw body;
 *    an unpublished or unknown skill, or any other file name, 404s.
 *  - POST/PUT/DELETE /org-skills/:name reject unauthenticated requests and
 *    succeed with a valid session token.
 *  - No secret/token-shaped fields ever appear in a GET response.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { createApp } from '../app';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { OrgSkillsRepository } from '../repositories/org_skills_repository';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * A minimal re-implementation of the fork's `skill/discovery.ts` Index/
 * IndexSkill Effect Schema decode contract — NOT an import of the vendored
 * fork (AGENTS.md forbids wiring apps/opencode_fork into the api_server
 * build). Mirrors exactly what `Discovery.pull` requires to decode
 * `index.json` (`{ skills: [{ name: string, files: string[] }] }`) and its
 * post-decode filter (a skill entry must list "SKILL.md" among its files or
 * the fork drops it with a warning).
 */
function decodeAsForkIndex(json: unknown): { name: string; files: string[] }[] {
  if (typeof json !== 'object' || json === null || !('skills' in json)) {
    throw new Error('index.json does not decode as the fork Index schema (missing `skills`)');
  }
  const skills = (json as { skills: unknown }).skills;
  if (!Array.isArray(skills)) {
    throw new Error('index.json `skills` is not an array');
  }
  return skills.map((s, i) => {
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof (s as { name?: unknown }).name !== 'string' ||
      !Array.isArray((s as { files?: unknown }).files) ||
      !(s as { files: unknown[] }).files.every((f) => typeof f === 'string')
    ) {
      throw new Error(`index.json skills[${i}] does not decode as IndexSkill {name, files}`);
    }
    return s as { name: string; files: string[] };
  });
}

describe('org-skills routes (#1053)', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let repo: OrgSkillsRepository;

  beforeEach(async () => {
    const db = makeDb();
    setDb(db);
    repo = new OrgSkillsRepository(db);

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('GET /index.json is public, fork-decodable, and excludes published:false skills', async () => {
    await repo.upsertAsync('visible-skill', { content: '# Visible\nBody.', published: true });
    await repo.upsertAsync('hidden-skill', { content: '# Hidden\nBody.', published: false });

    const res = await fetch(`${baseUrl}/org-skills/index.json`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const decoded = decodeAsForkIndex(body);
    const names = decoded.map((s) => s.name);
    expect(names).toContain('visible-skill');
    expect(names).not.toContain('hidden-skill');

    const visible = decoded.find((s) => s.name === 'visible-skill')!;
    expect(visible.files).toContain('SKILL.md');
  });

  it('no-secrets: index.json entries carry exactly {name, files} and no secret-shaped keys', async () => {
    await repo.upsertAsync('clean-skill', { content: '# Clean\nBody.' });

    const res = await fetch(`${baseUrl}/org-skills/index.json`);
    const text = await res.text();
    const body = JSON.parse(text) as { skills: Record<string, unknown>[] };

    expect(body.skills.length).toBeGreaterThan(0);
    for (const entry of body.skills) {
      expect(Object.keys(entry).sort()).toEqual(['files', 'name']);
    }
    expect(text).not.toMatch(/"(token|secret|password|api[_-]?key|authorization)"\s*:/i);
  });

  it('GET /files/:name/SKILL.md serves the raw body for a published skill', async () => {
    await repo.upsertAsync('doc-skill', {
      description: 'A doc skill',
      content: '# Doc Skill\n\nInstructions here.',
    });

    const res = await fetch(`${baseUrl}/org-skills/files/doc-skill/SKILL.md`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('# Doc Skill\n\nInstructions here.');
    expect(text).not.toMatch(/"(token|secret|password|api[_-]?key|authorization)"\s*:/i);
  });

  it('GET /files/:name/SKILL.md 404s for an unpublished skill (not readable by guessing the name)', async () => {
    await repo.upsertAsync('secret-draft', { content: 'draft body', published: false });

    const res = await fetch(`${baseUrl}/org-skills/files/secret-draft/SKILL.md`);
    expect(res.status).toBe(404);
  });

  it('GET /files/:name/SKILL.md 404s for an unknown skill name', async () => {
    const res = await fetch(`${baseUrl}/org-skills/files/no-such-skill/SKILL.md`);
    expect(res.status).toBe(404);
  });

  it('GET /files/:name/<other> 404s — only SKILL.md is servable in the single-file model', async () => {
    await repo.upsertAsync('doc-skill', { content: 'body' });

    const res = await fetch(`${baseUrl}/org-skills/files/doc-skill/reference.md`);
    expect(res.status).toBe(404);
  });

  it('POST /org-skills/:name without auth -> 401; with a valid session token -> 201', async () => {
    const unauth = await fetch(`${baseUrl}/org-skills/new-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# New Skill\nBody.' }),
    });
    expect(unauth.status).toBe(401);
    expect(await repo.findByNameAsync('new-skill')).toBeNull();

    const authed = await fetch(`${baseUrl}/org-skills/new-skill`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ description: 'desc', content: '# New Skill\nBody.' }),
    });
    expect(authed.status).toBe(201);
    const created = (await authed.json()) as { name: string; content: string };
    expect(created.name).toBe('new-skill');
    expect(created.content).toBe('# New Skill\nBody.');

    const stored = await repo.findByNameAsync('new-skill');
    expect(stored?.content).toBe('# New Skill\nBody.');
  });

  it('POST /org-skills/:name rejects a missing/blank content body (400)', async () => {
    const res = await fetch(`${baseUrl}/org-skills/no-content`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ description: 'desc' }),
    });
    expect(res.status).toBe(400);
    expect(await repo.findByNameAsync('no-content')).toBeNull();
  });

  it('PUT /org-skills/:name without auth -> 401; with auth updates the existing skill', async () => {
    await repo.upsertAsync('editable', { content: 'v1' });

    const unauth = await fetch(`${baseUrl}/org-skills/editable`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'v2' }),
    });
    expect(unauth.status).toBe(401);

    const authed = await fetch(`${baseUrl}/org-skills/editable`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ content: 'v2' }),
    });
    expect(authed.status).toBe(200);

    const stored = await repo.findByNameAsync('editable');
    expect(stored?.content).toBe('v2');
  });

  it('DELETE /org-skills/:name without auth -> 401; with auth removes it (204), then 404 on repeat', async () => {
    await repo.upsertAsync('removable', { content: 'x' });

    const unauth = await fetch(`${baseUrl}/org-skills/removable`, { method: 'DELETE' });
    expect(unauth.status).toBe(401);
    expect(await repo.findByNameAsync('removable')).not.toBeNull();

    const authed = await fetch(`${baseUrl}/org-skills/removable`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(authed.status).toBe(204);
    expect(await repo.findByNameAsync('removable')).toBeNull();

    const again = await fetch(`${baseUrl}/org-skills/removable`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(again.status).toBe(404);
  });
});
