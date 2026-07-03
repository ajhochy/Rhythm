/**
 * lazy_deps.ts — #876 (setup-06): auto-install skill dependencies on first
 * use (with allowlist and opt-out).
 *
 * A skill can declare `python_dependencies` in SKILL.md frontmatter (parsed
 * by skill_frontmatter.ts). The FIRST time that skill is used, this module
 * ensures every declared dependency is installed — but ONLY under these
 * non-negotiable security constraints:
 *
 *   1. ALLOWLIST — only packages in pip_allowlist.ts's PIP_ALLOWLIST are ever
 *      auto-installed. A package not on the list never reaches pip; the
 *      caller gets a FeatureUnavailableError with the exact manual command.
 *   2. NO ALTERNATE SOURCES — `git+`, `--index-url`/`-i`, and local/relative
 *      paths are rejected in `validateDependencySpec` BEFORE the allowlist
 *      check even runs, so a malicious frontmatter can't smuggle an
 *      out-of-band install through an allowlisted-looking package field.
 *   3. RHYTHM'S OWN VENV ONLY — every install targets `venvDir` (never system
 *      Python); `runPip`'s default implementation always passes
 *      `--python <venvDir>/bin/python` (POSIX) so pip cannot fall back to a
 *      system interpreter.
 *   4. OPT-OUT — `isLazyInstallEnabled()` (config: RHYTHM_ALLOW_LAZY_INSTALLS)
 *      disables ALL auto-installs machine-wide; every skill's unmet deps then
 *      surface as FeatureUnavailable instead.
 *   5. NEVER SILENT / NEVER THROWS — every failure path (disabled, not
 *      allowlisted, invalid spec, pip failure, spawn error) is caught and
 *      returned as a FeatureUnavailableError in `result.unavailable`, with a
 *      copy-pasteable `pip install <pkg>` remediation command. The caller
 *      (skill execution) is expected to skip the skill's dependent feature
 *      and continue, not crash the session.
 *   6. AUDIT LOG — every SUCCESSFUL install appends one JSONL line (package,
 *      version, timestamp, skill) to `auditLogPath`. Failed/skipped installs
 *      are NOT logged (nothing was installed to audit).
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { isAllowedPackage } from './pip_allowlist';
import type { PythonDependency } from './skill_frontmatter';

export class FeatureUnavailableError extends Error {
  constructor(
    public readonly packageName: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'FeatureUnavailableError';
  }
}

export interface RunPipResult {
  ok: boolean;
  output: string;
}

export interface EnsurePythonDependenciesOptions {
  /** Rhythm's own Python venv dir. Defaults to defaultVenvDir(). */
  venvDir?: string;
  /** Path to the JSONL audit log. Defaults to a file inside venvDir. */
  auditLogPath?: string;
  /** Injectable pip runner (defaults to the real spawn-based installer). */
  runPip?: (args: string[], venvDir: string) => Promise<RunPipResult>;
  /** Injectable "is this already installed" check (defaults to false = always attempt). */
  isInstalled?: (packageName: string, venvDir: string) => Promise<boolean>;
  /** Overrides the live isLazyInstallEnabled() read — for tests / callers with a resolved config. */
  enabled?: boolean;
}

export interface EnsurePythonDependenciesResult {
  /** Package names newly installed this call. */
  installed: string[];
  /** One error per dependency that could not be installed (any reason). */
  unavailable: FeatureUnavailableError[];
}

/** Default location for Rhythm's lazy-install venv + audit log (namespaced, mirrors rhythm_managed_skills.ts). */
export function defaultVenvDir(): string {
  return process.env.RHYTHM_LAZY_DEPS_VENV_DIR ?? join(homedir(), '.local', 'share', 'rhythm', 'skill-lazy-deps');
}

function defaultAuditLogPath(venvDir: string): string {
  return join(venvDir, 'install-audit.jsonl');
}

/**
 * Live config-gate read (mirrors skill_retrieval.ts's isSkillInjectionEnabled
 * pattern — re-read per call so tests / a late .env can toggle it without a
 * restart). Default ON; only the literal strings 'false'/'0' disable it.
 */
export function isLazyInstallEnabled(): boolean {
  const raw = (process.env.RHYTHM_ALLOW_LAZY_INSTALLS ?? '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0');
}

const DISALLOWED_SPEC_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^git\+/i, reason: 'git+ URLs are not permitted' },
  { pattern: /\s(--index-url|--extra-index-url|-i)\b/, reason: 'custom index URLs are not permitted' },
  { pattern: /^\.{0,2}\//, reason: 'local filesystem paths are not permitted' },
  { pattern: /^[a-zA-Z]:\\/, reason: 'local filesystem paths are not permitted' },
];

/**
 * Reject any dependency spec that isn't a bare PyPI package name (with an
 * optional version range). Throws synchronously — called before the
 * allowlist check so a disallowed FORM never even reaches it.
 */
export function validateDependencySpec(dep: PythonDependency): void {
  for (const { pattern, reason } of DISALLOWED_SPEC_PATTERNS) {
    if (pattern.test(dep.package)) {
      throw new Error(`Rejected dependency spec "${dep.package}": ${reason}`);
    }
  }
}

function manualInstallCommand(dep: PythonDependency): string {
  const spec = dep.version ? `${dep.package}${dep.version}` : dep.package;
  return `pip install "${spec}"`;
}

/** Default pip runner — installs into Rhythm's own venv, never system Python. */
async function defaultRunPip(args: string[], venvDir: string): Promise<RunPipResult> {
  const { spawn } = await import('child_process');
  const pythonBin = process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python');
  return new Promise((resolve) => {
    const child = spawn(pythonBin, ['-m', 'pip', 'install', ...args], { stdio: 'pipe' });
    let output = '';
    child.stdout?.on('data', (d) => (output += String(d)));
    child.stderr?.on('data', (d) => (output += String(d)));
    child.on('error', (err) => resolve({ ok: false, output: String(err) }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });
}

async function defaultIsInstalled(): Promise<boolean> {
  // No injected checker → always attempt the install (pip itself is
  // idempotent/no-ops on an already-satisfied requirement); callers that want
  // a "no-op unless missing" fast path inject a real isInstalled.
  return false;
}

function appendAuditEntry(
  auditLogPath: string,
  entry: { package: string; version: string | null; skill: string; timestamp: string },
): void {
  mkdirSync(dirname(auditLogPath), { recursive: true });
  appendFileSync(auditLogPath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Ensure every declared python_dependency for `skillName` is installed,
 * subject to the allowlist + opt-out + venv-only constraints documented
 * above. Never throws — every failure becomes a FeatureUnavailableError in
 * the returned `unavailable` array.
 */
export async function ensurePythonDependencies(
  skillName: string,
  dependencies: PythonDependency[],
  opts: EnsurePythonDependenciesOptions = {},
): Promise<EnsurePythonDependenciesResult> {
  const installed: string[] = [];
  const unavailable: FeatureUnavailableError[] = [];

  if (dependencies.length === 0) {
    return { installed, unavailable };
  }

  const venvDir = opts.venvDir ?? defaultVenvDir();
  const auditLogPath = opts.auditLogPath ?? defaultAuditLogPath(venvDir);
  const runPip = opts.runPip ?? ((args: string[], dir: string) => defaultRunPip(args, dir));
  const isInstalled = opts.isInstalled ?? defaultIsInstalled;
  const enabled = opts.enabled ?? isLazyInstallEnabled();

  if (!existsSync(venvDir)) {
    try {
      mkdirSync(venvDir, { recursive: true });
    } catch {
      // Non-fatal — a failed mkdir surfaces as individual install failures below.
    }
  }

  for (const dep of dependencies) {
    try {
      validateDependencySpec(dep);
    } catch (err) {
      unavailable.push(
        new FeatureUnavailableError(
          dep.package,
          `${String(err instanceof Error ? err.message : err)}. Manual install is also blocked for this spec — use an allowlisted PyPI package name instead.`,
        ),
      );
      continue;
    }

    if (!isAllowedPackage(dep.package)) {
      unavailable.push(
        new FeatureUnavailableError(
          dep.package,
          `"${dep.package}" is not on Rhythm's approved package list, so it cannot be auto-installed. ` +
            `Run this manually in Rhythm's environment if you trust it: ${manualInstallCommand(dep)}`,
        ),
      );
      continue;
    }

    if (!enabled) {
      unavailable.push(
        new FeatureUnavailableError(
          dep.package,
          `Automatic dependency installation is disabled on this machine (RHYTHM_ALLOW_LAZY_INSTALLS=false). ` +
            `Run this manually in Rhythm's environment to enable this skill's feature: ${manualInstallCommand(dep)}`,
        ),
      );
      continue;
    }

    try {
      const already = await isInstalled(dep.package, venvDir);
      if (already) continue; // satisfied — not newly installed, not an error

      const spec = dep.version ? `${dep.package}${dep.version}` : dep.package;
      const result = await runPip([spec], venvDir);

      if (!result.ok) {
        unavailable.push(
          new FeatureUnavailableError(
            dep.package,
            `Automatic install of "${dep.package}" failed. Run this manually to diagnose: ${manualInstallCommand(dep)}\n${result.output}`,
          ),
        );
        continue;
      }

      installed.push(dep.package);
      try {
        appendAuditEntry(auditLogPath, {
          package: dep.package,
          version: dep.version ?? null,
          skill: skillName,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Non-fatal — a failed audit-log write must not undo a successful install.
      }
    } catch (err) {
      unavailable.push(
        new FeatureUnavailableError(
          dep.package,
          `Automatic install of "${dep.package}" failed unexpectedly (${String(err)}). Run this manually: ${manualInstallCommand(dep)}`,
        ),
      );
    }
  }

  return { installed, unavailable };
}
