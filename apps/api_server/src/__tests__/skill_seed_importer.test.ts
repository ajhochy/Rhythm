/**
 * Tests for skill_seed_importer.
 *
 * Three concerns:
 *  1. TEST-ENV GUARD (the key test): under VITEST, seedAgentStackSkills() must
 *     return imported:0 and write ZERO rows — it must not read or write the
 *     user's real ~/.config/opencode/agents or ~/.claude/skills dirs.
 *  2. Pure mapping: frontmatter string → AgentSkillInput field mapping. Pure,
 *     so it runs under VITEST without the fs guard blocking it.
 *  3. Pure dedup: importing the same title twice yields one entry.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  seedAgentStackSkills,
  parseFrontmatter,
  frontmatterToSkillInput,
  extractBody,
  dedupByTitle,
  discoverSeedInputs,
  SEED_SOURCE,
} from '../services/skill_seed_importer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('skill_seed_importer — test-env guard', () => {
  let repo: AgentSkillsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
  });

  it('writes ZERO rows and returns imported:0 under VITEST (no fs touch)', () => {
    // VITEST is set by the test runner; the guard must short-circuit.
    expect(process.env.VITEST).toBe('true');

    const result = seedAgentStackSkills(repo);

    expect(result).toEqual({ discovered: 0, imported: 0, skipped: 0 });
    expect(repo.list()).toHaveLength(0);
  });
});

describe('skill_seed_importer — pure frontmatter → input mapping', () => {
  it('maps name/description and applies seed defaults', () => {
    const md = [
      '---',
      'name: coding-agent',
      'description: Implements exactly one focused request.',
      'mode: subagent',
      'permission:',
      '  read: allow',
      '  edit: allow',
      '---',
      '',
      '# Body prose that is NOT a step array',
      '',
      'Step one. Step two.',
    ].join('\n');

    const fm = parseFrontmatter(md);
    expect(fm.name).toBe('coding-agent');
    expect(fm.description).toBe('Implements exactly one focused request.');
    // Indented (nested) keys must be ignored, not parsed as top-level.
    expect(fm.tags).toBeNull();

    // The markdown body after the frontmatter block is extracted verbatim.
    const body = extractBody(md);
    expect(body).toBe('# Body prose that is NOT a step array\n\nStep one. Step two.');

    const input = frontmatterToSkillInput(fm, 'fallback-name', body);
    expect(input.title).toBe('coding-agent');
    expect(input.description).toBe('Implements exactly one focused request.');
    expect(input.whenToUse).toBe('Implements exactly one focused request.');
    expect(input.steps).toBeNull();
    expect(input.tags).toBeNull();
    expect(input.body).toBe(
      '# Body prose that is NOT a step array\n\nStep one. Step two.',
    );
    expect(input.status).toBe('published');
    expect(input.source).toBe(SEED_SOURCE);
    expect(input.confidence).toBe(1.0);
  });

  it('extractBody returns null when there is no body or no frontmatter', () => {
    expect(extractBody('---\nname: x\ndescription: y\n---\n')).toBeNull();
    expect(extractBody('---\nname: x\n---\n   \n')).toBeNull();
    expect(extractBody('no frontmatter at all')).toBeNull();
  });

  it('frontmatterToSkillInput defaults body to null when omitted', () => {
    const fm = parseFrontmatter('---\nname: x\ndescription: y\n---\nbody');
    expect(frontmatterToSkillInput(fm, 'x').body).toBeNull();
  });

  it('falls back to the filename title when name is absent', () => {
    const fm = parseFrontmatter('---\ndescription: No name here.\n---\nbody');
    const input = frontmatterToSkillInput(fm, 'planning-agent');
    expect(input.title).toBe('planning-agent');
    expect(input.whenToUse).toBe('No name here.');
  });

  it('parses tags as YAML inline list or CSV when present', () => {
    expect(parseFrontmatter('---\ntags: [run, rhythm]\n---').tags).toEqual([
      'run',
      'rhythm',
    ]);
    expect(parseFrontmatter('---\ntags: alpha, beta\n---').tags).toEqual([
      'alpha',
      'beta',
    ]);
  });
});

describe('skill_seed_importer — pure dedup by title', () => {
  it('collapses duplicate titles (case-insensitive) to one', () => {
    const deduped = dedupByTitle([
      frontmatterToSkillInput({ name: 'coding-agent', description: 'a', whenToUse: null, tags: null }, 'x'),
      frontmatterToSkillInput({ name: 'Coding-Agent', description: 'b', whenToUse: null, tags: null }, 'y'),
      frontmatterToSkillInput({ name: 'issue-writer', description: 'c', whenToUse: null, tags: null }, 'z'),
    ]);
    expect(deduped.map((d) => d.title)).toEqual(['coding-agent', 'issue-writer']);
  });

  it('importing the same title twice yields one row (idempotent against repo)', () => {
    setDb(makeDb());
    const repo = new AgentSkillsRepository();
    const input = frontmatterToSkillInput(
      { name: 'coding-agent', description: 'desc', whenToUse: null, tags: null },
      'coding-agent',
    );

    // First import.
    if (!repo.findByTitle(input.title)) repo.create(input);
    // Second import of same title must be skipped.
    if (!repo.findByTitle(input.title)) repo.create(input);

    expect(repo.list()).toHaveLength(1);
  });
});

// ── #957 — agents are ROLES, not skills ───────────────────────────────────
// The importer used to scan ~/.config/opencode/agents/*.md and import every
// agent's role-text as a `published` skill row, which then materialized into
// the managed-skills dir as a colliding SKILL.md stub. This proves the agents
// dir is NEVER a seed source — only real ~/.claude/skills SKILL.md files are.
describe('skill_seed_importer — #957 agent role-text is never a skill source', () => {
  it('discovers real skills but NOT opencode agent definitions', () => {
    const skillsDir = mkdtempSync(join(tmpdir(), 'rhythm-957-skills-'));
    const agentsDir = mkdtempSync(join(tmpdir(), 'rhythm-957-agents-'));

    // A real Claude skill — MUST be discovered (legit materialization intact).
    mkdirSync(join(skillsDir, 'coding-agent'));
    writeFileSync(
      join(skillsDir, 'coding-agent', 'SKILL.md'),
      '---\nname: coding-agent\ndescription: Implements one focused request.\n---\nDo the work.\n',
    );

    // Agent definitions (as opencode_agent_writer projects them: `description` +
    // `mode`, no `name`; body = role text). These MUST NOT become skills — this
    // is exactly the #957 stub bug (named agent + UUID-id agent).
    writeFileSync(
      join(agentsDir, 'email-assistant.md'),
      "---\ndescription: Email Assistant\nmode: subagent\n---\nYou are AJ's email agent.\n",
    );
    writeFileSync(
      join(agentsDir, 'ce3a2f3c-3d92-4665-9678-9812a4e9ada1.md'),
      '---\ndescription: Playwright-Verification-Agent\nmode: subagent\n---\nYou are a verification agent.\n',
    );

    const titles = discoverSeedInputs({
      claudeSkillsDir: skillsDir,
      opencodeAgentsDir: agentsDir,
    }).map((i) => i.title);

    expect(titles).toContain('coding-agent');
    expect(titles).not.toContain('email-assistant');
    expect(titles).not.toContain('ce3a2f3c-3d92-4665-9678-9812a4e9ada1');
    // No agent slipped in under any title — the agents dir contributes nothing.
    expect(titles).toEqual(['coding-agent']);
  });
});
