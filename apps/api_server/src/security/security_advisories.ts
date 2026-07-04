/**
 * security_advisories.ts — Issue #877
 *
 * Startup/CI scan of installed npm package versions against a curated list of
 * known-compromised versions (`advisories.json`). Adapted from the
 * `hermes_cli/security_advisories.py` prior art (Python/pip) to Rhythm's
 * actual stack (Node/TypeScript, npm) — the advisory shape (id, package,
 * affected_versions, description, remediation, severity) is unchanged; the
 * remediation command is an `npm install` rather than `pip install`.
 *
 * Design constraints from the issue:
 *   - stdlib only, no network request at scan time — reads the already-
 *     resolved `package-lock.json` (fast: one JSON.parse + one map scan).
 *   - < 100ms with a 20-entry advisory list.
 *   - the advisory list is a standalone JSON file, updatable without a code
 *     change.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { AdvisoryAckStore } from './advisory_acks';

export type AdvisorySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Advisory {
  id: string;
  package: string;
  affected_versions: string[];
  description: string;
  remediation: string;
  severity: AdvisorySeverity;
}

export interface AdvisoryMatch {
  advisory: Advisory;
  installedVersion: string;
}

/** Default location of the shipped, curated advisory list. */
function defaultAdvisoriesPath(): string {
  return join(__dirname, 'advisories.json');
}

/**
 * Load the curated advisory list from `advisories.json` (or an injected path
 * for testing). Never throws: a missing/malformed file logs a warning and
 * returns an empty list, since a broken advisory file must never crash
 * startup (fail-safe, not fail-open on a scan — an empty list simply means
 * nothing is checked, matching the issue's "ack file malformed → no crash"
 * spirit applied to the advisory source itself).
 */
export function loadAdvisories(path: string = defaultAdvisoriesPath()): Advisory[] {
  if (!existsSync(path)) {
    logger.warn(`[security_advisories] advisory list not found at ${path}`);
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is Advisory =>
        !!a &&
        typeof a === 'object' &&
        typeof (a as Advisory).id === 'string' &&
        typeof (a as Advisory).package === 'string' &&
        Array.isArray((a as Advisory).affected_versions),
    );
  } catch (err) {
    logger.warn(`[security_advisories] advisory list unreadable at ${path}:`, err);
    return [];
  }
}

/** Default location of the lockfile this scanner checks — the api_server's own. */
function defaultLockfilePath(): string {
  return join(__dirname, '..', '..', 'package-lock.json');
}

/**
 * npm v3-lockfile `packages` keys look like `node_modules/<name>` or, for a
 * scoped package, `node_modules/@scope/name`, or nested for a transitive dep
 * pinned to a different version, e.g. `node_modules/foo/node_modules/<name>`.
 * Extract just the trailing package name (scope included).
 */
function packageNameFromLockKey(key: string): string | null {
  const idx = key.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const rest = key.slice(idx + 'node_modules/'.length);
  if (rest.startsWith('@')) {
    const parts = rest.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return rest.split('/')[0] || null;
}

/**
 * Read every resolved `<package, version>` pair out of a `package-lock.json`
 * (lockfileVersion 2/3 `packages` map). Returns an empty map (never throws)
 * when the file is missing or malformed.
 */
function readInstalledVersions(lockfilePath: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  if (!existsSync(lockfilePath)) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== 'object') return result;
  const packages = (parsed as { packages?: Record<string, { version?: string }> }).packages;
  if (!packages || typeof packages !== 'object') return result;

  for (const [key, entry] of Object.entries(packages)) {
    if (!entry || typeof entry.version !== 'string') continue;
    const name = packageNameFromLockKey(key);
    if (!name) continue;
    const versions = result.get(name) ?? new Set<string>();
    versions.add(entry.version);
    result.set(name, versions);
  }
  return result;
}

/**
 * Check `advisories` against the resolved package versions in `lockfilePath`.
 * Never throws — a missing/malformed lockfile simply yields no matches.
 * O(advisories) lookups against a pre-built name→versions map, so this stays
 * well under the 100ms/20-advisory budget regardless of lockfile size.
 */
export function checkAdvisories(
  advisories: Advisory[],
  lockfilePath: string = defaultLockfilePath(),
): AdvisoryMatch[] {
  const installed = readInstalledVersions(lockfilePath);
  const matches: AdvisoryMatch[] = [];

  for (const advisory of advisories) {
    const versions = installed.get(advisory.package);
    if (!versions) continue;
    for (const v of advisory.affected_versions) {
      if (versions.has(v)) {
        matches.push({ advisory, installedVersion: v });
        break; // one match per advisory is enough
      }
    }
  }

  return matches;
}

/**
 * Run the full startup check: load the shipped advisory list, check it
 * against the lockfile, and drop any advisory the user has already
 * acknowledged. This is the single entry point `server.ts` and `doctor`
 * should call.
 */
export function runAdvisoryCheck(
  ackStore: AdvisoryAckStore = new AdvisoryAckStore(),
  advisoriesPath?: string,
  lockfilePath?: string,
): AdvisoryMatch[] {
  const advisories = loadAdvisories(advisoriesPath);
  const matches = checkAdvisories(advisories, lockfilePath);
  return matches.filter((m) => !ackStore.isAcked(m.advisory.id));
}

/**
 * One-line startup banner warning, or `null` when there is nothing to report.
 * Per the issue: "show a one-line warning in the startup banner pointing to
 * `rhythm doctor` for full details."
 */
export function formatStartupWarning(matches: AdvisoryMatch[]): string | null {
  if (matches.length === 0) return null;
  const plural = matches.length === 1 ? 'advisory' : 'advisories';
  return `[security] ${matches.length} known-compromised package ${plural} detected — run 'rhythm doctor' for details.`;
}

/**
 * Full multi-line report for `rhythm doctor`: package, affected version, and
 * the exact remediation command for each active (non-acknowledged) advisory.
 */
export function formatDoctorReport(matches: AdvisoryMatch[]): string {
  if (matches.length === 0) {
    return 'Supply-chain advisories: no active advisories — all clear.';
  }
  const lines = [`Supply-chain advisories: ${matches.length} active`, ''];
  for (const { advisory, installedVersion } of matches) {
    lines.push(
      `- [${advisory.severity.toUpperCase()}] ${advisory.id}: ${advisory.package}@${installedVersion}`,
      `  ${advisory.description}`,
      `  Remediation: ${advisory.remediation}`,
      `  Acknowledge: rhythm doctor --ack ${advisory.id}`,
      '',
    );
  }
  return lines.join('\n').trimEnd();
}
