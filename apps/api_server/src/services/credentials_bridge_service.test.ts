/**
 * Issue #856 (reopened, second attempt) — change-gated Keychain poll.
 *
 * Root cause of the first reopen fix's failure: the current `claude` CLI
 * stores credentials in the macOS Keychain ONLY — a `claude logout`/`login`
 * never rewrites `~/.claude/.credentials.json`, so file-watching that path
 * essentially never fires on a real re-auth. The Keychain itself cannot be
 * `fs.watch`ed, so instead `CredentialsBridgeService.startKeychainPoll` polls
 * the CURRENT refresh-token fingerprint on an interval and only re-bridges
 * when it actually changed.
 *
 * These tests inject the cred-reader, the bridge call, and the
 * setInterval/clearInterval bindings so the poll is fully deterministic and
 * hermetic — no real Keychain, no real timers, no real engine.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/services/credentials_bridge_service.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CredentialsBridgeService,
  refreshTokenFingerprint,
  type ClaudeCreds,
  type BridgeResult,
} from './credentials_bridge_service';
import type { OpencodeClientService } from './opencode_client_service';

describe('refreshTokenFingerprint', () => {
  it('is deterministic for the same input', () => {
    expect(refreshTokenFingerprint('refresh-abc')).toBe(
      refreshTokenFingerprint('refresh-abc'),
    );
  });

  it('differs for different refresh tokens', () => {
    expect(refreshTokenFingerprint('refresh-abc')).not.toBe(
      refreshTokenFingerprint('refresh-xyz'),
    );
  });

  it('never returns the raw token itself (one-way hash)', () => {
    const raw = 'super-secret-refresh-token';
    expect(refreshTokenFingerprint(raw)).not.toContain(raw);
  });
});

/** Builds injectable poll deps with a manually-triggerable tick, no real timers. */
function makePollHarness() {
  let intervalFn: (() => void) | null = null;
  const clearSpy = vi.fn();
  const setIntervalSpy = vi.fn((fn: () => void, _ms: number) => {
    intervalFn = fn;
    return { unref: vi.fn() };
  });
  const clearIntervalSpy = vi.fn((handle: unknown) => {
    clearSpy(handle);
  });

  return {
    setInterval: setIntervalSpy,
    clearInterval: clearIntervalSpy,
    /** Manually fires the registered interval callback (simulates one tick). */
    tick: async () => {
      intervalFn?.();
      // Flush the microtask queue so the poll's internal async tick() settles.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function creds(refresh: string, overrides: Partial<ClaudeCreds> = {}): ClaudeCreds {
  return {
    access: 'access-token',
    refresh,
    expires: Date.now() + 60 * 60 * 1000,
    ...overrides,
  };
}

const fakeClient = { isReady: true } as unknown as OpencodeClientService;

describe('CredentialsBridgeService.startKeychainPoll', () => {
  it('fingerprint UNCHANGED across ticks → bridge NOT called', async () => {
    const bridge = vi.fn(
      async (): Promise<BridgeResult> => ({ success: true, provider: 'anthropic' }),
    );
    const readCreds = vi.fn(() => creds('refresh-SAME'));
    const service = new CredentialsBridgeService();
    const harness = makePollHarness();

    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds,
      bridge,
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });

    // First tick observes a refresh token for the first time (no prior
    // baseline) — this IS a change relative to `null`, so it bridges once.
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(1);

    // Subsequent ticks see the SAME refresh token — no further bridge calls.
    await harness.tick();
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(1);

    service.stopKeychainPoll();
  });

  it('fingerprint CHANGED (re-auth) → bridgeAnthropic(force:true) called exactly once, then settles', async () => {
    let currentRefresh = 'refresh-OLD';
    const bridge = vi.fn(
      async (): Promise<BridgeResult> => ({ success: true, provider: 'anthropic' }),
    );
    const readCreds = vi.fn(() => creds(currentRefresh));
    const service = new CredentialsBridgeService();
    const harness = makePollHarness();

    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds,
      bridge,
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });

    // Establish the initial baseline.
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(service.getLastBridgedRefreshFingerprint()).toBe(
      refreshTokenFingerprint('refresh-OLD'),
    );

    // Simulate a genuine re-auth: refresh token changes.
    currentRefresh = 'refresh-NEW';
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(bridge).toHaveBeenLastCalledWith(fakeClient);
    expect(service.getLastBridgedRefreshFingerprint()).toBe(
      refreshTokenFingerprint('refresh-NEW'),
    );

    // A subsequent UNCHANGED tick (still refresh-NEW) does nothing further.
    await harness.tick();
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(2);

    service.stopKeychainPoll();
  });

  it('transient read failure (reader returns null) → bridge NOT called, no exception escapes, next good tick re-bridges', async () => {
    let shouldFail = false;
    let currentRefresh = 'refresh-A';
    const bridge = vi.fn(
      async (): Promise<BridgeResult> => ({ success: true, provider: 'anthropic' }),
    );
    const readCreds = vi.fn(() => (shouldFail ? null : creds(currentRefresh)));
    const service = new CredentialsBridgeService();
    const harness = makePollHarness();

    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds,
      bridge,
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });

    // Establish baseline.
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(1);

    // Simulate the split-second keychain_denied window during a logout→login
    // transition: reader returns null.
    shouldFail = true;
    await expect(harness.tick()).resolves.not.toThrow();
    expect(bridge).toHaveBeenCalledTimes(1); // still just the baseline call
    // The already-bridged fingerprint must be untouched by the failed tick.
    expect(service.getLastBridgedRefreshFingerprint()).toBe(
      refreshTokenFingerprint('refresh-A'),
    );

    // Next tick reads fine again (same token) — no spurious re-bridge either.
    shouldFail = false;
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(1);

    // A later tick with a genuinely NEW token after the flaky window
    // re-bridges normally.
    currentRefresh = 'refresh-B';
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(service.getLastBridgedRefreshFingerprint()).toBe(
      refreshTokenFingerprint('refresh-B'),
    );

    service.stopKeychainPoll();
  });

  it('transient read failure (reader throws keychain_denied) → bridge NOT called, no exception escapes', async () => {
    let shouldThrow = false;
    const bridge = vi.fn(
      async (): Promise<BridgeResult> => ({ success: true, provider: 'anthropic' }),
    );
    const readCreds = vi.fn(() => {
      if (shouldThrow) throw new Error('keychain_denied');
      return creds('refresh-X');
    });
    const service = new CredentialsBridgeService();
    const harness = makePollHarness();

    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds,
      bridge,
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });

    shouldThrow = true;
    await expect(harness.tick()).resolves.not.toThrow();
    expect(bridge).not.toHaveBeenCalled();
    expect(service.getLastBridgedRefreshFingerprint()).toBeNull();

    // Self-heals: a later good tick bridges normally.
    shouldThrow = false;
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(1);

    service.stopKeychainPoll();
  });

  it('a failed bridge call (bridgeAnthropic returns success:false) does not update the fingerprint, so the next tick retries', async () => {
    let attempt = 0;
    const bridge = vi.fn(async (): Promise<BridgeResult> => {
      attempt += 1;
      if (attempt === 1) return { success: false, reason: 'sdk_not_ready' };
      return { success: true, provider: 'anthropic' };
    });
    const readCreds = vi.fn(() => creds('refresh-RETRY'));
    const service = new CredentialsBridgeService();
    const harness = makePollHarness();

    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds,
      bridge,
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });

    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(service.getLastBridgedRefreshFingerprint()).toBeNull(); // failed bridge, no baseline set

    // Next tick sees the SAME unchanged refresh token but retries the bridge
    // because the previous attempt never succeeded (no baseline recorded).
    await harness.tick();
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(service.getLastBridgedRefreshFingerprint()).toBe(
      refreshTokenFingerprint('refresh-RETRY'),
    );

    service.stopKeychainPoll();
  });

  it('is idempotent: calling startKeychainPoll twice does not register a second interval', () => {
    const service = new CredentialsBridgeService();
    const harness = makePollHarness();
    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds: () => null,
      bridge: async () => ({ success: true, provider: 'anthropic' }),
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });
    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds: () => null,
      bridge: async () => ({ success: true, provider: 'anthropic' }),
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });
    expect(harness.setInterval).toHaveBeenCalledTimes(1);
    service.stopKeychainPoll();
  });

  it('stopKeychainPoll clears the interval via the injected clearInterval', () => {
    const service = new CredentialsBridgeService();
    const harness = makePollHarness();
    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds: () => null,
      bridge: async () => ({ success: true, provider: 'anthropic' }),
      setInterval: harness.setInterval,
      clearInterval: harness.clearInterval,
    });
    service.stopKeychainPoll();
    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
  });

  it('unrefs the interval handle so it never keeps the process alive', () => {
    const service = new CredentialsBridgeService();
    const unrefSpy = vi.fn();
    const setIntervalSpy = vi.fn(() => ({ unref: unrefSpy }));
    service.startKeychainPoll(fakeClient, 60_000, {
      readCreds: () => null,
      bridge: async () => ({ success: true, provider: 'anthropic' }),
      setInterval: setIntervalSpy,
      clearInterval: vi.fn(),
    });
    expect(unrefSpy).toHaveBeenCalledTimes(1);
    service.stopKeychainPoll();
  });
});
