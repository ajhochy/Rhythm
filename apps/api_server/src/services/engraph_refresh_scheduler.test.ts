import { describe, expect, it, vi } from 'vitest';
import { EngraphRefreshScheduler } from './engraph_refresh_scheduler';

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

describe('EngraphRefreshScheduler', () => {
  it('coalesces a burst into one destructive pass', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<[number, boolean]> = [];
      const scheduler = new EngraphRefreshScheduler({
        performRefresh: async (revision, destructive) => { calls.push([revision, destructive]); },
      });
      for (let i = 0; i < 10; i++) scheduler.request(i === 4);
      await vi.advanceTimersByTimeAsync(250);
      expect(calls).toEqual([[10, true]]);
      expect(scheduler.getStatus()).toMatchObject({ state: 'idle', requestedRevision: 10, appliedRevision: 10 });
    } finally { vi.useRealTimers(); }
  });

  it('uses the maximum delay under sustained writes', async () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const scheduler = new EngraphRefreshScheduler({ performRefresh: async (revision) => { calls.push(revision); } });
      scheduler.request(false);
      for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(240); scheduler.request(false); }
      await vi.advanceTimersByTimeAsync(40);
      expect(calls).toEqual([5]);
    } finally { vi.useRealTimers(); }
  });

  it('acknowledges only the captured revision and follows up after a mid-pass mutation', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const calls: Array<[number, boolean]> = [];
      const scheduler = new EngraphRefreshScheduler({
        performRefresh: async (revision, destructive) => { calls.push([revision, destructive]); if (calls.length === 1) await held; },
      });
      scheduler.request(false);
      await vi.advanceTimersByTimeAsync(250);
      scheduler.request(true);
      release(); await vi.runAllTimersAsync();
      expect(calls).toEqual([[1, false], [2, true]]);
      expect(scheduler.getStatus()).toMatchObject({ appliedRevision: 2, state: 'idle' });
    } finally { vi.useRealTimers(); }
  });

  it('retains intent across bounded retries and allows explicit retry', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const scheduler = new EngraphRefreshScheduler({
        performRefresh: async () => { attempts += 1; throw new Error('fixture failure'); },
      });
      scheduler.request(true);
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(attempts).toBe(3);
      expect(scheduler.getStatus()).toMatchObject({ state: 'error', requestedRevision: 1, appliedRevision: 0, failureAttempts: 3 });
      scheduler.retry();
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(4);
    } finally { vi.useRealTimers(); }
  });

  it('never overlaps refresh callbacks and disposal cancels queued work', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let active = 0; let maximum = 0; let calls = 0;
      const scheduler = new EngraphRefreshScheduler({
        performRefresh: async () => { calls += 1; active += 1; maximum = Math.max(maximum, active); await held; active -= 1; },
      });
      scheduler.request(false); await vi.advanceTimersByTimeAsync(250);
      scheduler.request(false); scheduler.dispose(); release(); await flush();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(1); expect(maximum).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
