/**
 * Tests for skill_seed_importer.
 *
 * Concerns:
 *  1. TEST-ENV GUARD for populateWorkflowSkillsOnce: a bare call under VITEST
 *     (no injected claudeSkillsDir) must copy ZERO files — it must never read
 *     the user's real ~/.claude/skills dir.
 *  2. populateWorkflowSkillsOnce's durable marker: short-circuits a second
 *     call, and — the #957 regression it exists to prevent — the marker
 *     survives deletion of the `agent_skills` row/managed file it seeded.
 *  3. Copy-only-if-absent: a pre-existing managed file is never overwritten
 *     (this is the anti-clobber guarantee for in-place skill refinements).
 *  4. Pure mapping: frontmatter string → AgentSkillInput field mapping. Pure,
 *     so it runs under VITEST without any fs guard blocking it.
 *  5. Pure dedup: importing the same title twice yields one entry.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { slugForSkillName } from '../services/rhythm_managed_skills';
import {
  populateWorkflowSkillsOnce,
  POPULATE_MARKER,
  parseFrontmatter,
  frontmatterToSkillInput,
  extractBody,
  dedupByTitle,
  discoverSeedInputs,
  referencedSkillNames,
  SEED_SOURCE,
} from '../services/skill_seed_importer';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Build a temp ~/.claude/skills-shaped dir with the given <name>/SKILL.md dirs. */
function makeClaudeSkillsDir(entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rhythm-populate-claude-'));
  for (const [name, body] of Object.entries(entries)) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), body);
  }
  return dir;
}

function managedFile(managedDir: string, name: string): string {
  return join(managedDir, slugForSkillName(name), 'SKILL.md');
}

describe('populateWorkflowSkillsOnce — test-env guard', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('copies ZERO files under a bare VITEST call (no real ~/.claude/skills touch)', () => {
    // VITEST is set by the test runner; the guard must short-circuit the
    // default source-dir resolution (no claudeSkillsDir override passed).
    expect(process.env.VITEST).toBe('true');

    const result = populateWorkflowSkillsOnce();

    expect(result.alreadyDone).toBe(false);
    expect(result.copied).toBe(0);
    expect(result.alreadyPresent).toBe(0);
  });
});

describe('populateWorkflowSkillsOnce — durable marker + copy-only-if-absent', () => {
  let db: Database.Database;
  let managedDir: string;
  let claudeDir: string;

  beforeEach(() => {
    db = makeDb();
    setDb(db);
    managedDir = mkdtempSync(join(tmpdir(), 'rhythm-populate-managed-'));
    process.env.RHYTHM_MANAGED_SKILLS_DIR = managedDir;
    claudeDir = makeClaudeSkillsDir({
      'coding-agent': '---\nname: coding-agent\ndescription: Implements one focused request.\n---\nDo the work.\n',
      'defuddle': '---\nname: defuddle\ndescription: Not agent-referenced.\n---\nUnused.\n',
    });
  });

  afterEach(() => {
    rmSync(managedDir, { recursive: true, force: true });
    rmSync(claudeDir, { recursive: true, force: true });
    delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    db.close();
  });

  it('first call copies referenced skills only, sets the durable marker', () => {
    const r = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeDir });

    expect(r.alreadyDone).toBe(false);
    expect(r.copied).toBe(1); // only coding-agent is agent-referenced
    expect(r.alreadyPresent).toBe(0);
    expect(existsSync(managedFile(managedDir, 'coding-agent'))).toBe(true);
    expect(existsSync(managedFile(managedDir, 'defuddle'))).toBe(false);

    const marker = db.prepare(`SELECT key FROM schema_meta WHERE key = ?`).get(POPULATE_MARKER);
    expect(marker).toBeDefined();
  });

  it('second call is a no-op — marker short-circuits, nothing re-copied', () => {
    const first = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeDir });
    expect(first.copied).toBe(1);

    const second = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeDir });
    expect(second.alreadyDone).toBe(true);
    expect(second.copied).toBe(0);
    expect(second.alreadyPresent).toBe(0);
  });

  it('never overwrites an already-present managed file (anti-clobber)', () => {
    // Simulate a refinement already sitting at the managed destination BEFORE
    // the one-time population ever runs (e.g. a prior partial install).
    const dest = managedFile(managedDir, 'coding-agent');
    mkdirSync(join(managedDir, slugForSkillName('coding-agent')), { recursive: true });
    writeFileSync(dest, '---\nname: coding-agent\n---\nREFINED BODY — must survive.\n');

    const r = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeDir });

    expect(r.copied).toBe(0);
    expect(r.alreadyPresent).toBe(1);
    expect(readFileSync(dest, 'utf8')).toContain('REFINED BODY — must survive.');
  });

  it('marker survives deletion of the populated file — a later boot still short-circuits (#957)', () => {
    const first = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeDir });
    expect(first.copied).toBe(1);

    // Delete the row-equivalent: wipe the populated managed file entirely.
    // The retired row-existence check would have re-armed here; the durable
    // marker must not.
    const dest = managedFile(managedDir, 'coding-agent');
    expect(existsSync(dest)).toBe(true);
    rmSync(join(managedDir, slugForSkillName('coding-agent')), {
      recursive: true,
      force: true,
    });
    expect(existsSync(dest)).toBe(false);

    const second = populateWorkflowSkillsOnce({ claudeSkillsDir: claudeDir });
    expect(second.alreadyDone).toBe(true);
    expect(second.copied).toBe(0);
    // The marker held — the deleted file is NOT silently re-materialized.
    expect(existsSync(dest)).toBe(false);
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

// ── #947 — import ONLY agent-referenced skills, not the whole Claude store ──
describe('skill_seed_importer — #947 imports only agent-referenced skills', () => {
  /** Build a temp ~/.claude/skills with the given <name>/SKILL.md dirs. */
  function makeClaudeSkills(names: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'rhythm-947-claude-'));
    for (const name of names) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(
        join(dir, name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name} skill.\n---\nBody for ${name}.\n`,
      );
    }
    return dir;
  }

  it('drops unreferenced Claude Code skills, keeps agent-referenced ones', () => {
    const skillsDir = makeClaudeSkills([
      'coding-agent', // agent-referenced (workflow chain)
      'verification-gate', // agent-referenced
      'defuddle', // Claude Code skill — NOT referenced
      'supabase', // Claude Code skill — NOT referenced
      'obsidian-cli', // Claude Code skill — NOT referenced
    ]);
    const referenced = new Set(['coding-agent', 'verification-gate']);

    const titles = discoverSeedInputs({ claudeSkillsDir: skillsDir }, referenced)
      .map((i) => i.title)
      .sort();

    expect(titles).toEqual(['coding-agent', 'verification-gate']);
    expect(titles).not.toContain('defuddle');
    expect(titles).not.toContain('supabase');
    expect(titles).not.toContain('obsidian-cli');
  });

  it('with no referenced set, discovery returns every skill (back-compat)', () => {
    const skillsDir = makeClaudeSkills(['coding-agent', 'defuddle']);
    const titles = discoverSeedInputs({ claudeSkillsDir: skillsDir }).map((i) => i.title).sort();
    expect(titles).toEqual(['coding-agent', 'defuddle']);
  });

  it('referencedSkillNames unions the canonical built-in set with agent_config allowlists', () => {
    // Injected fake repo — a user has widened an agent onto a normally-unreferenced skill.
    const fakeRepo = {
      list: () => [
        { allowedSkillsJson: JSON.stringify(['defuddle']) },
        { allowedSkillsJson: null },
        { allowedSkillsJson: 'not json' }, // malformed must not throw
      ],
    };

    const names = referencedSkillNames(fakeRepo);

    // Canonical workflow-chain names are always present.
    expect(names.has('coding-agent')).toBe(true);
    expect(names.has('verification-gate')).toBe(true);
    // The user-widened allowlist name is preserved.
    expect(names.has('defuddle')).toBe(true);
  });
});
