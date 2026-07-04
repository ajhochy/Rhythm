/**
 * Unify-2 — Rhythm-managed skills directory.
 *
 * Part of unifying skills onto the opencode engine's filesystem store as the
 * single source of truth (see docs/ai/decisions/2026-06-28-unify-skills-source-of-truth.md).
 *
 * The opencode fork is the ONLY thing that loads skills for the model. It
 * discovers SKILL.md files from `.claude`/`.agents`, its config dirs, and any
 * paths listed under `config.skills.paths`. api_server (co-located with the
 * fork) owns ONE dedicated dir registered via `skills.paths` and writes/edits/
 * deletes SKILL.md files there. Everything else the fork discovers (plugins,
 * ~/.claude/skills, superpowers, anthropic-skills) is show + scope only — Rhythm
 * never writes outside this managed dir.
 *
 * IMPORTANT: this dir must NOT collide with the `sync-globals` targets
 * (~/.claude/skills, ~/.codex/skills, ~/.config/opencode/skills) — those are
 * overwritten by `ai-workflow sync-globals`. We use a distinct, Rhythm-namespaced
 * dir under the opencode config root.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import { scanContextContent } from '../security/context_scanner';

/**
 * The canonical Rhythm-managed skills dir. Registered additively with the fork
 * via `config.skills.paths`. Deliberately NOT `~/.config/opencode/skills`
 * (auto-scanned + a sync target) — a distinct namespaced sibling.
 *
 * Resolved lazily (not a captured constant) so tests can redirect it via
 * `RHYTHM_MANAGED_SKILLS_DIR` without manipulating the home directory.
 */
export function managedSkillsRoot(): string {
  return (
    process.env.RHYTHM_MANAGED_SKILLS_DIR ??
    join(homedir(), '.config', 'opencode', 'rhythm-managed-skills')
  );
}

function opencodeConfigPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

/** A managed skill as written to / read from disk. */
export interface ManagedSkillInput {
  /** Skill name — becomes SKILL.md frontmatter `name` (must match the fork's name). */
  name: string;
  /** One-line description — SKILL.md frontmatter `description`. */
  description?: string;
  /** Markdown body (everything after the frontmatter). */
  body: string;
}

/**
 * Validate a skill name and derive a filesystem-safe directory slug for it.
 * The fork keys skills by frontmatter `name`, not by directory name, so the
 * slug only needs to be safe + deterministic. Rejects path traversal and empty
 * names. Throws {@link InvalidSkillNameError} on bad input.
 */
export class InvalidSkillNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSkillNameError';
  }
}

/**
 * Issue #873 — thrown by {@link writeManagedSkill} when the skill body fails
 * the prompt-injection context scan. The skill is NOT written; callers should
 * treat this the same as {@link InvalidSkillNameError} (reject the write, do
 * not crash the caller). `warning` is the user-facing block message; the
 * scanner has already logged the triggering pattern id(s), never the content.
 */
export class ContextInjectionBlockedError extends Error {
  readonly warning: string;
  constructor(warning: string) {
    super(warning);
    this.name = 'ContextInjectionBlockedError';
    this.warning = warning;
  }
}

export function slugForSkillName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..') {
    throw new InvalidSkillNameError('Skill name must be non-empty');
  }
  // Reject anything that could escape the managed dir. The slug never contains
  // path separators, so traversal is impossible, but reject explicitly so the
  // caller gets a clear error instead of a silently-mangled name.
  if (/[\\/]/.test(trimmed) || trimmed.includes('..')) {
    throw new InvalidSkillNameError(
      `Skill name must not contain path separators or '..': ${name}`,
    );
  }
  // Slug: keep word chars and dashes; map everything else (e.g. the ':' in
  // 'engineering:code-review') to '__' so distinct names stay distinct.
  return trimmed.replace(/[^a-zA-Z0-9_-]+/g, '__');
}

/** Absolute path to a managed skill's directory, guaranteed inside the managed dir. */
function managedSkillDir(name: string): string {
  const slug = slugForSkillName(name);
  const root = resolve(managedSkillsRoot());
  const dir = resolve(root, slug);
  // Defence in depth: resolved path must stay within the managed dir.
  if (dir !== join(root, slug) && !dir.startsWith(root + sep)) {
    throw new InvalidSkillNameError(`Resolved skill path escapes the managed dir: ${name}`);
  }
  return dir;
}

/** True when a fork-reported skill `location` lives inside the Rhythm-managed dir. */
export function isManagedLocation(location: string | undefined | null): boolean {
  if (!location) return false;
  const root = resolve(managedSkillsRoot());
  const loc = resolve(location);
  return loc === root || loc.startsWith(root + sep);
}

/** Render a managed skill to SKILL.md text (YAML frontmatter + body). */
export function renderSkillMarkdown(skill: ManagedSkillInput): string {
  const lines = ['---', `name: ${skill.name}`];
  if (skill.description && skill.description.trim() !== '') {
    // Quote to stay valid YAML even when the description has ':' etc.
    lines.push(`description: ${JSON.stringify(skill.description)}`);
  }
  lines.push('---', '', skill.body.endsWith('\n') ? skill.body.trimEnd() : skill.body, '');
  return lines.join('\n');
}

/**
 * Idempotently register {@link RHYTHM_MANAGED_SKILLS_DIR} in opencode.json's
 * `skills.paths`, preserving every existing scan path. Returns true if the file
 * was modified (the caller should ensure the engine re-reads it — at boot this
 * happens before spawn; at runtime callers use {@link OpencodeClientService.reloadSkills}).
 *
 * Mirrors `ensureRequiredPlugins` in opencode_plugin_config.ts.
 */
export function ensureManagedSkillsDirRegistered(): boolean {
  const managedDir = managedSkillsRoot();
  const configPath = opencodeConfigPath();

  // The dir must exist for the fork to scan it (it warn-skips missing paths).
  try {
    mkdirSync(managedDir, { recursive: true });
  } catch (err) {
    logger.warn('[managed-skills] could not create managed dir:', err);
  }

  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      logger.warn('[managed-skills] opencode.json unreadable — leaving untouched:', err);
      return false;
    }
  }

  const skills = (parsed.skills && typeof parsed.skills === 'object'
    ? (parsed.skills as Record<string, unknown>)
    : {}) as { paths?: string[]; urls?: string[] };
  const paths = Array.isArray(skills.paths) ? [...skills.paths] : [];

  if (paths.includes(managedDir)) {
    return false; // already registered — additive no-op
  }

  paths.push(managedDir);
  parsed.skills = { ...skills, paths };

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    logger.info('[managed-skills] registered managed skills dir in opencode.json');
    return true;
  } catch (err) {
    logger.warn('[managed-skills] failed to write opencode.json:', err);
    return false;
  }
}

/**
 * Write (create or overwrite) a managed skill's SKILL.md. Returns the absolute
 * location of the written file. Throws {@link InvalidSkillNameError} for bad
 * names. Never writes outside {@link RHYTHM_MANAGED_SKILLS_DIR}.
 *
 * #873: the skill body is scanned for prompt-injection markers BEFORE it is
 * written. A managed skill's body is exactly the content the opencode engine
 * loads into the model's context (via `config.skills.paths`), so this is the
 * load-bearing chokepoint for "scan context files before loading." A
 * high-confidence match throws {@link ContextInjectionBlockedError} and the
 * file is NOT written — the caller decides how to surface the block (route
 * handlers map it to 400; internal auto-apply callers already catch
 * `InvalidSkillNameError`-style errors and degrade to a skip).
 */
export function writeManagedSkill(skill: ManagedSkillInput): string {
  const scan = scanContextContent(skill.body, `skill "${skill.name}"`);
  if (scan.blocked) {
    throw new ContextInjectionBlockedError(scan.warning!);
  }
  const dir = managedSkillDir(skill.name);
  mkdirSync(dir, { recursive: true });
  const location = join(dir, 'SKILL.md');
  writeFileSync(location, renderSkillMarkdown(skill), 'utf8');
  return location;
}

/**
 * Restore a managed SKILL.md from an exact byte snapshot.
 *
 * Auto-revert stores the complete pre-apply file, including its original
 * frontmatter formatting and trailing whitespace. Passing that snapshot back
 * through renderSkillMarkdown would wrap it in new frontmatter and normalize
 * whitespace, so rollback must use this confined raw-byte path instead.
 */
export function restoreManagedSkillBytes(
  name: string,
  contents: string | NodeJS.ArrayBufferView,
): string {
  const dir = managedSkillDir(name);
  mkdirSync(dir, { recursive: true });
  const location = join(dir, 'SKILL.md');
  writeFileSync(location, contents);
  return location;
}

/**
 * Delete a managed skill by name. Returns true if it existed and was removed,
 * false if no such managed skill exists. Only ever removes within the managed
 * dir — attempting to delete an external (non-managed) skill name simply finds
 * nothing here and returns false.
 */
export function deleteManagedSkill(name: string): boolean {
  const dir = managedSkillDir(name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Read the full SKILL.md body at a fork-reported skill `location`.
 *
 * The fork's live skill list reports a `location` per skill that may be either
 * the SKILL.md file itself or the directory containing it; this resolves both
 * (file → read directly; dir → read `<dir>/SKILL.md`). Works for BOTH managed
 * and external skills — viewing content is read-only and unrestricted, while
 * WRITES remain confined to the managed dir via {@link writeManagedSkill}.
 *
 * Returns the file contents, or null when the location is empty/missing or the
 * file does not exist.
 */
export function readSkillContentAtLocation(
  location: string | undefined | null,
): string | null {
  if (!location || location.trim() === '') return null;
  try {
    let filePath = location;
    if (existsSync(location) && statSync(location).isDirectory()) {
      filePath = join(location, 'SKILL.md');
    }
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    logger.warn('[managed-skills] could not read skill content at %s:', location, err);
    return null;
  }
}
