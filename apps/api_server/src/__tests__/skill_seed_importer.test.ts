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
  dedupByTitle,
  SEED_SOURCE,
} from '../services/skill_seed_importer';

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
    ].join('\n');

    const fm = parseFrontmatter(md);
    expect(fm.name).toBe('coding-agent');
    expect(fm.description).toBe('Implements exactly one focused request.');
    // Indented (nested) keys must be ignored, not parsed as top-level.
    expect(fm.tags).toBeNull();

    const input = frontmatterToSkillInput(fm, 'fallback-name');
    expect(input.title).toBe('coding-agent');
    expect(input.description).toBe('Implements exactly one focused request.');
    expect(input.whenToUse).toBe('Implements exactly one focused request.');
    expect(input.steps).toBeNull();
    expect(input.tags).toBeNull();
    expect(input.status).toBe('published');
    expect(input.source).toBe(SEED_SOURCE);
    expect(input.confidence).toBe(1.0);
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
