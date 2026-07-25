/**
 * config_seeds_seeder.ts — boot-time seeding of the opencode/Rhythm config
 * assets that ship in `apps/api_server/config_seeds/` onto disk under
 * `~/.config/opencode/`.
 *
 * Two asset kinds are seeded:
 *   • Skills — `config_seeds/skills/<name>/SKILL.md` → `<managedSkillsRoot()>/<slug>/SKILL.md`
 *     (managedSkillsRoot() is ~/.config/opencode/skills, the sole managed skill
 *     source — see rhythm_managed_skills.ts).
 *   • Config-doctor tools — `config_seeds/tools/*` → `~/.config/opencode/tools/`
 *     (classify.cjs, mcp-scan.cjs, config-doctor.sh, package.json, and — from a
 *     release bundle — node_modules/js-yaml). The .cjs/.sh scripts are chmod +x
 *     after copy.
 *
 * These are the on-disk complements to the config-doctor agent PROFILE seeded in
 * migrations.ts: the config-doctor runbook tells the agent to run
 * `node ~/.config/opencode/tools/classify.cjs`, so those tool files must exist.
 *
 * Version-gated + force-push (mirrors the config_doctor_prompt_vN runOnce in
 * migrations.ts): a `schema_meta` marker ({@link CONFIG_SEEDS_MARKER}) records
 * that the current revision has been seeded. When the marker is current the run
 * is a no-op; otherwise every asset is copied — OVERWRITING the managed
 * tool/skill files so a shipped fix propagates to existing installs — and then
 * the marker is written. Bump the marker key (v2, v3, …) to re-push a new
 * revision.
 *
 * Unlike the self-improvement-refined harvested skills (which
 * populateWorkflowSkillsOnce is careful NEVER to overwrite), these seeds are
 * Rhythm-owned reference assets: the whole point is that a shipped correction
 * replaces a stale on-disk copy, exactly like the config-doctor prompt force-push.
 *
 * Operational guards (mirror skill_seed_importer / obsidian_scope_backfill):
 *   • Postgres (env.dbClient === 'postgres') is a NO-OP — these assets are
 *     local-agent-only, never relevant to the hosted deployment.
 *   • NEVER throws — startup wiring is fire-and-forget; a failure must not block
 *     boot. A failure does NOT write the marker, so a later boot retries.
 *   • No-op under the test env unless a test injects an explicit source dir, so
 *     a bare call from vitest can never touch a developer's real ~/.config.
 */

import { homedir } from 'os';
import { join, dirname } from 'path';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { getDb } from '../database/db';
import { managedSkillsRoot, slugForSkillName } from './rhythm_managed_skills';
import { parseFrontmatter } from './skill_seed_importer';

/** schema_meta key for the version gate. Bump (v2, v3, …) to re-push a revision. */
export const CONFIG_SEEDS_MARKER = 'config_seeds_v1';

/**
 * Never touch the real ~/.config from a test run. Mirrored VERBATIM from
 * skill_seed_importer.ts isTestEnv().
 */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/**
 * Resolve the committed `config_seeds` source dir in BOTH runtime layouts —
 * dev (tsx from src/services) and packaged (dist/services, with config_seeds
 * copied as a sibling of dist/ by desktop_release.yml). Mirrors
 * {@link rhythmAnthropicPluginPath}'s dual-layout search exactly (config_seeds
 * lives beside opencode_plugins under the api_server root). Returns null when
 * neither candidate exists.
 */
export function configSeedsSourceDir(): string | null {
  const candidates = [
    join(__dirname, '..', '..', 'config_seeds'), // dist/services or src/services → api_server root
    join(__dirname, '..', 'config_seeds'), // flattened dist/ variant
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Absolute path to the seeded config-doctor tools dir (~/.config/opencode/tools). */
export function seededToolsDir(): string {
  return join(homedir(), '.config', 'opencode', 'tools');
}

/** Default run-once check: a `schema_meta` marker row exists for {@link CONFIG_SEEDS_MARKER}. */
function defaultAlreadyDone(): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT key FROM schema_meta WHERE key = ?`)
      .get(CONFIG_SEEDS_MARKER) as { key: string } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

/** Default run-once record: upsert the {@link CONFIG_SEEDS_MARKER} marker. */
function defaultMarkDone(): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(CONFIG_SEEDS_MARKER, new Date().toISOString());
  } catch (err) {
    logger.warn(
      `[config-seeds] could not write run-once marker (non-fatal): ${String(err)}`,
    );
  }
}

/** Injectable seams for {@link seedConfigAssets} (test-only). */
export interface SeedConfigAssetsDeps {
  /** Injectable run-once check. Defaults to a `schema_meta` marker read. */
  alreadyDone?: () => boolean;
  /** Injectable run-once record. Defaults to a `schema_meta` upsert. */
  markDone?: () => void;
  /**
   * Injectable committed source dir. Defaults to {@link configSeedsSourceDir}.
   * Under the test env a bare call resolves to null (real dir never scanned)
   * unless a test passes one here.
   */
  sourceDir?: string | null;
  /** Injectable managed skills root. Defaults to {@link managedSkillsRoot}. */
  skillsDestRoot?: string;
  /** Injectable tools dest dir. Defaults to {@link seededToolsDir}. */
  toolsDestDir?: string;
  /**
   * When false, skip the best-effort `npm install` of js-yaml into the seeded
   * tools dir. Defaults to true. Tests set false to keep the run hermetic.
   */
  provisionJsYaml?: boolean;
}

export interface SeedConfigAssetsResult {
  /** True when the run short-circuited because the marker was already current. */
  alreadyDone: boolean;
  /** SKILL.md files copied into the managed skills dir. */
  skillsCopied: number;
  /** Tool files copied into ~/.config/opencode/tools. */
  toolsCopied: number;
  /** True when a js-yaml provisioning `npm install` was attempted (and succeeded). */
  jsYamlProvisioned: boolean;
}

const EMPTY_RESULT: SeedConfigAssetsResult = {
  alreadyDone: false,
  skillsCopied: 0,
  toolsCopied: 0,
  jsYamlProvisioned: false,
};

/** Recursively copy `src` dir into `dest`, skipping dotfiles at every level. */
function copyDirRecursive(src: string, dest: string): number {
  let count = 0;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // skip .gitignore/.DS_Store etc.
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

/**
 * Copy every `config_seeds/skills/<name>/SKILL.md` into the managed skills dir
 * (keyed by frontmatter `name`, falling back to the directory name — matching
 * how the engine keys skills and how slugForSkillName derives the dest slug).
 * Overwrites an existing managed file so a shipped skill fix propagates.
 */
function seedSkills(srcRoot: string, destRoot: string): number {
  const skillsSrc = join(srcRoot, 'skills');
  if (!existsSync(skillsSrc)) return 0;
  let copied = 0;
  for (const entry of readdirSync(skillsSrc, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const srcFile = join(skillsSrc, entry.name, 'SKILL.md');
    if (!existsSync(srcFile) || !statSync(srcFile).isFile()) continue;

    let name = entry.name;
    try {
      const fm = parseFrontmatter(readFileSync(srcFile, 'utf8'));
      if (fm.name) name = fm.name.trim();
    } catch {
      // Unreadable — fall back to the directory name.
    }

    let slug: string;
    try {
      slug = slugForSkillName(name);
    } catch {
      continue; // invalid name — skip rather than throw
    }
    const destDir = join(destRoot, slug);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(srcFile, join(destDir, 'SKILL.md'));
    copied += 1;
  }
  return copied;
}

/**
 * Copy `config_seeds/tools/*` into ~/.config/opencode/tools, overwriting so a
 * shipped fix propagates. `node_modules` (present only in a release bundle) is
 * copied along verbatim. The .cjs/.sh scripts are made executable after copy.
 */
function seedTools(srcRoot: string, destDir: string): number {
  const toolsSrc = join(srcRoot, 'tools');
  if (!existsSync(toolsSrc)) return 0;
  const copied = copyDirRecursive(toolsSrc, destDir);
  // chmod +x the executable scripts (best-effort).
  for (const name of ['classify.cjs', 'mcp-scan.cjs', 'config-doctor.sh']) {
    const p = join(destDir, name);
    if (existsSync(p)) {
      try {
        chmodSync(p, 0o755);
      } catch (err) {
        logger.warn(`[config-seeds] chmod +x failed for ${p} (non-fatal): ${String(err)}`);
      }
    }
  }
  return copied;
}

/**
 * Ensure js-yaml is resolvable under the seeded tools dir. If a bundled
 * `node_modules/js-yaml` was already copied in, nothing to do. Otherwise do a
 * best-effort `npm install --omit=dev` in the seeded tools dir. NON-FATAL and
 * time-boxed: if it fails or times out, the classifiers still resolve js-yaml
 * from the Rhythm app bundle. Returns true only when an install was run and
 * succeeded.
 */
function ensureJsYaml(destDir: string): boolean {
  if (existsSync(join(destDir, 'node_modules', 'js-yaml'))) return false;
  if (!existsSync(join(destDir, 'package.json'))) return false;
  try {
    execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: destDir,
      stdio: 'ignore',
      timeout: 120000,
    });
    return existsSync(join(destDir, 'node_modules', 'js-yaml'));
  } catch (err) {
    logger.warn(
      `[config-seeds] best-effort js-yaml provisioning failed (non-fatal — app-bundle fallback applies): ${String(err)}`,
    );
    return false;
  }
}

/**
 * Seed the committed config assets to disk. Version-gated, force-pushing, never
 * throws. No-op on Postgres and (bare) under the test env. Fire-and-forget from
 * boot.
 */
export function seedConfigAssets(
  deps: SeedConfigAssetsDeps = {},
): SeedConfigAssetsResult {
  if (env.dbClient === 'postgres') {
    return { ...EMPTY_RESULT, alreadyDone: true };
  }

  const alreadyDone = deps.alreadyDone ?? defaultAlreadyDone;
  const markDone = deps.markDone ?? defaultMarkDone;
  const srcDir =
    deps.sourceDir !== undefined
      ? deps.sourceDir
      : isTestEnv()
        ? null
        : configSeedsSourceDir();
  const skillsDestRoot = deps.skillsDestRoot ?? managedSkillsRoot();
  const toolsDestDir = deps.toolsDestDir ?? seededToolsDir();
  const provisionJsYaml = deps.provisionJsYaml ?? true;

  try {
    if (alreadyDone()) return { ...EMPTY_RESULT, alreadyDone: true };

    let skillsCopied = 0;
    let toolsCopied = 0;
    let jsYamlProvisioned = false;

    if (srcDir && existsSync(srcDir)) {
      skillsCopied = seedSkills(srcDir, skillsDestRoot);
      toolsCopied = seedTools(srcDir, toolsDestDir);
      if (provisionJsYaml && toolsCopied > 0) {
        jsYamlProvisioned = ensureJsYaml(toolsDestDir);
      }
    } else {
      logger.warn(
        `[config-seeds] no config_seeds source dir found near ${dirname(__dirname)} — nothing seeded`,
      );
    }

    // Only mark done AFTER a clean pass — a thrown error skips this so a later
    // boot retries from scratch.
    markDone();
    return { alreadyDone: false, skillsCopied, toolsCopied, jsYamlProvisioned };
  } catch (err) {
    logger.warn(`[config-seeds] seeding failed (non-fatal): ${String(err)}`);
    return { ...EMPTY_RESULT };
  }
}
