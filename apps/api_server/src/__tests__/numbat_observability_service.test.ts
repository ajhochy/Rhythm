/**
 * Unit tests for #1452 — NumbatObservabilityService
 *
 * Numbat (perplexityai/numbat) is an OBSERVE-ONLY OpenCode monitoring hook.
 * Rhythm invokes its CLI installer as a subprocess at api_server startup; it
 * never becomes part of any request path. All I/O is mocked — no real numbat
 * binary is spawned by these tests.
 *
 * Regressions this file catches:
 *  - Binary resolution order drifting from RHYTHM_NUMBAT_BIN_PATH → Homebrew
 *    paths → bare PATH lookup (AC1 prerequisite).
 *  - The install invocation silently gaining `--enforce`, `--output http`, or
 *    `--content full` — the exact no-telemetry/no-enforcement contract (AC3/AC4).
 *  - `RHYTHM_NUMBAT_MONITORING_DISABLED=1` still spawning/resolving anything (AC5).
 *  - An absent binary throwing into api_server startup instead of logging once (AC6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import {
  resolveNumbatBinary,
  ensureNumbatObservability,
  type NumbatBinaryResolutionDeps,
  type NumbatObservabilityDeps,
} from '../services/numbat_observability_service';

function fakeChild(): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  (ee as unknown as { unref: () => void }).unref = vi.fn();
  return ee;
}

// ---------------------------------------------------------------------------
// resolveNumbatBinary — discovery fallback order
// ---------------------------------------------------------------------------

describe('resolveNumbatBinary', () => {
  it('returns the RHYTHM_NUMBAT_BIN_PATH override when set and the file exists', () => {
    const result = resolveNumbatBinary({
      envGet: (k) => (k === 'RHYTHM_NUMBAT_BIN_PATH' ? '/custom/numbat' : undefined),
      fsExists: (p) => p === '/custom/numbat',
      which: () => null,
    });
    expect(result).toBe('/custom/numbat');
  });

  it('ignores RHYTHM_NUMBAT_BIN_PATH when the path does not exist, falling through', () => {
    const result = resolveNumbatBinary({
      envGet: (k) => (k === 'RHYTHM_NUMBAT_BIN_PATH' ? '/nonexistent/numbat' : undefined),
      fsExists: () => false,
      which: () => null,
    });
    expect(result).toBeNull();
  });

  it('falls back to /opt/homebrew/bin/numbat when no override is set', () => {
    const result = resolveNumbatBinary({
      envGet: () => undefined,
      fsExists: (p) => p === '/opt/homebrew/bin/numbat',
      which: () => null,
    });
    expect(result).toBe('/opt/homebrew/bin/numbat');
  });

  it('falls back to /usr/local/bin/numbat when the Homebrew ARM path is absent', () => {
    const result = resolveNumbatBinary({
      envGet: () => undefined,
      fsExists: (p) => p === '/usr/local/bin/numbat',
      which: () => null,
    });
    expect(result).toBe('/usr/local/bin/numbat');
  });

  it('falls back to bare PATH resolution when no fixed path exists', () => {
    const result = resolveNumbatBinary({
      envGet: () => undefined,
      fsExists: () => false,
      which: (bin) => (bin === 'numbat' ? '/home/user/.local/bin/numbat' : null),
    });
    expect(result).toBe('/home/user/.local/bin/numbat');
  });

  it('returns null when nothing resolves (AC6 prerequisite)', () => {
    const result = resolveNumbatBinary({
      envGet: () => undefined,
      fsExists: () => false,
      which: () => null,
    });
    expect(result).toBeNull();
  });

  it('prefers RHYTHM_NUMBAT_BIN_PATH over Homebrew paths and PATH when set and valid', () => {
    const whichSpy = vi.fn(() => '/shell/numbat');
    const result = resolveNumbatBinary({
      envGet: (k) => (k === 'RHYTHM_NUMBAT_BIN_PATH' ? '/my/numbat' : undefined),
      fsExists: () => true, // everything "exists" — override must still win
      which: whichSpy,
    });
    expect(result).toBe('/my/numbat');
    expect(whichSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ensureNumbatObservability — disable flag, absent binary, exact argv
// ---------------------------------------------------------------------------

describe('ensureNumbatObservability', () => {
  const priorHttpToken = process.env.NUMBAT_HTTP_TOKEN;
  const priorHttpHmacKey = process.env.NUMBAT_HTTP_HMAC_KEY;

  beforeEach(() => {
    delete process.env.NUMBAT_HTTP_TOKEN;
    delete process.env.NUMBAT_HTTP_HMAC_KEY;
  });

  afterEach(() => {
    if (priorHttpToken === undefined) delete process.env.NUMBAT_HTTP_TOKEN;
    else process.env.NUMBAT_HTTP_TOKEN = priorHttpToken;
    if (priorHttpHmacKey === undefined) delete process.env.NUMBAT_HTTP_HMAC_KEY;
    else process.env.NUMBAT_HTTP_HMAC_KEY = priorHttpHmacKey;
  });

  it('AC5: RHYTHM_NUMBAT_MONITORING_DISABLED=1 — zero resolution attempts, zero spawn attempts', () => {
    const resolveBinary = vi.fn(() => '/opt/homebrew/bin/numbat');
    const spawnFn = vi.fn();
    const deps: NumbatObservabilityDeps = {
      envGet: (k) => (k === 'RHYTHM_NUMBAT_MONITORING_DISABLED' ? '1' : undefined),
      resolveBinary,
      spawnFn: spawnFn as unknown as NumbatObservabilityDeps['spawnFn'],
    };
    expect(() => ensureNumbatObservability(deps)).not.toThrow();
    expect(resolveBinary).not.toHaveBeenCalled();
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('AC6: absent binary — logs one informational line, never throws, never spawns', () => {
    const infoSpy = vi.fn();
    const spawnFn = vi.fn();
    const deps: NumbatObservabilityDeps = {
      envGet: () => undefined,
      resolveBinary: () => null,
      spawnFn: spawnFn as unknown as NumbatObservabilityDeps['spawnFn'],
      logInfo: infoSpy,
    };
    expect(() => ensureNumbatObservability(deps)).not.toThrow();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it('AC3/AC4: spawns the exact observe-only install argv with no enforce/http/full-content flags', () => {
    const child = fakeChild();
    const spawnFn = vi.fn((_bin: string, _args: string[], _opts?: unknown) => child);
    const deps: NumbatObservabilityDeps = {
      envGet: () => undefined,
      resolveBinary: () => '/opt/homebrew/bin/numbat',
      spawnFn: spawnFn as unknown as NumbatObservabilityDeps['spawnFn'],
    };
    ensureNumbatObservability(deps);

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnFn.mock.calls[0];
    expect(bin).toBe('/opt/homebrew/bin/numbat');
    // Exact argv — the whole no-telemetry/no-enforcement contract is a static
    // read of this array (see docs/ai/decisions/2026-08-18-numbat-observability-integration.md).
    expect(args).toEqual(['hook', 'install', '--agent', 'opencode', '--emit', 'all', '--content', 'preview']);
    expect(args).not.toContain('--enforce');
    expect(args).not.toContain('--output');
    expect(args).not.toContain('http');
    expect(args).not.toContain('full');
  });

  it('AC3: never sets NUMBAT_HTTP_TOKEN or NUMBAT_HTTP_HMAC_KEY on the process env', () => {
    const spawnFn = vi.fn(() => fakeChild());
    ensureNumbatObservability({
      envGet: () => undefined,
      resolveBinary: () => '/opt/homebrew/bin/numbat',
      spawnFn: spawnFn as unknown as NumbatObservabilityDeps['spawnFn'],
    });
    expect(process.env.NUMBAT_HTTP_TOKEN).toBeUndefined();
    expect(process.env.NUMBAT_HTTP_HMAC_KEY).toBeUndefined();
  });

  it('never throws even when the spawn call itself throws synchronously', () => {
    const spawnFn = vi.fn(() => {
      throw new Error('boom');
    });
    expect(() =>
      ensureNumbatObservability({
        envGet: () => undefined,
        resolveBinary: () => '/opt/homebrew/bin/numbat',
        spawnFn: spawnFn as unknown as NumbatObservabilityDeps['spawnFn'],
      }),
    ).not.toThrow();
  });

  it('logs a warning (never throws) when the spawned child later emits an error event', () => {
    const child = fakeChild();
    const warnSpy = vi.fn();
    ensureNumbatObservability({
      envGet: () => undefined,
      resolveBinary: () => '/opt/homebrew/bin/numbat',
      spawnFn: (() => child) as unknown as NumbatObservabilityDeps['spawnFn'],
      logWarn: warnSpy,
    });
    child.emit('error', new Error('ENOENT'));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
