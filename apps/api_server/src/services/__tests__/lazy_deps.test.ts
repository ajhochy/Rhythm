/**
 * lazy_deps.test.ts — #876 (setup-06): auto-install skill dependencies on
 * first use (with allowlist and opt-out).
 *
 * SECURITY (non-negotiable, per the issue): only PIP_ALLOWLIST packages are
 * ever auto-installed, always into Rhythm's own venv, never system Python;
 * git+/custom-index/local-path specs are rejected before the allowlist check
 * even runs; a disabled config or a failed install always yields
 * FeatureUnavailable with the exact manual command — never a throw, never
 * silent success-that-wasn't.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensurePythonDependencies,
  isLazyInstallEnabled,
  validateDependencySpec,
  FeatureUnavailableError,
} from '../lazy_deps';

describe('validateDependencySpec (#876 parse-time rejection)', () => {
  it('accepts a bare allowlisted package name', () => {
    expect(() => validateDependencySpec({ package: 'httpx' })).not.toThrow();
  });

  it('accepts a package with a version range', () => {
    expect(() => validateDependencySpec({ package: 'httpx', version: '>=0.27' })).not.toThrow();
  });

  it('rejects a git+https:// spec at parse time', () => {
    expect(() => validateDependencySpec({ package: 'git+https://example.com/evil.git' })).toThrow(
      /git\+/i,
    );
  });

  it('rejects a custom --index-url style spec at parse time', () => {
    expect(() => validateDependencySpec({ package: 'httpx --index-url https://evil.example.com' })).toThrow();
  });

  it('rejects a local path spec at parse time', () => {
    expect(() => validateDependencySpec({ package: '/usr/local/evil' })).toThrow();
    expect(() => validateDependencySpec({ package: './relative/path' })).toThrow();
  });
});

describe('isLazyInstallEnabled (#876 opt-out gate)', () => {
  const ORIGINAL = process.env.RHYTHM_ALLOW_LAZY_INSTALLS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.RHYTHM_ALLOW_LAZY_INSTALLS;
    else process.env.RHYTHM_ALLOW_LAZY_INSTALLS = ORIGINAL;
  });

  it('defaults to enabled when unset', () => {
    delete process.env.RHYTHM_ALLOW_LAZY_INSTALLS;
    expect(isLazyInstallEnabled()).toBe(true);
  });

  it('is disabled by the literal string "false"', () => {
    process.env.RHYTHM_ALLOW_LAZY_INSTALLS = 'false';
    expect(isLazyInstallEnabled()).toBe(false);
  });

  it('is disabled by "0"', () => {
    process.env.RHYTHM_ALLOW_LAZY_INSTALLS = '0';
    expect(isLazyInstallEnabled()).toBe(false);
  });
});

describe('ensurePythonDependencies (#876)', () => {
  let venvDir: string;
  let auditLogPath: string;

  beforeEach(() => {
    venvDir = mkdtempSync(join(tmpdir(), 'rhythm-lazy-venv-'));
    auditLogPath = join(venvDir, 'audit.jsonl');
  });

  afterEach(() => {
    rmSync(venvDir, { recursive: true, force: true });
  });

  it('a skill with no python_dependencies is a no-op (never installs)', async () => {
    const runPip = vi.fn();
    const result = await ensurePythonDependencies('my-skill', [], {
      venvDir,
      auditLogPath,
      runPip,
      enabled: true,
    });
    expect(result.installed).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(runPip).not.toHaveBeenCalled();
  });

  it('installs an allowlisted missing package automatically on first use', async () => {
    const runPip = vi.fn().mockResolvedValue({ ok: true, output: 'Successfully installed httpx' });
    const isInstalled = vi.fn().mockResolvedValue(false);
    const result = await ensurePythonDependencies(
      'my-skill',
      [{ package: 'httpx', version: '>=0.27' }],
      { venvDir, auditLogPath, runPip, isInstalled, enabled: true },
    );
    expect(result.installed).toEqual(['httpx']);
    expect(result.unavailable).toEqual([]);
    expect(runPip).toHaveBeenCalledTimes(1);
    // Always targets Rhythm's own venv — never system Python.
    const [args] = runPip.mock.calls[0];
    expect(args).toContain('httpx>=0.27');
  });

  it('does not re-install an already-installed package', async () => {
    const runPip = vi.fn();
    const isInstalled = vi.fn().mockResolvedValue(true);
    const result = await ensurePythonDependencies('my-skill', [{ package: 'httpx' }], {
      venvDir,
      auditLogPath,
      runPip,
      isInstalled,
      enabled: true,
    });
    expect(result.installed).toEqual([]); // nothing NEWLY installed
    expect(result.unavailable).toEqual([]);
    expect(runPip).not.toHaveBeenCalled();
  });

  it('a non-allowlisted package yields FeatureUnavailable with the exact manual pip command, never auto-installs', async () => {
    const runPip = vi.fn();
    const isInstalled = vi.fn().mockResolvedValue(false);
    const result = await ensurePythonDependencies(
      'my-skill',
      [{ package: 'super-sketchy-pkg' }],
      { venvDir, auditLogPath, runPip, isInstalled, enabled: true },
    );
    expect(runPip).not.toHaveBeenCalled();
    expect(result.installed).toEqual([]);
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0]).toBeInstanceOf(FeatureUnavailableError);
    expect(result.unavailable[0].message).toContain('pip install');
    expect(result.unavailable[0].message).toContain('super-sketchy-pkg');
  });

  it('allow_lazy_installs disabled skips ALL installs and returns FeatureUnavailable', async () => {
    const runPip = vi.fn();
    const isInstalled = vi.fn().mockResolvedValue(false);
    const result = await ensurePythonDependencies('my-skill', [{ package: 'httpx' }], {
      venvDir,
      auditLogPath,
      runPip,
      isInstalled,
      enabled: false,
    });
    expect(runPip).not.toHaveBeenCalled();
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0]).toBeInstanceOf(FeatureUnavailableError);
    expect(result.unavailable[0].message).toContain('httpx');
  });

  it('a failed pip install returns FeatureUnavailable with remediation, never throws', async () => {
    const runPip = vi.fn().mockResolvedValue({ ok: false, output: 'ERROR: could not find a version' });
    const isInstalled = vi.fn().mockResolvedValue(false);
    const result = await ensurePythonDependencies('my-skill', [{ package: 'httpx' }], {
      venvDir,
      auditLogPath,
      runPip,
      isInstalled,
      enabled: true,
    });
    expect(result.installed).toEqual([]);
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0].message).toContain('pip install');
  });

  it('a thrown pip error (e.g. spawn failure) is caught and returns FeatureUnavailable, never propagates', async () => {
    const runPip = vi.fn().mockRejectedValue(new Error('ENOENT: pip not found'));
    const isInstalled = vi.fn().mockResolvedValue(false);
    const result = await ensurePythonDependencies('my-skill', [{ package: 'httpx' }], {
      venvDir,
      auditLogPath,
      runPip,
      isInstalled,
      enabled: true,
    });
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0].message).toContain('pip install');
  });

  it('appends an audit log entry on successful install (package, version, timestamp, skill)', async () => {
    const runPip = vi.fn().mockResolvedValue({ ok: true, output: 'Successfully installed httpx' });
    const isInstalled = vi.fn().mockResolvedValue(false);
    await ensurePythonDependencies('gif-search', [{ package: 'httpx', version: '>=0.27' }], {
      venvDir,
      auditLogPath,
      runPip,
      isInstalled,
      enabled: true,
    });
    expect(existsSync(auditLogPath)).toBe(true);
    const lines = readFileSync(auditLogPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.package).toBe('httpx');
    expect(entry.version).toBe('>=0.27');
    expect(entry.skill).toBe('gif-search');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('does NOT write an audit log entry for a failed or skipped install', async () => {
    const runPip = vi.fn().mockResolvedValue({ ok: false, output: 'boom' });
    const isInstalled = vi.fn().mockResolvedValue(false);
    await ensurePythonDependencies('gif-search', [{ package: 'httpx' }], {
      venvDir,
      auditLogPath,
      runPip,
      isInstalled,
      enabled: true,
    });
    expect(existsSync(auditLogPath)).toBe(false);
  });

  it('rejects a git+ dependency before ever calling runPip, surfacing FeatureUnavailable', async () => {
    const runPip = vi.fn();
    const result = await ensurePythonDependencies(
      'my-skill',
      [{ package: 'git+https://example.com/evil.git' }],
      { venvDir, auditLogPath, runPip, enabled: true },
    );
    expect(runPip).not.toHaveBeenCalled();
    expect(result.unavailable).toHaveLength(1);
  });

  it('handles a mix of allowlisted-missing, already-installed, and non-allowlisted deps in one call', async () => {
    const runPip = vi.fn().mockResolvedValue({ ok: true, output: 'ok' });
    const isInstalled = vi.fn().mockImplementation((pkg: string) => Promise.resolve(pkg === 'pandas'));
    const result = await ensurePythonDependencies(
      'multi-dep-skill',
      [{ package: 'httpx' }, { package: 'pandas' }, { package: 'super-sketchy-pkg' }],
      { venvDir, auditLogPath, runPip, isInstalled, enabled: true },
    );
    expect(result.installed).toEqual(['httpx']);
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0].message).toContain('super-sketchy-pkg');
  });
});
