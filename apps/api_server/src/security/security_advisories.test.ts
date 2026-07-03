/**
 * Unit tests for issue #877 — supply-chain advisory scanner.
 *
 * Uses a FAKE advisory list + a FAKE lockfile fixture in all tests (never a
 * real compromised package name/version) so the hit-path tests never
 * reference an actually-malicious package.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkAdvisories,
  loadAdvisories,
  runAdvisoryCheck,
  formatStartupWarning,
  formatDoctorReport,
  type Advisory,
} from './security_advisories';

const FAKE_ADVISORIES: Advisory[] = [
  {
    id: 'RHYTHM-SA-TEST-001',
    package: 'totally-fake-test-package',
    affected_versions: ['1.2.3'],
    description: 'Fake advisory for test purposes only.',
    remediation: 'npm install totally-fake-test-package@latest',
    severity: 'critical',
  },
  {
    id: 'RHYTHM-SA-TEST-002',
    package: 'another-fake-package',
    affected_versions: ['0.9.0', '0.9.1'],
    description: 'Another fake advisory for test purposes only.',
    remediation: 'npm install another-fake-package@1.0.0',
    severity: 'high',
  },
];

function writeFakeLockfile(dir: string, packages: Record<string, string>): string {
  const lockPath = join(dir, 'package-lock.json');
  const packagesEntry: Record<string, { version: string }> = {};
  for (const [name, version] of Object.entries(packages)) {
    packagesEntry[`node_modules/${name}`] = { version };
  }
  writeFileSync(
    lockPath,
    JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: packagesEntry }, null, 2),
  );
  return lockPath;
}

describe('checkAdvisories (#877)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-advisories-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('matches when an installed version exactly matches an advisory version', () => {
    const lockPath = writeFakeLockfile(tempDir, { 'totally-fake-test-package': '1.2.3' });
    const matches = checkAdvisories(FAKE_ADVISORIES, lockPath);
    expect(matches).toHaveLength(1);
    expect(matches[0].advisory.id).toBe('RHYTHM-SA-TEST-001');
    expect(matches[0].installedVersion).toBe('1.2.3');
  });

  it('produces no match when the installed version is not in the advisory list', () => {
    const lockPath = writeFakeLockfile(tempDir, { 'totally-fake-test-package': '1.2.4' });
    const matches = checkAdvisories(FAKE_ADVISORIES, lockPath);
    expect(matches).toHaveLength(0);
  });

  it('produces no match when the package is not installed at all', () => {
    const lockPath = writeFakeLockfile(tempDir, { 'unrelated-package': '1.0.0' });
    const matches = checkAdvisories(FAKE_ADVISORIES, lockPath);
    expect(matches).toHaveLength(0);
  });

  it('matches one of several affected_versions entries', () => {
    const lockPath = writeFakeLockfile(tempDir, { 'another-fake-package': '0.9.1' });
    const matches = checkAdvisories(FAKE_ADVISORIES, lockPath);
    expect(matches).toHaveLength(1);
    expect(matches[0].advisory.id).toBe('RHYTHM-SA-TEST-002');
  });

  it('matches multiple advisories independently', () => {
    const lockPath = writeFakeLockfile(tempDir, {
      'totally-fake-test-package': '1.2.3',
      'another-fake-package': '0.9.0',
    });
    const matches = checkAdvisories(FAKE_ADVISORIES, lockPath);
    expect(matches).toHaveLength(2);
  });

  it('does not crash and returns no matches for a missing lockfile', () => {
    const missingPath = join(tempDir, 'does-not-exist.json');
    expect(() => checkAdvisories(FAKE_ADVISORIES, missingPath)).not.toThrow();
    expect(checkAdvisories(FAKE_ADVISORIES, missingPath)).toHaveLength(0);
  });

  it('does not crash and returns no matches for a malformed lockfile', () => {
    const lockPath = join(tempDir, 'package-lock.json');
    writeFileSync(lockPath, 'not valid json {{{');
    expect(() => checkAdvisories(FAKE_ADVISORIES, lockPath)).not.toThrow();
    expect(checkAdvisories(FAKE_ADVISORIES, lockPath)).toHaveLength(0);
  });

  it('handles scoped package names correctly', () => {
    const scoped: Advisory[] = [
      {
        id: 'RHYTHM-SA-TEST-003',
        package: '@fake-scope/fake-pkg',
        affected_versions: ['2.0.0'],
        description: 'Fake scoped advisory.',
        remediation: 'npm install @fake-scope/fake-pkg@latest',
        severity: 'critical',
      },
    ];
    const lockPath = writeFakeLockfile(tempDir, { '@fake-scope/fake-pkg': '2.0.0' });
    const matches = checkAdvisories(scoped, lockPath);
    expect(matches).toHaveLength(1);
  });

  it('completes a 20-entry advisory list scan in under 100ms', () => {
    const many: Advisory[] = Array.from({ length: 20 }, (_, i) => ({
      id: `RHYTHM-SA-PERF-${i}`,
      package: `fake-perf-package-${i}`,
      affected_versions: ['1.0.0'],
      description: 'Perf fixture advisory.',
      remediation: 'npm install fake-perf-package@latest',
      severity: 'low' as const,
    }));
    const lockPath = writeFakeLockfile(tempDir, { 'fake-perf-package-5': '1.0.0' });
    const start = performance.now();
    checkAdvisories(many, lockPath);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

describe('loadAdvisories (#877)', () => {
  it('loads the shipped advisories.json without throwing', () => {
    const advisories = loadAdvisories();
    expect(Array.isArray(advisories)).toBe(true);
    expect(advisories.length).toBeGreaterThan(0);
    for (const a of advisories) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.package).toBe('string');
      expect(Array.isArray(a.affected_versions)).toBe(true);
    }
  });
});

describe('formatStartupWarning (#877)', () => {
  it('returns null when there are no matches', () => {
    expect(formatStartupWarning([])).toBeNull();
  });

  it('returns a one-line warning pointing to rhythm doctor when matches exist', () => {
    const line = formatStartupWarning([
      { advisory: FAKE_ADVISORIES[0], installedVersion: '1.2.3' },
    ]);
    expect(line).not.toBeNull();
    expect(line).toContain('rhythm doctor');
    expect((line!.match(/\n/g) ?? []).length).toBe(0);
  });
});

describe('CI gate — real lockfile has zero unacknowledged advisory matches (#877)', () => {
  it('fails CI if apps/api_server/package-lock.json matches a known-compromised version', () => {
    // No injected paths: this deliberately checks the REAL shipped
    // advisories.json against the REAL api_server package-lock.json, so a
    // match here fails `npm test` — the CI gate the issue requires — without
    // a separate workflow step. Any acknowledged advisory (via
    // AdvisoryAckStore) is still excluded, matching runtime behavior.
    const matches = runAdvisoryCheck();
    if (matches.length > 0) {
      const details = formatDoctorReport(matches);
      throw new Error(
        `Known-compromised package version(s) detected in apps/api_server. Run 'npm install' to update, or see details:\n${details}`,
      );
    }
    expect(matches).toHaveLength(0);
  });
});

describe('formatDoctorReport (#877)', () => {
  it('shows full details for each active advisory', () => {
    const report = formatDoctorReport([
      { advisory: FAKE_ADVISORIES[0], installedVersion: '1.2.3' },
    ]);
    expect(report).toContain('RHYTHM-SA-TEST-001');
    expect(report).toContain('1.2.3');
    expect(report).toContain('npm install totally-fake-test-package@latest');
  });

  it('reports all-clear when there are no matches', () => {
    const report = formatDoctorReport([]);
    expect(report.toLowerCase()).toContain('no active');
  });
});
