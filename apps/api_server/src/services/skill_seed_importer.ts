/**
 * Skill Seed Importer — pure frontmatter parsing/matching helpers, plus the
 * ONE-TIME population of agent-referenced workflow skills into the sole
 * managed dir (~/.config/opencode/skills). See {@link populateWorkflowSkillsOnce}.
 *
 * Source dir (matched by title):
 *   • ~/.claude/skills/<name>/SKILL.md — Claude Code skill definitions
 *
 * #947: this module NO LONGER blanket-pulls every ~/.claude/skills entry.
 * Rhythm's sole skill source is ~/.config/opencode/skills, which it manages
 * itself; the global Claude Code store holds many skills Rhythm's agents never
 * use (design/misc skills like impeccable/adapt/supabase/obsidian-*). Only
 * skills whose name is referenced by an agent are populated — the canonical
 * built-in allowlists (agent_profile_sync) unioned with any stored
 * agent_config `allowedSkillsJson` (see {@link referencedSkillNames}). Skills
 * an agent depends on are preserved; unreferenced Claude Code skills are
 * dropped at the source rather than materialized into the picker.
 *
 * #957: the opencode agents dir (~/.config/opencode/agents/*.md) was ALSO
 * scanned here. That was wrong — agents are ROLES, not skills. Importing each
 * agent's role-text as a `published` skill row made it materialize into the
 * managed-skills dir as a colliding SKILL.md stub (name=agent id,
 * description=agent label, body=agent system prompt), polluting the engine's
 * skill picker on every seed/backfill. The agents dir is no longer a seed
 * source; the agent→file projection lives in opencode_agent_writer.ts.
 *
 * #947 (second pass): the original recurring DB-row seed (`seedAgentStackSkills`,
 * guarded by a `source==='agent-stack-seed'` row-existence check) was replaced
 * by {@link populateWorkflowSkillsOnce} — a raw SKILL.md FILE copy, guarded by a
 * DURABLE `schema_meta` marker instead of row existence. The row-existence
 * check re-armed the instant rows were deleted (#957); worse, a boot mechanism
 * that re-imports/re-materializes skills from ~/.claude/skills on every start
 * would silently clobber the self-improvement engine's in-place refinements
 * (#929/#959/#969). Population now runs exactly once, ever, per install, and
 * never overwrites a file already present at its managed destination.
 *
 * SKILL.md files use YAML frontmatter (--- … ---) with `name` + `description`;
 * the body is markdown prose. Skills don't carry `tags`/`when_to_use` in
 * practice — handled defensively if present.
 *
 * Local SQLite only. No-op under test env (must never read/write the user's
 * real ~/.config or ~/.claude dirs from vitest) and no-op under Postgres.
 */

import { homedir } from 'os';
import { join } from 'path';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { canonicalAgentSkillNames } from './agent_profile_sync';
import { managedSkillsRoot, slugForSkillName } from './rhythm_managed_skills';
import type { AgentSkillInput } from '../models/agent_skill';

/**
 * `source` value stamped on an {@link AgentSkillInput} by
 * {@link frontmatterToSkillInput}. Historically written to `agent_skills` rows
 * by the now-removed recurring `seedAgentStackSkills`; kept as the constant
 * those pure mapping helpers (and their tests) still use.
 */
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

/** Injectable seed source dirs (test seam). */
export interface SeedSourceDirs {
  /** Claude Code skills dir. Defaults to ~/.claude/skills. */
  claudeSkillsDir?: string;
  /**
   * #957: the opencode agents dir. Accepted ONLY so the regression test can
   * prove it is never scanned — agents are ROLES, not skills. Deliberately
   * unused: nothing here reads it. Scanning it (as the original importer did)
   * projected every agent's role-text into a published skill row that then
   * materialized as a colliding SKILL.md stub.
   */
  opencodeAgentsDir?: string;
}

/**
 * Discover candidate skill inputs from the real-skill source dir. No DB access.
 *
 * ONLY ~/.claude/skills is scanned. The opencode agents dir is intentionally
 * NOT a source (#957) — see {@link SeedSourceDirs.opencodeAgentsDir}.
 *
 * #947: when `referencedNames` is provided, only skills whose resolved title
 * (frontmatter `name`, fallback dir name) is in the set are returned — Rhythm
 * imports agent-referenced skills, not the whole Claude Code store. When it is
 * omitted/null, every discovered skill is returned (pure-discovery back-compat).
 */
export function discoverSeedInputs(
  dirs: SeedSourceDirs = {},
  referencedNames?: Set<string> | null,
): AgentSkillInput[] {
  const inputs: AgentSkillInput[] = [];

  // Claude skills — <name>/SKILL.md. The only seed source.
  const skillsDir = dirs.claudeSkillsDir ?? claudeSkillsDir();
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, entry, 'SKILL.md');
      try {
        if (!existsSync(skillFile) || !statSync(skillFile).isFile()) continue;
        const content = readFileSync(skillFile, 'utf8');
        const fm = parseFrontmatter(content);
        const input = frontmatterToSkillInput(fm, entry, extractBody(content));
        if (referencedNames && !referencedNames.has(input.title.trim())) continue;
        inputs.push(input);
      } catch {
        // Unreadable file — skip silently.
      }
    }
  }

  return inputs;
}

/**
 * #947 — names of skills Rhythm agents actually depend on: the canonical
 * built-in allowlists ({@link canonicalAgentSkillNames}) unioned with every
 * name referenced by a stored agent_config `allowedSkillsJson` (user-widened
 * allowlists). The seed importer keeps ONLY ~/.claude/skills whose name is in
 * this set. `agentConfigsRepo` is an injectable seam so the union logic is
 * unit-testable without a DB.
 */
export function referencedSkillNames(
  agentConfigsRepo?: { list(): Array<{ allowedSkillsJson: string | null }> },
): Set<string> {
  const names = canonicalAgentSkillNames();
  try {
    const repo = agentConfigsRepo ?? new AgentConfigsRepository();
    for (const cfg of repo.list()) {
      if (!cfg.allowedSkillsJson) continue;
      try {
        const arr = JSON.parse(cfg.allowedSkillsJson) as unknown;
        if (Array.isArray(arr)) {
          for (const n of arr) if (typeof n === 'string') names.add(n.trim());
        }
      } catch {
        /* a malformed stored allowlist must not break seeding */
      }
    }
  } catch {
    /* DB unavailable — the canonical built-in set still applies */
  }
  return names;
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

// ── #947 (second pass) — one-time workflow-skill FILE population ──────────

/** `schema_meta` key for the run-once population marker. Durable: survives
 * deletion of any `agent_skills` row or managed SKILL.md file — the exact
 * opposite of the retired row-existence check that re-armed on row delete
 * (#957). */
export const POPULATE_MARKER = 'workflow_skills_populate_v1';

/** Default run-once check: a `schema_meta` marker row exists for {@link POPULATE_MARKER}. */
function defaultPopulateAlreadyDone(): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT key FROM schema_meta WHERE key = ?`)
      .get(POPULATE_MARKER) as { key: string } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

/** Default run-once record: upsert the {@link POPULATE_MARKER} marker with an ISO timestamp. */
function defaultPopulateMarkDone(): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(POPULATE_MARKER, new Date().toISOString());
  } catch (err) {
    logger.warn(
      `[skill-populate] could not write run-once marker (non-fatal): ${String(err)}`,
    );
  }
}

/** Injectable seams for {@link populateWorkflowSkillsOnce} (test-only). */
export interface PopulateWorkflowSkillsDeps {
  /** Injectable run-once check. Defaults to a `schema_meta` marker read. */
  alreadyDone?: () => boolean;
  /** Injectable run-once record. Defaults to a `schema_meta` upsert. */
  markDone?: () => void;
  /**
   * Injectable ~/.claude/skills source dir. Unlike {@link managedSkillsRoot}
   * (which already has the `RHYTHM_MANAGED_SKILLS_DIR` env test seam), the
   * Claude Code skills dir has no such override — under VITEST/NODE_ENV=test
   * the real dir is NEVER scanned unless a test explicitly passes one here,
   * so a bare `populateWorkflowSkillsOnce()` call can never touch a
   * developer's real ~/.claude/skills from a test run.
   */
  claudeSkillsDir?: string;
}

export interface PopulateResult {
  /** True when the run short-circuited because the marker already existed. */
  alreadyDone: boolean;
  /** SKILL.md files copied into the managed dir because none existed there yet. */
  copied: number;
  /** Referenced skills whose managed SKILL.md already existed — left untouched. */
  alreadyPresent: number;
}

const EMPTY_POPULATE_RESULT: PopulateResult = {
  alreadyDone: false,
  copied: 0,
  alreadyPresent: 0,
};

/**
 * #947 (second pass) — ONE-TIME population of agent-referenced workflow
 * skills into the sole managed dir (~/.config/opencode/skills). Replaces the
 * old recurring `seedAgentStackSkills` DB seed.
 *
 * For every name in {@link referencedSkillNames}, if a matching
 * `~/.claude/skills/<dir>/SKILL.md` exists (matched by frontmatter `name`,
 * falling back to the directory name), its file is COPIED byte-for-byte into
 * `managedSkillsRoot()/<slug>/SKILL.md` — but ONLY when nothing already lives
 * at that destination. A file already present is NEVER overwritten: the
 * self-improvement engine (#929/#959/#969) refines managed skill files in
 * place over time, and re-copying on every boot would silently clobber those
 * refinements.
 *
 * Guarded by a DURABLE `schema_meta` marker ({@link POPULATE_MARKER}) rather
 * than the retired row-existence check (#957 re-armed the moment rows were
 * deleted) — once set, this never runs again for the life of the install,
 * even if every populated file or `agent_skills` row is later deleted.
 *
 * Local SQLite only (no-op on Postgres — agent skill state is local-only).
 * NEVER throws — a failure leaves the marker unset so a later boot retries;
 * startup wiring is fire-and-forget.
 */
export function populateWorkflowSkillsOnce(
  deps: PopulateWorkflowSkillsDeps = {},
): PopulateResult {
  if (env.dbClient === 'postgres') {
    return { ...EMPTY_POPULATE_RESULT, alreadyDone: true };
  }

  const alreadyDone = deps.alreadyDone ?? defaultPopulateAlreadyDone;
  const markDone = deps.markDone ?? defaultPopulateMarkDone;
  const srcDir = deps.claudeSkillsDir ?? (isTestEnv() ? null : claudeSkillsDir());

  try {
    if (alreadyDone()) return { ...EMPTY_POPULATE_RESULT, alreadyDone: true };

    let copied = 0;
    let alreadyPresent = 0;

    if (srcDir && existsSync(srcDir)) {
      const referenced = referencedSkillNames();
      for (const entry of readdirSync(srcDir)) {
        const srcFile = join(srcDir, entry, 'SKILL.md');
        if (!existsSync(srcFile) || !statSync(srcFile).isFile()) continue;

        let title = entry;
        try {
          const fm = parseFrontmatter(readFileSync(srcFile, 'utf8'));
          if (fm.name) title = fm.name.trim();
        } catch {
          continue; // unreadable — skip silently, matches discoverSeedInputs
        }
        if (!referenced.has(title)) continue;

        const destDir = join(managedSkillsRoot(), slugForSkillName(title));
        const destFile = join(destDir, 'SKILL.md');
        if (existsSync(destFile)) {
          alreadyPresent += 1;
          continue;
        }
        mkdirSync(destDir, { recursive: true });
        copyFileSync(srcFile, destFile);
        copied += 1;
      }
    }

    // Only mark done AFTER a clean pass — a thrown error skips this so a
    // later boot retries from scratch.
    markDone();
    return { alreadyDone: false, copied, alreadyPresent };
  } catch (err) {
    logger.warn(`[skill-populate] population failed (non-fatal): ${String(err)}`);
    return { ...EMPTY_POPULATE_RESULT };
  }
}
