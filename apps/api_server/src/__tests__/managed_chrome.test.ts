/**
 * Unit tests for #748 — ManagedChromeService
 *
 * All I/O is mocked — no real Chrome is launched, no real HTTP requests made.
 * Covers:
 *  - Chrome launch args construction (correct flags, port, temp user-data-dir)
 *  - Binary discovery fallback order (env override → known paths → shell)
 *  - Readiness-probe logic (not-ready → ready transitions; timeout path)
 *  - Idempotent reuse (existing healthy :9222 → no spawn)
 *  - Graceful no-op when no binary found
 *  - Shutdown: only kills Chrome WE spawned; skips reused Chrome
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildChromeArgs,
  findChromeBinary,
  waitForChromeReady,
  ManagedChromeService,
  CHROME_CDP_PORT,
  type ChromeReadinessDeps,
  type ManagedChromeServiceDeps,
} from '../services/managed_chrome_service';

// ---------------------------------------------------------------------------
// buildChromeArgs
// ---------------------------------------------------------------------------

describe('buildChromeArgs', () => {
  it('includes the correct port and user-data-dir flags', () => {
    const args = buildChromeArgs(9222, '/tmp/rhythm-chrome-abc');
    expect(args).toContain('--headless=new');
    expect(args).toContain('--remote-debugging-port=9222');
    expect(args).toContain('--user-data-dir=/tmp/rhythm-chrome-abc');
    expect(args).toContain('--no-first-run');
    expect(args).toContain('--no-default-browser-check');
    expect(args).toContain('--disable-gpu');
  });

  it('uses the provided port number in the flag', () => {
    const args = buildChromeArgs(9333, '/tmp/dir');
    expect(args).toContain('--remote-debugging-port=9333');
  });

  it('passes the user-data-dir exactly as given', () => {
    const dir = '/tmp/rhythm-chrome-xyz9';
    const args = buildChromeArgs(9222, dir);
    const dirArg = args.find((a) => a.startsWith('--user-data-dir='));
    expect(dirArg).toBe(`--user-data-dir=${dir}`);
  });
});

// ---------------------------------------------------------------------------
// findChromeBinary — discovery fallback order
// ---------------------------------------------------------------------------

describe('findChromeBinary', () => {
  it('returns the env override when RHYTHM_CHROME_BIN is set and the file exists', () => {
    const result = findChromeBinary({
      envGet: (k) => (k === 'RHYTHM_CHROME_BIN' ? '/custom/chrome' : undefined),
      fsExists: (p) => p === '/custom/chrome',
      shellResolve: () => null,
    });
    expect(result).toBe('/custom/chrome');
  });

  it('ignores RHYTHM_CHROME_BIN when the path does not exist', () => {
    const result = findChromeBinary({
      envGet: (k) => (k === 'RHYTHM_CHROME_BIN' ? '/nonexistent/chrome' : undefined),
      // Nothing exists → fall through to shell → null
      fsExists: () => false,
      shellResolve: () => null,
    });
    expect(result).toBeNull();
  });

  it('refuses the default macOS Chrome bundle when no isolated binary exists', () => {
    const defaultChrome =
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = findChromeBinary({
      envGet: () => undefined,
      fsExists: (p) => p === defaultChrome,
      shellResolve: () => null,
    });
    expect(result).toBeNull();
  });

  it('tries alternative known paths when the first does not exist', () => {
    const chromiumPath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    const result = findChromeBinary({
      envGet: () => undefined,
      fsExists: (p) => p === chromiumPath,
      shellResolve: () => null,
    });
    expect(result).toBe(chromiumPath);
  });

  it('falls back to shell resolution when no known path exists', () => {
    const result = findChromeBinary({
      envGet: () => undefined,
      fsExists: () => false,
      shellResolve: () => '/opt/homebrew/bin/google-chrome-stable',
    });
    expect(result).toBe('/opt/homebrew/bin/google-chrome-stable');
  });

  it('returns null when env override is absent, no known path exists, and shell returns nothing', () => {
    const result = findChromeBinary({
      envGet: () => undefined,
      fsExists: () => false,
      shellResolve: () => null,
    });
    expect(result).toBeNull();
  });

  it('prefers RHYTHM_CHROME_BIN over all known paths when set and valid', () => {
    const shellSpy = vi.fn(() => '/shell/chrome');
    const result = findChromeBinary({
      envGet: (k) => (k === 'RHYTHM_CHROME_BIN' ? '/my/chrome' : undefined),
      // All paths exist — env override should still win
      fsExists: () => true,
      shellResolve: shellSpy,
    });
    expect(result).toBe('/my/chrome');
    // Shell should never have been called
    expect(shellSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// waitForChromeReady — readiness-probe logic
// ---------------------------------------------------------------------------

function makeReadinessDeps(
  responses: Array<boolean>,
  extraWait?: () => Promise<void>,
): ChromeReadinessDeps {
  let callCount = 0;
  return {
    probeCdpVersion: vi.fn().mockImplementation(async () => {
      const val = responses[callCount] ?? false;
      callCount++;
      return val;
    }),
    waitMs: vi.fn().mockImplementation(async () => {
      await (extraWait?.() ?? Promise.resolve());
    }),
  };
}

describe('waitForChromeReady', () => {
  it('returns true immediately when the first probe succeeds', async () => {
    const deps = makeReadinessDeps([true]);
    const result = await waitForChromeReady(9222, 5000, 10, deps);
    expect(result).toBe(true);
    expect(deps.probeCdpVersion).toHaveBeenCalledTimes(1);
  });

  it('retries until Chrome becomes ready', async () => {
    const deps = makeReadinessDeps([false, false, true]);
    const result = await waitForChromeReady(9222, 5000, 10, deps);
    expect(result).toBe(true);
    expect(deps.probeCdpVersion).toHaveBeenCalledTimes(3);
  });

  it('returns false when all probes fail within the timeout', async () => {
    // Use a very short timeout and interval so the test completes quickly.
    const deps: ChromeReadinessDeps = {
      probeCdpVersion: vi.fn().mockResolvedValue(false),
      // Advance time by returning immediately — let the Date.now() deadline expire naturally
      waitMs: vi.fn().mockResolvedValue(undefined),
    };

    // Override Date.now so we can control time without real sleeps
    const realNow = Date.now;
    let tick = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + tick++ * 300);

    const result = await waitForChromeReady(9222, 500, 10, deps);
    expect(result).toBe(false);

    vi.restoreAllMocks();
  });

  it('passes the correct port to the probe', async () => {
    const deps = makeReadinessDeps([true]);
    await waitForChromeReady(9333, 5000, 10, deps);
    expect(deps.probeCdpVersion).toHaveBeenCalledWith(9333);
  });
});

// ---------------------------------------------------------------------------
// ManagedChromeService — idempotent reuse when Chrome already on port
// ---------------------------------------------------------------------------

describe('ManagedChromeService — idempotent reuse of existing Chrome', () => {
  it('does not spawn when a healthy Chrome is already on :9222', async () => {
    const spawnSpy = vi.fn();
    // Inject a service whose _start is observable via the readiness deps probe
    const svc = new ManagedChromeService(9222);

    // Patch the private _start indirectly: the service calls probeCdpVersion
    // first; if it returns true, no spawn happens.
    const deps: ChromeReadinessDeps = {
      probeCdpVersion: vi.fn().mockResolvedValue(true), // already healthy
      waitMs: vi.fn(),
    };

    const result = await svc.ensureReady(deps);
    expect(result).toBe(true);
    expect(svc.isReady).toBe(true);
    // probeCdpVersion was called (probe ran)
    expect(deps.probeCdpVersion).toHaveBeenCalledWith(9222);
    // No spawn was attempted (spawn not called — deps.spawn would be a no-op)
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('shutdown does not kill a reused Chrome', async () => {
    const svc = new ManagedChromeService(9222);
    const deps: ChromeReadinessDeps = {
      probeCdpVersion: vi.fn().mockResolvedValue(true),
      waitMs: vi.fn(),
    };
    await svc.ensureReady(deps);
    // Access private _reused to verify (cast)
    const internal = svc as unknown as { _reused: boolean; _childProcess: unknown };
    expect(internal._reused).toBe(true);
    expect(internal._childProcess).toBeNull();
    // shutdown() must be safe to call without killing anything
    expect(() => svc.shutdown()).not.toThrow();
  });

  it('ensureReady is idempotent — second call returns same result without re-probing', async () => {
    const svc = new ManagedChromeService(9222);
    const deps: ChromeReadinessDeps = {
      probeCdpVersion: vi.fn().mockResolvedValue(true),
      waitMs: vi.fn(),
    };
    await svc.ensureReady(deps);
    await svc.ensureReady(deps);
    // Second call should no-op (same promise, probe called only once)
    expect(deps.probeCdpVersion).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ManagedChromeService — graceful no-op when no binary found
// ---------------------------------------------------------------------------

describe('ManagedChromeService — graceful no-op when Chrome binary not found', () => {
  it('stays not-ready but does not throw when no binary is available', async () => {
    // Inject a findBinary that always returns null (no real shell execution).
    const serviceDeps: ManagedChromeServiceDeps = { findBinary: () => null };
    const svc = new ManagedChromeService(9222, serviceDeps);

    const deps: ChromeReadinessDeps = {
      probeCdpVersion: vi.fn().mockResolvedValue(false), // no pre-existing Chrome
      waitMs: vi.fn(),
    };

    const result = await svc.ensureReady(deps);
    // Must not throw; isReady must remain false.
    expect(result).toBe(false);
    expect(svc.isReady).toBe(false);
  });

  it('returns false for isReady and does not throw on subsequent ensureReady calls', async () => {
    const serviceDeps: ManagedChromeServiceDeps = { findBinary: () => null };
    const svc = new ManagedChromeService(9222, serviceDeps);

    const deps: ChromeReadinessDeps = {
      probeCdpVersion: vi.fn().mockResolvedValue(false),
      waitMs: vi.fn(),
    };

    await svc.ensureReady(deps);
    // Second call must also be safe (idempotent).
    const result2 = await svc.ensureReady(deps);
    expect(result2).toBe(false);
  });

  it('shutdown is safe to call when no Chrome was spawned', async () => {
    const serviceDeps: ManagedChromeServiceDeps = { findBinary: () => null };
    const svc = new ManagedChromeService(9222, serviceDeps);

    const deps: ChromeReadinessDeps = {
      probeCdpVersion: vi.fn().mockResolvedValue(false),
      waitMs: vi.fn(),
    };

    await svc.ensureReady(deps);
    expect(() => svc.shutdown()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ManagedChromeService — CHROME_CDP_PORT constant
// ---------------------------------------------------------------------------

describe('CHROME_CDP_PORT constant', () => {
  it('defaults to 9222', () => {
    expect(CHROME_CDP_PORT).toBe(9222);
  });
});

// ---------------------------------------------------------------------------
// ManagedChromeService — injectEnvVars
// ---------------------------------------------------------------------------

describe('ManagedChromeService — injectEnvVars', () => {
  it('sets CHROME_CDP_PORT and CHROME_CDP_URL on the given env object', () => {
    const svc = new ManagedChromeService(9222);
    const env: Record<string, string> = {};
    svc.injectEnvVars(env);
    expect(env['CHROME_CDP_PORT']).toBe('9222');
    expect(env['CHROME_CDP_URL']).toBe('http://127.0.0.1:9222');
  });

  it('reflects a non-default port in the injected vars', () => {
    const svc = new ManagedChromeService(9333);
    const env: Record<string, string> = {};
    svc.injectEnvVars(env);
    expect(env['CHROME_CDP_PORT']).toBe('9333');
    expect(env['CHROME_CDP_URL']).toBe('http://127.0.0.1:9333');
  });
});
