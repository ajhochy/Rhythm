/**
 * opencode_skills_visibility.test.ts — #875 (setup-05): GET /opencode/skills
 * excludes skills whose requires_toolsets/fallback_for_toolsets conditions
 * are not met for the current session's connected toolsets.
 *
 * This is a DISCOVERY filter, additive to (not a replacement for) the
 * existing per-profile allowed_skills_json enforcement, which happens later
 * (session creation / per-turn allowlist push) and is untouched by this route.
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
const EXT_DIR = mkdtempSync(join(tmpdir(), 'skills-visibility-test-'));
function writeSkillFile(location: string, content: string): void {
  mkdirSync(dirname(location), { recursive: true });
  writeFileSync(location, content, 'utf8');
}

const reloadSkills = vi.fn().mockResolvedValue([]);
const listSkills = vi.fn().mockResolvedValue([]);
const listSkillsWithContent = vi.fn().mockResolvedValue([]);
const listMcp = vi.fn().mockResolvedValue({});

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listSkills: (...args: unknown[]) => listSkills(...args),
    listSkillsWithContent: (...args: unknown[]) => listSkillsWithContent(...args),
    listMcp: (...args: unknown[]) => listMcp(...args),
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

function skillMd(name: string, rhythmBlock = ''): string {
  const metadata = rhythmBlock ? `metadata:\n  rhythm:\n${rhythmBlock}` : '';
  return ['---', `name: ${name}`, metadata, '---', '', 'body'].filter(Boolean).join('\n');
}

describe('/opencode/skills — #875 toolset visibility filtering', () => {
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
    listSkillsWithContent.mockResolvedValue([]);
    listMcp.mockResolvedValue({});
  });

  it('a requires_toolsets: [terminal] skill is absent when terminal is disabled for the session', async () => {
    const location = join(EXT_DIR, 't', 'SKILL.md');
    writeSkillFile(location, skillMd('terminal-automation', '    requires_toolsets: [terminal]\n'));
    listSkills.mockResolvedValueOnce([{ name: 'terminal-automation', description: 'runs commands', location }]);

    const res = await fetch(`${baseUrl}/opencode/skills?terminalEnabled=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'terminal-automation')).toBeUndefined();
  });

  it('a requires_toolsets: [terminal] skill is present when terminal is enabled', async () => {
    const location = join(EXT_DIR, 't2', 'SKILL.md');
    writeSkillFile(location, skillMd('terminal-automation', '    requires_toolsets: [terminal]\n'));
    listSkills.mockResolvedValueOnce([{ name: 'terminal-automation', description: 'runs commands', location }]);

    const res = await fetch(`${baseUrl}/opencode/skills`); // terminal defaults enabled
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'terminal-automation')).toBeDefined();
  });

  it('a fallback_for_toolsets: [web] skill is absent when a web MCP server is connected', async () => {
    const location = join(EXT_DIR, 'ddg', 'SKILL.md');
    writeSkillFile(location, skillMd('duckduckgo-fallback', '    fallback_for_toolsets: [web]\n'));
    listSkills.mockResolvedValueOnce([{ name: 'duckduckgo-fallback', description: 'free search', location }]);
    listMcp.mockResolvedValueOnce({ web: { status: 'connected' } });

    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'duckduckgo-fallback')).toBeUndefined();
  });

  it('a fallback_for_toolsets: [web] skill is present when no web MCP server is connected', async () => {
    const location = join(EXT_DIR, 'ddg2', 'SKILL.md');
    writeSkillFile(location, skillMd('duckduckgo-fallback', '    fallback_for_toolsets: [web]\n'));
    listSkills.mockResolvedValueOnce([{ name: 'duckduckgo-fallback', description: 'free search', location }]);
    listMcp.mockResolvedValueOnce({});

    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'duckduckgo-fallback')).toBeDefined();
  });

  it('a skill with no toolset conditions is always present (no regression)', async () => {
    const location = join(EXT_DIR, 'plain', 'SKILL.md');
    writeSkillFile(location, skillMd('plain-skill'));
    listSkills.mockResolvedValueOnce([{ name: 'plain-skill', description: 'no conditions', location }]);

    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'plain-skill')).toBeDefined();
  });

  it('a skill with BOTH fields is shown only when both conditions are satisfied', async () => {
    const location = join(EXT_DIR, 'dual', 'SKILL.md');
    writeSkillFile(
      location,
      skillMd('dual-condition', '    requires_toolsets: [terminal]\n    fallback_for_toolsets: [web]\n'),
    );
    listSkills.mockResolvedValueOnce([{ name: 'dual-condition', description: 'both', location }]);
    listMcp.mockResolvedValueOnce({ web: { status: 'connected' } });

    // terminal enabled (default) but web IS connected → fallback fails → hidden
    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'dual-condition')).toBeUndefined();
  });
});
