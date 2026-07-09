/**
 * #947 — Rhythm-managed skills directory (the SOLE skill source).
 *
 * Rhythm manages `~/.config/opencode/skills` directly and it is the only skill
 * source the model loads (see
 * docs/ai/decisions/2026-07-09-single-skill-source-config-opencode-skills.md,
 * which supersedes the 2026-06-28 Unify-2 decision).
 *
 * The opencode engine auto-scans `~/.config/opencode/{skill,skills}/**` via its
 * hardcoded `ConfigPaths.directories()` — so this dir needs NO `skills.paths`
 * registration. Rhythm additionally sets `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`
 * on the engine so `.claude/skills` and `.agents/skills` are no longer scanned:
 * skills Rhythm wants are imported into this dir explicitly, never blanket
 * auto-pulled from the global Claude Code / Codex stores.
 *
 * This became the sole source once agent-stack `ai-workflow sync-globals`
 * stopped writing `~/.config/opencode/skills` (it keeps `~/.claude/skills` +
 * `~/.codex/skills` for Claude Code / Codex). That removed the original
 * constraint that forced the separate `rhythm-managed-skills` sibling dir; the
 * legacy dir migrates into this one via {@link migrateLegacyManagedSkills}.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  rmdirSync,
  renameSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import { scanContextContent } from '../security/context_scanner';

/**
 * The canonical Rhythm-managed skills dir — `~/.config/opencode/skills`, the
 * engine's auto-scanned config skills dir and Rhythm's SOLE managed source
 * (#947). No longer a distinct sibling: `sync-globals` stopped writing here, so
 * Rhythm owns it outright.
 *
 * Resolved lazily (not a captured constant) so tests can redirect it via
 * `RHYTHM_MANAGED_SKILLS_DIR` without manipulating the home directory.
 */
export function managedSkillsRoot(): string {
  return (
    process.env.RHYTHM_MANAGED_SKILLS_DIR ??
    join(homedir(), '.config', 'opencode', 'skills')
  );
}

/**
 * #947 — the retired pre-collapse managed dir
 * (`~/.config/opencode/rhythm-managed-skills`). Kept ONLY as the source of the
 * one-time {@link migrateLegacyManagedSkills} move into {@link managedSkillsRoot}.
 * Overridable via `RHYTHM_LEGACY_MANAGED_SKILLS_DIR` so migration tests run
 * entirely on temp dirs.
 */
export function legacyManagedSkillsRoot(): string {
  return (
    process.env.RHYTHM_LEGACY_MANAGED_SKILLS_DIR ??
    join(homedir(), '.config', 'opencode', 'rhythm-managed-skills')
  );
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

// ── #949 — Drafts namespace (harvested skills) ─────────────────────────────
// Harvested draft skills are written directly to a `drafts/` subfolder under
// the managed dir so the engine discovers them immediately (visible in the
// Flutter Skills UI, loadable by the model) and the extracting agent's own
// sessions can exercise them before human promotion. See decision doc
// 2026-07-08-harvest-to-file-autobind.md (supersedes the Unify-2
// "materialize-on-publish" section).

/** Input for a harvested draft skill written to the drafts namespace. */
export interface DraftManagedSkillInput extends ManagedSkillInput {
  /** Session that produced the draft. Becomes frontmatter `source_session`. */
  sourceSessionId: string;
  /** 0-1 confidence from the distill LLM. Becomes frontmatter `confidence`. */
  confidence: number;
  /** Provenance label (auto-extract | teacher-escalation). Default 'auto-extract'. */
  provenance?: string;
  /** ISO timestamp; defaults to now. Becomes frontmatter `extracted_at`. */
  extractedAt?: string;
}

/** The drafts subfolder under the managed root. */
export function draftsRoot(): string {
  return join(resolve(managedSkillsRoot()), 'drafts');
}

/** Absolute path to a draft skill's directory, guaranteed inside drafts/. */
function draftSkillDir(name: string): string {
  const slug = slugForSkillName(name);
  const root = draftsRoot();
  const dir = resolve(root, slug);
  // Defence in depth: resolved path must stay within the drafts dir.
  if (dir !== join(root, slug) && !dir.startsWith(root + sep)) {
    throw new InvalidSkillNameError(`Resolved draft skill path escapes the drafts dir: ${name}`);
  }
  return dir;
}

/** True when a draft SKILL.md for `name` already exists in the drafts namespace. */
export function draftSkillExists(name: string): boolean {
  return existsSync(join(draftSkillDir(name), 'SKILL.md'));
}

/** Render a draft skill to SKILL.md text with the harvest metadata frontmatter. */
export function renderDraftSkillMarkdown(skill: DraftManagedSkillInput): string {
  const lines = ['---', `name: ${skill.name}`];
  if (skill.description && skill.description.trim() !== '') {
    lines.push(`description: ${JSON.stringify(skill.description)}`);
  }
  lines.push('status: draft');
  lines.push('source: harvested');
  lines.push(`provenance: ${skill.provenance ?? 'auto-extract'}`);
  lines.push(`source_session: ${skill.sourceSessionId}`);
  lines.push(`confidence: ${skill.confidence}`);
  lines.push(`extracted_at: ${skill.extractedAt ?? new Date().toISOString()}`);
  lines.push('---', '', skill.body.endsWith('\n') ? skill.body.trimEnd() : skill.body, '');
  return lines.join('\n');
}

/**
 * Write (create or overwrite) a harvested draft skill's SKILL.md to the drafts
 * namespace. Returns the absolute file location. Same context-injection scan
 * and path-traversal guards as {@link writeManagedSkill}. Throws
 * {@link ContextInjectionBlockedError} on a blocked body and
 * {@link InvalidSkillNameError} on a bad name.
 */
export function writeDraftManagedSkill(skill: DraftManagedSkillInput): string {
  const scan = scanContextContent(skill.body, `draft skill "${skill.name}"`);
  if (scan.blocked) {
    throw new ContextInjectionBlockedError(scan.warning!);
  }
  const dir = draftSkillDir(skill.name);
  mkdirSync(dir, { recursive: true });
  const location = join(dir, 'SKILL.md');
  writeFileSync(location, renderDraftSkillMarkdown(skill), 'utf8');
  return location;
}

/**
 * #947 — ensure the managed dir exists so the engine can scan it. It is
 * `~/.config/opencode/skills`, auto-scanned by the engine's hardcoded
 * `ConfigPaths.directories()`, so NO `opencode.json` `skills.paths` entry is
 * written any more (the old additive registration is gone — the dir is picked
 * up by the config-dir scan). The engine warn-skips a missing dir, so we
 * create it up front at boot before spawn.
 */
export function ensureManagedSkillsDir(): void {
  try {
    mkdirSync(managedSkillsRoot(), { recursive: true });
  } catch (err) {
    logger.warn('[managed-skills] could not create managed dir:', err);
  }
}

/** Result of {@link migrateLegacyManagedSkills} — counts are of SKILL.md files. */
export interface ManagedSkillsMigrationResult {
  /** SKILL.md files found under the source dir before the move. */
  skillsBefore: number;
  /** SKILL.md files moved from source into dest. */
  moved: number;
  /** SKILL.md files left in source because dest already had that relative path. */
  skippedExisting: number;
  /** Of the source's SKILL.md files, how many are present under dest afterward. */
  presentAfter: number;
  /** True when every source SKILL.md ended up present under dest. */
  lossless: boolean;
}

/** Relative paths (POSIX-agnostic, uses `sep`) of every file under `root`. */
function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const r = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) walk(abs, r);
      else out.push(r);
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) walk(root, '');
  return out;
}

/** True when a relative path's basename is exactly SKILL.md. */
function isSkillMdPath(rel: string): boolean {
  return rel.split(sep).pop() === 'SKILL.md';
}

/** Remove now-empty subdirectories of `root` (never removes `root` itself). */
function pruneEmptyDirs(root: string): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const d = join(root, entry.name);
    pruneEmptyDirs(d);
    try {
      if (readdirSync(d).length === 0) rmdirSync(d);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * #947 — one-time, idempotent, no-loss MOVE of the legacy Rhythm-managed skills
 * dir into the sole managed dir. Operates on the given absolute dirs so tests
 * run entirely on temp dirs (never the real config). Safe to run repeatedly:
 *
 *   - a source file is moved only when dest has no file at that relative path
 *     (dest always wins — an existing dest file is NEVER clobbered);
 *   - a source file is removed only AFTER its dest counterpart exists (rename is
 *     atomic; a cross-device fallback copies then unlinks), so an interrupted
 *     run can never drop a skill;
 *   - a count guard asserts every source SKILL.md is present under dest before
 *     any empty source dir is pruned — it THROWS rather than prune on a
 *     shortfall.
 *
 * The migration is a straight relocation, not a curation pass: it preserves
 * whatever the legacy dir held (including skills a later remediation may prune).
 */
export function migrateLegacyManagedSkills(
  srcDir: string,
  destDir: string,
): ManagedSkillsMigrationResult {
  const src = resolve(srcDir);
  const dest = resolve(destDir);

  const srcFiles = listFilesRecursive(src);
  const srcSkillMd = srcFiles.filter(isSkillMdPath);
  const skillsBefore = srcSkillMd.length;

  // Self-move or empty source — nothing to do.
  if (src === dest || srcFiles.length === 0) {
    return { skillsBefore, moved: 0, skippedExisting: 0, presentAfter: skillsBefore, lossless: true };
  }

  let moved = 0;
  let skippedExisting = 0;
  for (const rel of srcFiles) {
    const from = join(src, rel);
    const to = join(dest, rel);
    if (existsSync(to)) {
      // Dest wins — leave the source copy in place (never clobber).
      if (isSkillMdPath(rel)) skippedExisting += 1;
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    try {
      renameSync(from, to);
    } catch {
      // Cross-device (EXDEV) fallback: copy then remove the source only after
      // the dest copy is written.
      copyFileSync(from, to);
      rmSync(from, { force: true });
    }
    if (isSkillMdPath(rel)) moved += 1;
  }

  // No-loss guard: every source SKILL.md must now exist under dest (moved, or
  // dest already had it). Abort BEFORE pruning anything if that isn't true.
  const presentAfter = srcSkillMd.filter((rel) => existsSync(join(dest, rel))).length;
  const lossless = presentAfter === skillsBefore;
  if (!lossless) {
    throw new Error(
      `[managed-skills] migration would lose skills: ${presentAfter}/${skillsBefore} present under dest — aborting before pruning source`,
    );
  }

  pruneEmptyDirs(src);
  try {
    if (existsSync(src) && readdirSync(src).length === 0) rmdirSync(src);
  } catch {
    /* best-effort — leftover collision files may keep it non-empty */
  }

  return { skillsBefore, moved, skippedExisting, presentAfter, lossless };
}

/**
 * #947 — boot hook for the legacy→sole-source migration. NO-OP unless
 * `RHYTHM_MIGRATE_MANAGED_SKILLS` is `1`/`true`, so it never runs against a real
 * config on its own: the real-config migration is deliberately gated behind
 * this flag and folds into the #961 remediation pass. Idempotent + no-loss (see
 * {@link migrateLegacyManagedSkills}). Never throws out of boot.
 */
export function maybeMigrateLegacyManagedSkills(): ManagedSkillsMigrationResult | null {
  const flag = process.env.RHYTHM_MIGRATE_MANAGED_SKILLS;
  if (!(flag === '1' || flag === 'true')) return null;
  const src = legacyManagedSkillsRoot();
  const dest = managedSkillsRoot();
  if (resolve(src) === resolve(dest)) return null;
  try {
    const r = migrateLegacyManagedSkills(src, dest);
    logger.info(
      `[managed-skills] legacy migration: before=${r.skillsBefore} moved=${r.moved} ` +
        `skippedExisting=${r.skippedExisting} presentAfter=${r.presentAfter} lossless=${r.lossless}`,
    );
    return r;
  } catch (err) {
    logger.warn('[managed-skills] legacy migration failed (non-fatal):', err);
    return null;
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
