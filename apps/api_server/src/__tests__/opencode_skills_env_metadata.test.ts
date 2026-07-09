/**
 * opencode_skills_env_metadata.test.ts — #874 (setup-04): the skills list
 * endpoint surfaces required-env-var status so a picker/doctor UI can show a
 * clear "needs configuration" state instead of a cryptic runtime failure.
 *
 * Uses `?withMetadata=true` (the existing #793 sidecar-metadata query param)
 * to attach an `env` block per skill, derived from the skill's raw SKILL.md
 * frontmatter (fetched via listSkillsWithContent) — never from the DB sidecar.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

// The route now reads each skill's frontmatter straight off disk via its
// `location` (see opencode_skills_routes.ts — the fork's listSkillsWithContent
// strips frontmatter from `content`, so it can no longer be the source here).
// A real backing file at `location` is required for these tests' frontmatter
// to be seen; a throwaway tmp dir stands in for the fork's own skill dirs.
const EXT_DIR = mkdtempSync(join(tmpdir(), 'skills-env-test-'));
function writeSkillFile(location: string, content: string): void {
  mkdirSync(dirname(location), { recursive: true });
  writeFileSync(location, content, 'utf8');
}

const reloadSkills = vi.fn().mockResolvedValue([]);
const listSkills = vi.fn().mockResolvedValue([]);
const listSkillsWithContent = vi.fn();

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

function skillMd(name: string, extra = ''): string {
  return ['---', `name: ${name}`, extra, '---', '', 'body'].join('\n');
}

describe('/opencode/skills?withMetadata=true — #874 required env surfacing', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let db: Database.Database;
  const ORIGINAL_ENV = { ...process.env };

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
    process.env = { ...ORIGINAL_ENV };
  });

  it('flags a skill whose declared env var is missing', async () => {
    delete process.env.TENOR_API_KEY;
    const location = join(EXT_DIR, 'gif-search', 'SKILL.md');
    writeSkillFile(
      location,
      skillMd(
        'gif-search',
        'required_environment_variables:\n  - name: TENOR_API_KEY\n    prompt: "Your Tenor API key"',
      ),
    );
    listSkills.mockResolvedValueOnce([{ name: 'gif-search', description: 'gifs', location }]);

    const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; metadata: { env: { missing: string[]; satisfied: boolean } } }>;
    const entry = body.find((s) => s.name === 'gif-search')!;
    expect(entry.metadata.env.missing).toEqual(['TENOR_API_KEY']);
    expect(entry.metadata.env.satisfied).toBe(false);
  });

  it('does not flag a skill whose declared env var is already set', async () => {
    process.env.TENOR_API_KEY = 'already-configured';
    const location = join(EXT_DIR, 'gif-search-2', 'SKILL.md');
    writeSkillFile(location, skillMd('gif-search', 'required_environment_variables:\n  - name: TENOR_API_KEY'));
    listSkills.mockResolvedValueOnce([{ name: 'gif-search', description: 'gifs', location }]);

    const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
    const body = (await res.json()) as Array<{ name: string; metadata: { env: { missing: string[]; satisfied: boolean } } }>;
    const entry = body.find((s) => s.name === 'gif-search')!;
    expect(entry.metadata.env.missing).toEqual([]);
    expect(entry.metadata.env.satisfied).toBe(true);
  });

  it('a skill with no required_environment_variables field reports satisfied=true, missing=[] (regression)', async () => {
    const location = join(EXT_DIR, 'plain-skill', 'SKILL.md');
    writeSkillFile(location, skillMd('plain-skill'));
    listSkills.mockResolvedValueOnce([{ name: 'plain-skill', description: 'no env needed', location }]);

    const res = await fetch(`${baseUrl}/opencode/skills?withMetadata=true`);
    const body = (await res.json()) as Array<{ name: string; metadata: { env: { missing: string[]; satisfied: boolean } } }>;
    const entry = body.find((s) => s.name === 'plain-skill')!;
    expect(entry.metadata.env.missing).toEqual([]);
    expect(entry.metadata.env.satisfied).toBe(true);
  });

  it('plain GET (no withMetadata) never includes env metadata or raw content', async () => {
    listSkills.mockResolvedValueOnce([
      { name: 'gif-search', description: 'gifs', location: '/skills/gif-search/SKILL.md' },
    ]);
    // #875: listSkillsWithContent is now also called on the plain list (needed
    // for toolset-visibility filtering, not just ?withMetadata=true env info)
    // — but its content must still never leak into the response shape.
    listSkillsWithContent.mockResolvedValueOnce([
      {
        name: 'gif-search',
        description: 'gifs',
        location: '/skills/gif-search/SKILL.md',
        content: skillMd('gif-search'),
      },
    ]);

    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0]).not.toHaveProperty('metadata');
    expect(body[0]).not.toHaveProperty('content');
  });
});
