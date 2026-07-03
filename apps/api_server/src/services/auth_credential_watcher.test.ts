/**
 * Issue #856 — reload provider credentials on auth change.
 *
 * Acceptance criteria under test:
 *   - After auth.json changes, the manager decides to bounce the engine
 *     exactly once: unchanged → no bounce; changed → one bounce; rapid
 *     double-write → debounced to one bounce.
 *   - No regression to the normal unchanged-creds path.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/services/auth_credential_watcher.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decideReload,
  authIdentityFingerprint,
  AuthCredentialWatcher,
  type AuthCredentialWatcherDeps,
  type AuthFileSnapshot,
} from './auth_credential_watcher';

describe('decideReload (pure decision logic, #856)', () => {
  it('no previous snapshot (first observation) → does not reload; establishes a baseline', () => {
    const next: AuthFileSnapshot = { content: 'v1', observedAtMs: 1000 };
    const result = decideReload(null, next, null, 500);
    expect(result).toEqual({
      shouldReload: false,
      reason: 'first-observation-no-baseline',
    });
  });

  it('unchanged content → no bounce', () => {
    const prev: AuthFileSnapshot = { content: 'v1', observedAtMs: 1000 };
    const next: AuthFileSnapshot = { content: 'v1', observedAtMs: 2000 };
    const result = decideReload(prev, next, null, 500);
    expect(result).toEqual({ shouldReload: false, reason: 'unchanged' });
  });

  it('changed content, no prior accepted reload → exactly one bounce', () => {
    const prev: AuthFileSnapshot = { content: 'v1', observedAtMs: 1000 };
    const next: AuthFileSnapshot = { content: 'v2', observedAtMs: 2000 };
    const result = decideReload(prev, next, null, 500);
    expect(result).toEqual({ shouldReload: true, reason: 'changed' });
  });

  it('changed content, outside the debounce window since last accepted reload → bounces again', () => {
    const prev: AuthFileSnapshot = { content: 'v2', observedAtMs: 2000 };
    const next: AuthFileSnapshot = { content: 'v3', observedAtMs: 3000 };
    const lastAcceptedReloadAtMs = 2000;
    const result = decideReload(prev, next, lastAcceptedReloadAtMs, 500);
    expect(result).toEqual({ shouldReload: true, reason: 'changed' });
  });

  it('rapid double-write within the debounce window → debounced (no second bounce)', () => {
    const prev: AuthFileSnapshot = { content: 'v2', observedAtMs: 2000 };
    const next: AuthFileSnapshot = { content: 'v3', observedAtMs: 2100 }; // 100ms later
    const lastAcceptedReloadAtMs = 2000; // a reload was just accepted at t=2000
    const result = decideReload(prev, next, lastAcceptedReloadAtMs, 500);
    expect(result).toEqual({ shouldReload: false, reason: 'debounced' });
  });

  it('content reverting back to a previously-seen value still counts as changed relative to the immediate previous snapshot', () => {
    // Guards against a "smart" implementation that tries to dedupe against
    // full history instead of the immediate previous snapshot — scope is
    // deliberately the simple prev-vs-next comparison the issue asks for.
    const prev: AuthFileSnapshot = { content: 'v2', observedAtMs: 5000 };
    const next: AuthFileSnapshot = { content: 'v1', observedAtMs: 6000 };
    const result = decideReload(prev, next, null, 500);
    expect(result).toEqual({ shouldReload: true, reason: 'changed' });
  });
});

describe('authIdentityFingerprint — access-token rotation must not bounce (#856 smoke fix)', () => {
  const oauth = (access: string, refresh: string, expires: number) =>
    JSON.stringify({
      anthropic: { type: 'oauth', access, refresh, expires },
      openrouter: { type: 'api', key: 'sk-fixed' },
    });

  it('routine access-token refresh (same refresh token, new access/expires) → identical fingerprint → NO bounce', () => {
    // This is the exact spurious case from manual smoke: the running engine
    // refreshes its own access token and rewrites auth.json.
    const before = oauth('access-OLD', 'refresh-SAME', 1000);
    const after = oauth('access-NEW', 'refresh-SAME', 9999);
    expect(authIdentityFingerprint(before)).toBe(authIdentityFingerprint(after));
    const result = decideReload(
      { content: before, observedAtMs: 1000 },
      { content: after, observedAtMs: 2000 },
      null,
      500,
    );
    expect(result).toEqual({ shouldReload: false, reason: 'unchanged' });
  });

  it('account switch (refresh token changes) → different fingerprint → bounce', () => {
    const before = oauth('access-x', 'refresh-ACCOUNT-A', 1000);
    const after = oauth('access-y', 'refresh-ACCOUNT-B', 2000);
    expect(authIdentityFingerprint(before)).not.toBe(
      authIdentityFingerprint(after),
    );
    const result = decideReload(
      { content: before, observedAtMs: 1000 },
      { content: after, observedAtMs: 2000 },
      null,
      500,
    );
    expect(result).toEqual({ shouldReload: true, reason: 'changed' });
  });

  it('api-key change → bounce', () => {
    const before = JSON.stringify({ openrouter: { type: 'api', key: 'sk-1' } });
    const after = JSON.stringify({ openrouter: { type: 'api', key: 'sk-2' } });
    const result = decideReload(
      { content: before, observedAtMs: 1000 },
      { content: after, observedAtMs: 2000 },
      null,
      500,
    );
    expect(result).toEqual({ shouldReload: true, reason: 'changed' });
  });

  it('provider key reordering alone → same fingerprint (no bounce)', () => {
    const a = JSON.stringify({ anthropic: { type: 'oauth', refresh: 'r' }, openai: { type: 'oauth', refresh: 's' } });
    const b = JSON.stringify({ openai: { type: 'oauth', refresh: 's' }, anthropic: { type: 'oauth', refresh: 'r' } });
    expect(authIdentityFingerprint(a)).toBe(authIdentityFingerprint(b));
  });

  it('non-JSON content falls back to raw comparison (never silently misses a change)', () => {
    expect(authIdentityFingerprint('garbage-1')).not.toBe(
      authIdentityFingerprint('garbage-2'),
    );
  });
});

describe('authIdentityFingerprint — ~/.claude/.credentials.json shape (#856 reopen)', () => {
  // Real shape observed on disk: { claudeAiOauth: { accessToken, refreshToken,
  // expiresAt, ... } } — NOT the flat provider-keyed shape opencode's
  // auth.json uses. This is the file `claude` itself writes on re-auth.
  const claudeCreds = (accessToken: string, refreshToken: string, expiresAt: number) =>
    JSON.stringify({
      claudeAiOauth: {
        accessToken,
        refreshToken,
        expiresAt,
        scopes: ['user:inference'],
        subscriptionType: 'max',
      },
    });

  it('routine access-token refresh (same refresh token, new access/expiresAt) → identical fingerprint → NO reload', () => {
    const before = claudeCreds('access-OLD', 'refresh-SAME', 1000);
    const after = claudeCreds('access-NEW', 'refresh-SAME', 9999);
    expect(authIdentityFingerprint(before)).toBe(authIdentityFingerprint(after));
    const result = decideReload(
      { content: before, observedAtMs: 1000 },
      { content: after, observedAtMs: 2000 },
      null,
      500,
    );
    expect(result).toEqual({ shouldReload: false, reason: 'unchanged' });
  });

  it('claude re-auth (refresh token changes) → different fingerprint → reload', () => {
    const before = claudeCreds('access-x', 'refresh-ACCOUNT-A', 1000);
    const after = claudeCreds('access-y', 'refresh-ACCOUNT-B', 2000);
    expect(authIdentityFingerprint(before)).not.toBe(
      authIdentityFingerprint(after),
    );
    const result = decideReload(
      { content: before, observedAtMs: 1000 },
      { content: after, observedAtMs: 2000 },
      null,
      500,
    );
    expect(result).toEqual({ shouldReload: true, reason: 'changed' });
  });

  it('going from absent (no file) to present on first observation does not reload (baseline only)', () => {
    const after = claudeCreds('access-x', 'refresh-1', 1000);
    const result = decideReload(null, { content: after, observedAtMs: 1000 }, null, 500);
    expect(result).toEqual({
      shouldReload: false,
      reason: 'first-observation-no-baseline',
    });
  });
});

function makeDeps(
  overrides: Partial<AuthCredentialWatcherDeps> = {},
): AuthCredentialWatcherDeps & {
  fireWatchEvent: () => void;
  flushTimers: () => void;
} {
  let currentTime = 0;
  let fileContent: string | null = 'initial';
  let watchCallback: (() => void) | null = null;
  const timers: Array<{ id: number; fn: () => void; dueAt: number }> = [];
  let nextTimerId = 1;

  const deps: AuthCredentialWatcherDeps = {
    readFile: vi.fn(async () => fileContent),
    watch: vi.fn((_path, onEvent) => {
      watchCallback = onEvent;
      return { close: vi.fn() };
    }),
    now: vi.fn(() => currentTime),
    setTimer: vi.fn((fn, ms) => {
      const id = nextTimerId++;
      timers.push({ id, fn, dueAt: currentTime + ms });
      return id;
    }),
    clearTimer: vi.fn((handle) => {
      const idx = timers.findIndex((t) => t.id === handle);
      if (idx >= 0) timers.splice(idx, 1);
    }),
    ...overrides,
  };

  return {
    ...deps,
    // Test helpers exposed alongside the deps object.
    fireWatchEvent: () => watchCallback?.(),
    flushTimers: () => {
      // Run all currently-scheduled timers in due-time order (single pass —
      // sufficient for these tests, which schedule at most one at a time).
      const due = [...timers].sort((a, b) => a.dueAt - b.dueAt);
      for (const t of due) {
        const idx = timers.indexOf(t);
        if (idx >= 0) timers.splice(idx, 1);
        t.fn();
      }
    },
    __setContent: (c: string | null) => {
      fileContent = c;
    },
    __setTime: (t: number) => {
      currentTime = t;
    },
  } as AuthCredentialWatcherDeps & {
    fireWatchEvent: () => void;
    flushTimers: () => void;
    __setContent: (c: string | null) => void;
    __setTime: (t: number) => void;
  };
}

describe('AuthCredentialWatcher (integration of decision logic + fs/timer seams, #856)', () => {
  it('unchanged creds path: no bounce fires after start(), and none fires on a no-op fs event', async () => {
    const deps = makeDeps();
    const onReload = vi.fn();
    const watcher = new AuthCredentialWatcher(
      { path: '/fake/auth.json', onReload },
      deps,
    );

    await watcher.start();
    expect(onReload).not.toHaveBeenCalled();

    // fs.watch fires (e.g. an unrelated metadata touch) but content is identical.
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();

    expect(onReload).not.toHaveBeenCalled();
  });

  it('a single real content change → bounces exactly once', async () => {
    const deps = makeDeps();
    const onReload = vi.fn();
    const watcher = new AuthCredentialWatcher(
      { path: '/fake/auth.json', onReload },
      deps,
    );

    await watcher.start(); // baseline = 'initial'

    (deps as unknown as { __setContent: (c: string) => void }).__setContent(
      'rotated-token',
    );
    (deps as unknown as { __setTime: (t: number) => void }).__setTime(1000);
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledWith('changed');
  });

  it('a rapid double-write (two fs events for one logical rotation) debounces to exactly one bounce', async () => {
    const deps = makeDeps();
    const onReload = vi.fn();
    const watcher = new AuthCredentialWatcher(
      { path: '/fake/auth.json', onReload, debounceMs: 500, settleMs: 150 },
      deps,
    );

    await watcher.start(); // baseline = 'initial'

    const setContent = (deps as unknown as { __setContent: (c: string) => void })
      .__setContent;
    const setTime = (deps as unknown as { __setTime: (t: number) => void }).__setTime;

    // First write of the rotation.
    setContent('token-v2-partial');
    setTime(1000);
    deps.fireWatchEvent();
    deps.flushTimers(); // settle timer fires → recheck reads 'token-v2-partial'
    await Promise.resolve();
    await Promise.resolve();

    // Second write lands 50ms later (well inside the 500ms debounce window)
    // — simulates an editor/process writing the file in two syscalls.
    setContent('token-v2-final');
    setTime(1050);
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('two content changes far apart (outside the debounce window) → two separate bounces', async () => {
    const deps = makeDeps();
    const onReload = vi.fn();
    const watcher = new AuthCredentialWatcher(
      { path: '/fake/auth.json', onReload, debounceMs: 500, settleMs: 150 },
      deps,
    );

    await watcher.start();

    const setContent = (deps as unknown as { __setContent: (c: string) => void })
      .__setContent;
    const setTime = (deps as unknown as { __setTime: (t: number) => void }).__setTime;

    setContent('token-v2');
    setTime(1000);
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();
    await Promise.resolve();

    // A second, genuinely separate account switch a full 10s later.
    setContent('token-v3');
    setTime(11000);
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(onReload).toHaveBeenCalledTimes(2);
  });

  it('stop() closes the underlying watcher', async () => {
    const closeSpy = vi.fn();
    const deps = makeDeps({
      watch: vi.fn(() => ({ close: closeSpy })),
    });
    const watcher = new AuthCredentialWatcher(
      { path: '/fake/auth.json', onReload: vi.fn() },
      deps,
    );
    await watcher.start();
    watcher.stop();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Claude credentials watcher wiring (#856 reopen) — onReload must force re-bridge, not just bounce', () => {
  // This mirrors server.ts's wiring for the NEW ~/.claude/.credentials.json
  // watcher: unlike the auth.json watcher (whose onReload calls
  // opencodeClient.reloadCredentials(), which only re-reads the — still
  // stale — auth.json), this watcher's onReload must call
  // credentialsBridge.bridgeAnthropic(client, { force: true }) so the
  // freshly-re-authed Keychain/file token is actually pushed into the live
  // engine. A bare bounce alone would NOT fix #856 because reloadCredentials
  // never re-invokes bridgeAnthropic (confirmed: bridgeAnthropic is not
  // referenced anywhere in opencode_client_service.ts).
  it('a genuine claude re-auth (refresh token change) triggers a FORCED bridgeAnthropic call', async () => {
    const bridgeSpy = vi.fn().mockResolvedValue({ success: true, provider: 'anthropic' });
    const fakeClient = { isReady: true } as unknown as Parameters<
      typeof bridgeSpy
    >[0];

    const deps = makeDeps();
    (deps as unknown as { __setContent: (c: string) => void }).__setContent(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'a1', refreshToken: 'r-OLD', expiresAt: 1000 },
      }),
    );

    const watcher = new AuthCredentialWatcher(
      {
        path: '/fake/.claude/.credentials.json',
        // Exact wiring shape used in server.ts's onReload for this watcher.
        onReload: async () => {
          await bridgeSpy(fakeClient, { force: true });
        },
      },
      deps,
    );

    await watcher.start(); // baseline = refresh r-OLD

    // Simulate `claude` re-auth: new refresh token written to the file.
    (deps as unknown as { __setContent: (c: string) => void }).__setContent(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'a2', refreshToken: 'r-NEW', expiresAt: 2000 },
      }),
    );
    (deps as unknown as { __setTime: (t: number) => void }).__setTime(1000);
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(bridgeSpy).toHaveBeenCalledTimes(1);
    expect(bridgeSpy).toHaveBeenCalledWith(fakeClient, { force: true });
  });

  it('a routine access-token rotation on the SAME refresh token does NOT trigger a re-bridge', async () => {
    const bridgeSpy = vi.fn().mockResolvedValue({ success: true, provider: 'anthropic' });
    const fakeClient = {} as unknown as Parameters<typeof bridgeSpy>[0];

    const deps = makeDeps();
    (deps as unknown as { __setContent: (c: string) => void }).__setContent(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'a1', refreshToken: 'r-SAME', expiresAt: 1000 },
      }),
    );

    const watcher = new AuthCredentialWatcher(
      {
        path: '/fake/.claude/.credentials.json',
        onReload: async () => {
          await bridgeSpy(fakeClient, { force: true });
        },
      },
      deps,
    );

    await watcher.start();

    // Same refresh token, only access/expiresAt rotate (a routine refresh).
    (deps as unknown as { __setContent: (c: string) => void }).__setContent(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'a2', refreshToken: 'r-SAME', expiresAt: 9999 },
      }),
    );
    (deps as unknown as { __setTime: (t: number) => void }).__setTime(1000);
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(bridgeSpy).not.toHaveBeenCalled();
  });

  it('using the REAL CredentialsBridgeService.bridgeAnthropic as the onReload target is invoked with force:true', async () => {
    // Imports the real service (not a hand-rolled fake) to guard against the
    // wiring silently drifting from the actual bridge signature.
    const { CredentialsBridgeService } = await import('./credentials_bridge_service');
    const bridge = new CredentialsBridgeService();
    const spy = vi
      .spyOn(bridge, 'bridgeAnthropic')
      .mockResolvedValue({ success: true, provider: 'anthropic' });
    const fakeClient = { isReady: true } as unknown as Parameters<
      typeof bridge.bridgeAnthropic
    >[0];

    const deps = makeDeps();
    (deps as unknown as { __setContent: (c: string) => void }).__setContent(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'a1', refreshToken: 'r-OLD', expiresAt: 1000 },
      }),
    );

    const watcher = new AuthCredentialWatcher(
      {
        path: '/fake/.claude/.credentials.json',
        onReload: async () => {
          await bridge.bridgeAnthropic(fakeClient, { force: true });
        },
      },
      deps,
    );

    await watcher.start();

    (deps as unknown as { __setContent: (c: string) => void }).__setContent(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'a2', refreshToken: 'r-NEW', expiresAt: 2000 },
      }),
    );
    (deps as unknown as { __setTime: (t: number) => void }).__setTime(1000);
    deps.fireWatchEvent();
    deps.flushTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(fakeClient, { force: true });
  });
});
