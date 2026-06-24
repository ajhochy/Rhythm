/**
 * Skill Seed Importer — one-time seed of vetted agent-stack skills into the
 * shared `agent_skills` store.
 *
 * Source dirs (both scanned, deduped by title):
 *   • ~/.config/opencode/agents/*.md   — opencode agent definitions
 *   • ~/.claude/skills/<name>/SKILL.md — Claude Code skill definitions
 *
 * Both use YAML frontmatter (--- … ---) with `name` + `description`; the body
 * is markdown prose. opencode agents additionally carry `mode`, `permission`,
 * `color`, etc. (not imported). Neither source carries `tags` or `when_to_use`
 * in practice — handled defensively if present.
 *
 * Field → column mapping (see AgentSkillInput):
 *   title       ← frontmatter `name` (fallback: filename without extension)
 *   description ← frontmatter `description`
 *   whenToUse   ← frontmatter `when_to_use`/`whenToUse` if present, else description
 *   tags        ← frontmatter `tags` (CSV or YAML inline list) if present, else null
 *   steps       ← null (these are prose skills, not step arrays — never fabricated)
 *   body        ← markdown body after the frontmatter block (the real procedure)
 *   status      ← 'published'
 *   source      ← 'agent-stack-seed'
 *   confidence  ← 1.0 (vetted seed)
 *
 * The full markdown *body* (the skill's real procedure) is persisted in the
 * `body` column so the store is self-contained — Rhythm owns the procedure text
 * rather than relying on opencode's on-disk agent files at runtime.
 *
 * Local SQLite only. No-op under test env (must never read/write the user's
 * real ~/.config or ~/.claude dirs from vitest) and no-op under Postgres.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentSkillInput } from '../models/agent_skill';

export const SEED_SOURCE = 'agent-stack-seed';

/**
 * Never touch the real ~/.config/opencode/agents or ~/.claude/skills dirs from
 * a test run. Mirrored VERBATIM from opencode_agent_writer.ts isTestEnv().
 * A prior bug let vitest pollute ~/.config/opencode/agents — this guard is the
 * fix and is proven by skill_seed_importer.test.ts (zero writes under VITEST).
 */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function opencodeAgentsDir(): string {
  return join(homedir(), '.config', 'opencode', 'agents');
}

function claudeSkillsDir(): string {
  return join(homedir(), '.claude', 'skills');
}

interface ParsedFrontmatter {
  name: string | null;
  description: string | null;
  whenToUse: string | null;
  tags: string[] | null;
}

/**
 * Minimal frontmatter parser. Extracts only the top-level scalar/inline fields
 * we map (name, description, when_to_use/whenToUse, tags). Deliberately simple —
 * no YAML dependency. Block lists and nested keys (e.g. opencode `permission:`)
 * are ignored. Pure (no filesystem) so it is unit-testable under VITEST.
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = {
    name: null,
    description: null,
    whenToUse: null,
    tags: null,
  };

  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return result;

  // Only top-level lines (no leading whitespace) are real frontmatter keys;
  // indented lines belong to nested blocks (permission, options, …).
  for (const rawLine of m[1].split('\n')) {
    if (/^\s/.test(rawLine)) continue;
    const kv = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = stripQuotes(kv[2].trim());
    if (value === '') continue;

    if (key === 'name') result.name = value;
    else if (key === 'description') result.description = value;
    else if (key === 'when_to_use' || key === 'whentouse') result.whenToUse = value;
    else if (key === 'tags') result.tags = parseTags(value);
  }

  return result;
}

/**
 * Extract the markdown body — everything after the closing frontmatter `---`.
 * Returns null when there is no frontmatter block or the body is empty/whitespace.
 * Pure (no filesystem) so it is unit-testable under VITEST.
 */
export function extractBody(text: string): string | null {
  const m = text.match(/^---\n[\s\S]*?\n---[ \t]*\r?\n?/);
  if (!m) return null;
  const body = text.slice(m[0].length).trim();
  return body.length > 0 ? body : null;
}

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Parse a `tags:` value as a YAML inline list `[a, b]` or a CSV `a, b`. */
function parseTags(value: string): string[] | null {
  let inner = value;
  if (inner.startsWith('[') && inner.endsWith(']')) {
    inner = inner.slice(1, -1);
  }
  const parts = inner
    .split(',')
    .map((t) => stripQuotes(t.trim()))
    .filter((t) => t.length > 0);
  return parts.length > 0 ? parts : null;
}

function fileNameWithoutExt(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '').replace(/\/SKILL$/i, '');
}

/**
 * Map a parsed frontmatter + fallback title into an AgentSkillInput for seeding.
 * Pure (no filesystem) so it is unit-testable under VITEST.
 */
export function frontmatterToSkillInput(
  fm: ParsedFrontmatter,
  fallbackTitle: string,
  body: string | null = null,
): AgentSkillInput {
  const title = (fm.name ?? fallbackTitle).trim();
  return {
    title,
    description: fm.description ?? null,
    whenToUse: fm.whenToUse ?? fm.description ?? null,
    steps: null,
    tags: fm.tags,
    body: body ?? null,
    status: 'published',
    source: SEED_SOURCE,
    confidence: 1.0,
  };
}

/** Discover candidate skill inputs from both source dirs. No DB access. */
function discoverSeedInputs(): AgentSkillInput[] {
  const inputs: AgentSkillInput[] = [];

  // 1) opencode agents — flat <name>.md files.
  const ocDir = opencodeAgentsDir();
  if (existsSync(ocDir)) {
    for (const entry of readdirSync(ocDir)) {
      if (!entry.toLowerCase().endsWith('.md')) continue;
      const path = join(ocDir, entry);
      try {
        if (!statSync(path).isFile()) continue;
        const content = readFileSync(path, 'utf8');
        const fm = parseFrontmatter(content);
        inputs.push(
          frontmatterToSkillInput(fm, fileNameWithoutExt(entry), extractBody(content)),
        );
      } catch {
        // Unreadable file — skip silently.
      }
    }
  }

  // 2) Claude skills — <name>/SKILL.md
  const skillsDir = claudeSkillsDir();
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, entry, 'SKILL.md');
      try {
        if (!existsSync(skillFile) || !statSync(skillFile).isFile()) continue;
        const content = readFileSync(skillFile, 'utf8');
        const fm = parseFrontmatter(content);
        inputs.push(frontmatterToSkillInput(fm, entry, extractBody(content)));
      } catch {
        // Unreadable file — skip silently.
      }
    }
  }

  return inputs;
}

/**
 * Deduplicate inputs by case-insensitive title, preferring the first seen.
 * Skips empty titles. Pure (no filesystem) so it is unit-testable under VITEST.
 */
export function dedupByTitle(inputs: AgentSkillInput[]): AgentSkillInput[] {
  const seen = new Set<string>();
  const out: AgentSkillInput[] = [];
  for (const input of inputs) {
    const key = (input.title ?? '').trim().toLowerCase();
    if (key === '') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(input);
  }
  return out;
}

export interface SeedResult {
  discovered: number;
  imported: number;
  skipped: number;
}

/**
 * One-time seed of vetted agent-stack skills into agent_skills.
 *
 * Idempotent: skips any title that already exists (in-memory dedup across both
 * sources + repo.findByTitle per row). No-op under test env or Postgres.
 */
export function seedAgentStackSkills(repo?: AgentSkillsRepository): SeedResult {
  if (isTestEnv()) return { discovered: 0, imported: 0, skipped: 0 };
  if (env.dbClient === 'postgres') return { discovered: 0, imported: 0, skipped: 0 };

  const skillsRepo = repo ?? new AgentSkillsRepository();
  const deduped = dedupByTitle(discoverSeedInputs());

  let imported = 0;
  let skipped = 0;
  for (const input of deduped) {
    if (skillsRepo.findByTitle(input.title)) {
      skipped += 1;
      continue;
    }
    skillsRepo.create(input);
    imported += 1;
  }

  return { discovered: deduped.length, imported, skipped };
}
