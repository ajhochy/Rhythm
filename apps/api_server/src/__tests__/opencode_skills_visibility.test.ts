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
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

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
    listSkills.mockResolvedValueOnce([
      { name: 'terminal-automation', description: 'runs commands', location: '/skills/t/SKILL.md' },
    ]);
    listSkillsWithContent.mockResolvedValueOnce([
      {
        name: 'terminal-automation',
        description: 'runs commands',
        location: '/skills/t/SKILL.md',
        content: skillMd('terminal-automation', '    requires_toolsets: [terminal]\n'),
      },
    ]);

    const res = await fetch(`${baseUrl}/opencode/skills?terminalEnabled=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'terminal-automation')).toBeUndefined();
  });

  it('a requires_toolsets: [terminal] skill is present when terminal is enabled', async () => {
    listSkills.mockResolvedValueOnce([
      { name: 'terminal-automation', description: 'runs commands', location: '/skills/t/SKILL.md' },
    ]);
    listSkillsWithContent.mockResolvedValueOnce([
      {
        name: 'terminal-automation',
        description: 'runs commands',
        location: '/skills/t/SKILL.md',
        content: skillMd('terminal-automation', '    requires_toolsets: [terminal]\n'),
      },
    ]);

    const res = await fetch(`${baseUrl}/opencode/skills`); // terminal defaults enabled
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'terminal-automation')).toBeDefined();
  });

  it('a fallback_for_toolsets: [web] skill is absent when a web MCP server is connected', async () => {
    listSkills.mockResolvedValueOnce([
      { name: 'duckduckgo-fallback', description: 'free search', location: '/skills/ddg/SKILL.md' },
    ]);
    listSkillsWithContent.mockResolvedValueOnce([
      {
        name: 'duckduckgo-fallback',
        description: 'free search',
        location: '/skills/ddg/SKILL.md',
        content: skillMd('duckduckgo-fallback', '    fallback_for_toolsets: [web]\n'),
      },
    ]);
    listMcp.mockResolvedValueOnce({ web: { status: 'connected' } });

    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'duckduckgo-fallback')).toBeUndefined();
  });

  it('a fallback_for_toolsets: [web] skill is present when no web MCP server is connected', async () => {
    listSkills.mockResolvedValueOnce([
      { name: 'duckduckgo-fallback', description: 'free search', location: '/skills/ddg/SKILL.md' },
    ]);
    listSkillsWithContent.mockResolvedValueOnce([
      {
        name: 'duckduckgo-fallback',
        description: 'free search',
        location: '/skills/ddg/SKILL.md',
        content: skillMd('duckduckgo-fallback', '    fallback_for_toolsets: [web]\n'),
      },
    ]);
    listMcp.mockResolvedValueOnce({});

    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'duckduckgo-fallback')).toBeDefined();
  });

  it('a skill with no toolset conditions is always present (no regression)', async () => {
    listSkills.mockResolvedValueOnce([
      { name: 'plain-skill', description: 'no conditions', location: '/skills/plain/SKILL.md' },
    ]);
    listSkillsWithContent.mockResolvedValueOnce([
      {
        name: 'plain-skill',
        description: 'no conditions',
        location: '/skills/plain/SKILL.md',
        content: skillMd('plain-skill'),
      },
    ]);

    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'plain-skill')).toBeDefined();
  });

  it('a skill with BOTH fields is shown only when both conditions are satisfied', async () => {
    listSkills.mockResolvedValueOnce([
      { name: 'dual-condition', description: 'both', location: '/skills/dual/SKILL.md' },
    ]);
    listSkillsWithContent.mockResolvedValueOnce([
      {
        name: 'dual-condition',
        description: 'both',
        location: '/skills/dual/SKILL.md',
        content: skillMd(
          'dual-condition',
          '    requires_toolsets: [terminal]\n    fallback_for_toolsets: [web]\n',
        ),
      },
    ]);
    listMcp.mockResolvedValueOnce({ web: { status: 'connected' } });

    // terminal enabled (default) but web IS connected → fallback fails → hidden
    const res = await fetch(`${baseUrl}/opencode/skills`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.find((s) => s.name === 'dual-condition')).toBeUndefined();
  });
});
