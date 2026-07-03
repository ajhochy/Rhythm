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
