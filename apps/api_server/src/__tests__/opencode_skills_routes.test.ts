/**
 * Unify-2 — /opencode/skills proxy + Rhythm-managed write/delete.
 *
 * Verifies the skills source-of-truth routes: the proxy maps the fork's live
 * skills to the client shape with a correct `managed` flag, writes land only in
 * the managed dir, path traversal is rejected, deletes are confined to managed
 * skills, and a write/delete triggers a fork reload.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { startTestServer } from './helpers/real_server';

// Redirect the managed dir to a throwaway tmp dir BEFORE the app (and the
// rhythm_managed_skills module) is imported, so writes never touch the real
// ~/.config/opencode tree.
const MANAGED_DIR = mkdtempSync(join(tmpdir(), 'rhythm-managed-skills-'));
process.env.RHYTHM_MANAGED_SKILLS_DIR = MANAGED_DIR;

const reloadSkills = vi.fn().mockResolvedValue([]);
const listSkills = vi.fn();
// #929 — was a hardcoded `() => Promise.resolve([])`; promoted to a vi.fn()
// (same default) so a test can override it per-case to inject real
// frontmatter (e.g. a harvested draft's status/confidence/source) without
// touching every other test in this file.
const listSkillsWithContent = vi.fn().mockResolvedValue([]);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listSkills: (...args: unknown[]) => listSkills(...args),
    listSkillsWithContent: (...args: unknown[]) => listSkillsWithContent(...args),
    listMcp: () => Promise.resolve({}),
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
  let db: Database.Database;

  beforeEach(async () => {
    db = makeDb();
    setDb(db);
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

  // ── GET /:name/content — full SKILL.md body for one skill ───────────────────

  describe('GET /:name/content', () => {
    it('returns the SKILL.md body for a managed skill (create → reopen round-trip)', async () => {
      // Create a managed skill — this writes a real SKILL.md into MANAGED_DIR.
      const createRes = await fetch(`${baseUrl}/opencode/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'with-body',
          description: 'Has a body',
          content: '# With Body\n\nThis is the editable body.',
        }),
      });
      const created = (await createRes.json()) as { location: string };

      // The fork now "discovers" it at its written location.
      listSkills.mockResolvedValue([
        { name: 'with-body', description: 'Has a body', location: created.location },
      ]);

      const res = await fetch(`${baseUrl}/opencode/skills/with-body/content`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; content: string };
      expect(body.name).toBe('with-body');
      // The body the user typed must round-trip back (not an empty box).
      expect(body.content).toContain('This is the editable body.');
      expect(body.content).toContain('name: with-body');
    });

    it('returns content for an external skill too (viewable, read-only)', async () => {
      // Write an external SKILL.md outside the managed dir.
      const externalDir = mkdtempSync(join(tmpdir(), 'external-skill-'));
      const externalLoc = join(externalDir, 'SKILL.md');
      writeFileSync(externalLoc, '---\nname: ext\n---\n\nExternal body.\n', 'utf8');
      listSkills.mockResolvedValue([
        { name: 'ext', description: 'External', location: externalLoc },
      ]);

      const res = await fetch(`${baseUrl}/opencode/skills/ext/content`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; content: string };
      expect(body.content).toContain('External body.');
      rmSync(externalDir, { recursive: true, force: true });
    });

    it('returns 404 for a skill name not in the live set', async () => {
      listSkills.mockResolvedValue([
        { name: 'present', description: 'x', location: join(MANAGED_DIR, 'present', 'SKILL.md') },
      ]);
      const res = await fetch(`${baseUrl}/opencode/skills/missing/content`);
      expect(res.status).toBe(404);
    });
  });

  // ── #793 — ?withMetadata=true joins the #792 sidecar metadata by name ───────

  describe('?withMetadata=true', () => {
    const managedLoc = join(MANAGED_DIR, 'auto-skill', 'SKILL.md');
    const externalLoc = '/Users/x/.claude/skills/forked/SKILL.md';
    const orphanLoc = '/Users/x/.claude/skills/orphan/SKILL.md';

    function seedForkSkills() {
      // Three live engine skills: a managed one + an external one (both with a
      // sidecar row) + an external one with NO sidecar row.
      listSkills.mockResolvedValue([
        { name: 'auto-skill', description: 'Managed + measured', location: managedLoc },
        { name: 'forked', description: 'External, forked', location: externalLoc },
        { name: 'orphan', description: 'No sidecar row', location: orphanLoc },
      ]);
    }

    it('joins sidecar metadata for managed + external skills and defaults for none', async () => {
      seedForkSkills();
      const repo = new AgentSkillsRepository(db);
      // (a) managed skill WITH a sidecar row, mid-measurement.
      repo.create({
        title: 'auto-skill',
        confidence: 0.82,
        status: 'measuring',
        source: 'auto-refined',
        uses: 5,
        isExternal: 0,
        baselineScore: 0.6,
        postScore: 0.9,
      });
      // (b) external skill WITH a sidecar row (fork-to-shadow → isExternalFork).
      repo.create({
        title: 'forked',
        confidence: 0.5,
        status: 'reverted',
        source: 'teacher-refined',
        uses: 2,
        isExternal: 1,
        baselineScore: 0.7,
        postScore: 0.4,
      });

      const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<
        SkillListEntry & { metadata: Record<string, unknown> }
      >;

      // (a) managed + sidecar row
      const auto = body.find((s) => s.name === 'auto-skill')!;
      expect(auto.managed).toBe(true);
      expect(auto.metadata).toEqual({
        confidence: 0.82,
        version: 1,
        status: 'measuring',
        source: 'auto-refined',
        uses: 5,
        baselineScore: 0.6,
        postScore: 0.9,
        measureReason: null,
        isExternalFork: false,
        env: { missing: [], satisfied: true },
      });

      // (b) external + sidecar row (location-derived managed stays false)
      const forked = body.find((s) => s.name === 'forked')!;
      expect(forked.managed).toBe(false);
      expect(forked.metadata).toEqual({
        confidence: 0.5,
        version: 1,
        status: 'reverted',
        source: 'teacher-refined',
        uses: 2,
        baselineScore: 0.7,
        postScore: 0.4,
        measureReason: null,
        isExternalFork: true,
        env: { missing: [], satisfied: true },
      });

      // (c) skill with NO sidecar row → null/default metadata
      const orphan = body.find((s) => s.name === 'orphan')!;
      expect(orphan.managed).toBe(false);
      expect(orphan.metadata).toEqual({
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
      });
    });

    it('#929 — a harvested draft with NO sidecar row surfaces its OWN frontmatter status/uses instead of the default active/null', async () => {
      // A #949 harvested draft is written straight to a SKILL.md file — no
      // agent_skills row is ever created for it (see docs/ai/decisions/
      // 2026-07-08-harvest-to-file-autobind.md). Before #929's fix, this
      // fell into the `!row` branch and reported the generic
      // DEFAULT_METADATA (status: 'active', uses: null) — hiding the real
      // draft/harvested lifecycle from the UI entirely.
      // The route now reads frontmatter straight off disk via `location` (the
      // fork's listSkillsWithContent strips frontmatter from `content` live —
      // see opencode_skills_routes.ts) — so this draft needs a REAL backing
      // file, not just a mocked listSkillsWithContent response.
      const draftLoc = join(MANAGED_DIR, 'drafts', 'rebuild-abi', 'SKILL.md');
      const draftContent =
        '---\nname: rebuild-abi\ndescription: "Rebuild the native module ABI"\n' +
        'status: draft\nsource: harvested\nprovenance: auto-extract\n' +
        'source_session: sess-1\nconfidence: 0.72\n' +
        'extracted_at: 2026-07-08T00:00:00.000Z\n---\n\n# Rebuild ABI\n';
      mkdirSync(join(MANAGED_DIR, 'drafts', 'rebuild-abi'), { recursive: true });
      writeFileSync(draftLoc, draftContent, 'utf8');
      listSkills.mockResolvedValueOnce([
        { name: 'rebuild-abi', description: 'Rebuild the native module ABI', location: draftLoc },
      ]);

      const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<SkillListEntry & { metadata: Record<string, unknown> }>;

      const draft = body.find((s) => s.name === 'rebuild-abi')!;
      expect(draft.metadata.status).toBe('draft');
      expect(draft.metadata.source).toBe('harvested');
      expect(draft.metadata.confidence).toBe(0.72);
      expect(draft.metadata.uses).toBe(0); // no telemetry seeded — real count, not null
    });

    it('name set is identical with and without the flag (mirrors the fork list)', async () => {
      seedForkSkills();
      // A sidecar row whose status is measuring/reverted and which targets NO
      // live skill must NOT appear as its own entry — the join adds nothing.
      const repo = new AgentSkillsRepository(db);
      repo.create({ title: 'ghost-proposal', status: 'measuring' });

      const plain = (await (
        await fetch(`${baseUrl}/opencode/skills`)
      ).json()) as Array<{ name: string }>;
      const meta = (await (
        await fetch(`${baseUrl}/opencode/skills?withMetadata=true`)
      ).json()) as Array<{ name: string }>;

      const plainNames = plain.map((s) => s.name).sort();
      const metaNames = meta.map((s) => s.name).sort();
      const forkNames = ['auto-skill', 'forked', 'orphan'].sort();

      expect(plainNames).toEqual(forkNames);
      expect(metaNames).toEqual(plainNames); // join adds/drops nothing
      expect(metaNames).not.toContain('ghost-proposal');
    });

    it('falsification: a stray status=measuring sidecar row never becomes an entry', async () => {
      // Falsifies "the join could leak sidecar rows as skills": only the live
      // fork set defines the name set. With ZERO live skills the response is
      // empty even though a measuring sidecar row exists.
      listSkills.mockResolvedValue([]);
      const repo = new AgentSkillsRepository(db);
      repo.create({ title: 'auto-skill', status: 'measuring', confidence: 0.9 });

      const meta = (await (
        await fetch(`${baseUrl}/opencode/skills?withMetadata=true`)
      ).json()) as Array<{ name: string }>;
      expect(meta).toEqual([]);
    });

    it('without the flag, entries carry no metadata key (picker unaffected)', async () => {
      seedForkSkills();
      const repo = new AgentSkillsRepository(db);
      repo.create({ title: 'auto-skill', status: 'active', confidence: 0.3 });

      const body = (await (
        await fetch(`${baseUrl}/opencode/skills`)
      ).json()) as Array<Record<string, unknown>>;
      expect(body.every((s) => !('metadata' in s))).toBe(true);
    });
  });

  afterAll(() => {
    rmSync(MANAGED_DIR, { recursive: true, force: true });
  });
});

interface SkillListEntry {
  name: string;
  description?: string;
  location: string;
  managed: boolean;
}
