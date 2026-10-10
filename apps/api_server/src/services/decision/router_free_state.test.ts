import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Synthetic evidence is retained: no afterEach/rm/unlink cleanup.
let moduleUnderTest: any;
beforeAll(async () => { moduleUnderTest = await import('./router_free_state').catch(() => null); });
const limits = { rpm_limit: 4, daily_request_limit: 8, daily_reset_hour_utc: 5, daily_reset_minute_utc: 30,
  breaker_failures: 3, failure_window_ms: 600_000, breaker_open_ms: 900_000, retry_delay_ms: 60_000, queue_max_entries: 3 };
function fixture(overrides = {}) {
  expect(moduleUnderTest, 'state store must exist').not.toBeNull();
  let now = Date.UTC(2026, 9, 8, 6);
  const dir = mkdtempSync(join(tmpdir(), 'router-free-state-'));
  const statePath = join(dir, 'state.json');
  const options = { statePath, clock: () => now, config: { ...limits, ...overrides } };
  return { store: new moduleUnderTest.RouterFreeStateStore(options), reopen: () => new moduleUnderTest.RouterFreeStateStore(options),
    advance: (ms: number) => { now += ms; }, statePath, dir };
}
const descriptor = (taskId: string, tier = 2, enqueuedAt = 1) => ({ taskId, ownerUserId: 'owner', reference: `task-ref-${taskId}`, enqueuedAt,
  classification: { tier, category: 'coding', canQueue: true, containsPrivateData: false } });
function reserve(store: any, calls: number) {
  const result = store.tryReserve(calls);
  expect(result.kind).toBe('lease');
  return result.lease;
}

describe('Free state executable acceptance contracts', () => {
  it('s01 concurrent bundles cannot oversubscribe classifier/helper/answer/verifier', async () => {
    const { store } = fixture();
    const results = await Promise.all([0, 1].map(() => Promise.resolve().then(() => store.tryReserve(4))));
    expect(results.map(r => r.kind)).toEqual(['lease', 'hold']);
    expect(results[1].reason).toBe('rpm_budget');
    expect(results[0].lease.remainingCalls).toBe(4);
  });
  it('s02 committed attempts count, cancellations release only unused allowance', () => {
    const { store, reopen } = fixture();
    const lease = reserve(store, 4);
    expect(store.commitAttempt(lease.id)).toBe(true);
    expect(store.commitAttempt(lease.id)).toBe(true);
    expect(store.release(lease.id)).toBe(2);
    expect(store.release(lease.id)).toBe(0);
    expect(store.commitAttempt(lease.id)).toBe(false);
    expect(reopen().usage()).toMatchObject({ dailyCount: 2, reservedCalls: 0, availableTokens: 2 });
  });
  it('s03 persistent active reservations hold daily allowance across requests and restart', () => {
    const { store, reopen, advance } = fixture({ daily_request_limit: 4 });
    const lease = reserve(store, 4);
    advance(60_000);
    expect(reopen().tryReserve(1)).toEqual({ kind: 'hold', reason: 'daily_budget' });
    expect(store.release(lease.id)).toBe(4);
    expect(store.usage().dailyCount).toBe(0);
    expect(store.tryReserve(4).kind).toBe('lease');
  });
  it('s04 token refill respects held permits; committing after refill still consumes the held token', () => {
    const { store, advance } = fixture();
    const lease = reserve(store, 4);
    advance(60_000);
    expect(store.tryReserve(1)).toEqual({ kind: 'hold', reason: 'rpm_budget' });
    expect(store.commitAttempt(lease.id)).toBe(true);
    expect(store.release(lease.id)).toBe(3);
    expect(store.usage().availableTokens).toBe(3);
    advance(15_000);
    expect(store.usage().availableTokens).toBe(4);
  });
  it('s05 daily reset uses configured UTC 05:30, preserves active leases and next read', () => {
    const { store, advance, reopen } = fixture({ daily_request_limit: 4 });
    const lease = reserve(store, 4);
    store.commitAttempt(lease.id);
    advance(23 * 3_600_000 + 29 * 60_000);
    expect(store.usage().dailyCount).toBe(1);
    advance(60_000);
    expect(store.usage()).toMatchObject({ dailyCount: 0, reservedCalls: 3 });
    expect(reopen().usage()).toMatchObject({ dailyCount: 0, reservedCalls: 3 });
    store.commitAttempt(lease.id);
    expect(reopen().usage().dailyCount).toBe(1);
  });
  it('s06 invalid config and malformed reservations fail closed without mutation', () => {
    for (const overrides of [{ rpm_limit: 0 }, { daily_reset_hour_utc: 24 }, { daily_reset_minute_utc: 60 }, { retry_delay_ms: NaN }])
      expect(() => fixture(overrides)).toThrow();
    const { store, statePath } = fixture();
    const before = readFileSync(statePath, 'utf8');
    for (const n of [0, -1, 1.5, NaN, Infinity]) expect(store.tryReserve(n)).toEqual({ kind: 'hold', reason: 'invalid_calls' });
    expect(readFileSync(statePath, 'utf8')).toBe(before);
  });
  it('s07 rolling three failures opens for configured duration; success cannot shorten active breaker', () => {
    const { store, advance, reopen } = fixture();
    store.recordFailure('model', '429');
    advance(600_000);
    store.recordFailure('model', '5xx');
    store.recordFailure('model', 'empty');
    expect(store.openCircuits().has('model')).toBe(false); // first failure expired at exact boundary
    store.recordFailure('model', 'truncated');
    expect(reopen().openCircuits().has('model')).toBe(true);
    store.reportSuccess('model');
    expect(store.openCircuits().has('model')).toBe(true);
    advance(900_000);
    expect(store.openCircuits().has('model')).toBe(false);
    store.recordFailure('model', 'empty');
    expect(store.openCircuits().has('model')).toBe(false);
  });
  it.each(['429', '5xx', 'empty', 'error_body', 'truncated'])('s08 failure %s is code-only; cancellation excluded', code => {
    const { store, statePath } = fixture({ breaker_failures: 1 });
    expect(store.recordFailure('model', 'cancelled')).toBe(false);
    expect(store.recordFailure('model', 'provider body PASSWORD_MARKER')).toBe(false);
    expect(store.recordFailure('model', code)).toBe(true);
    expect(store.openCircuits().has('model')).toBe(true);
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).toContain(code);
    expect(raw).not.toContain('PASSWORD_MARKER');
    expect(raw).not.toContain('cancelled');
  });
  it('s09 success clears sliding failures before breaker threshold', () => {
    const { store } = fixture();
    store.recordFailure('model', 'empty'); store.recordFailure('model', 'error_body');
    store.reportSuccess('model'); store.recordFailure('model', 'truncated');
    expect(store.openCircuits().size).toBe(0);
  });
  it('s10 retry waits exactly 60s, same-list once, random once, then queue, persisting transitions', () => {
    const { store, advance, reopen } = fixture();
    expect(store.nextRetry('request')).toEqual({ kind: 'hold', reason: 'retry_delay', retryAt: Date.UTC(2026, 9, 8, 6, 1) });
    advance(59_999);
    expect(store.nextRetry('request').kind).toBe('hold');
    advance(1);
    expect(store.nextRetry('request')).toEqual({ kind: 'retry_same_list' });
    const resumed = reopen();
    expect(resumed.nextRetry('request')).toEqual({ kind: 'random_fallback' });
    expect(resumed.nextRetry('request')).toEqual({ kind: 'queue' });
    expect(resumed.nextRetry('request')).toEqual({ kind: 'queue' });
  });
  it('s11 queue persists projection, T1 then age; dequeue returns descriptor and reserved lease only', () => {
    const { store, reopen, statePath } = fixture();
    const injected = { ...descriptor('older', 2, 1), prompt: 'PROMPT_MARKER', password: 'PASSWORD_MARKER',
      classification: { ...descriptor('x').classification, taskText: 'PROMPT_MARKER' } };
    expect(store.enqueue(injected)).toEqual({ kind: 'queued' });
    store.enqueue(descriptor('t1-new', 1, 3)); store.enqueue(descriptor('t1-old', 1, 2));
    const resumed = reopen();
    expect(resumed.queue().map((d: any) => d.taskId)).toEqual(['t1-old', 't1-new', 'older']);
    expect(Object.keys(resumed.queue()[0]).sort()).toEqual(['classification', 'enqueuedAt', 'ownerUserId', 'reference', 'taskId']);
    const result = resumed.dequeue(4);
    expect(result.kind).toBe('dequeued');
    expect(result.descriptor).toEqual(descriptor('t1-old', 1, 2));
    expect(result.lease.remainingCalls).toBe(4);
    expect(resumed.dequeue(1)).toEqual({ kind: 'hold', reason: 'rpm_budget' });
    expect(reopen().queue().map((d: any) => d.taskId)).toEqual(['t1-new', 'older']);
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).not.toContain('PROMPT_MARKER'); expect(raw).not.toContain('PASSWORD_MARKER');
  });
  it('s12 missing owner/malformed descriptor rejected; overflow explicitly holds without dropping oldest', () => {
    const { store, reopen } = fixture({ queue_max_entries: 1 });
    expect(store.enqueue({ ...descriptor('bad'), ownerUserId: '' })).toEqual({ kind: 'hold', reason: 'invalid_descriptor' });
    expect(store.enqueue({ ...descriptor('bad'), classification: { tier: 9 } })).toEqual({ kind: 'hold', reason: 'invalid_descriptor' });
    expect(store.enqueue(descriptor('first'))).toEqual({ kind: 'queued' });
    expect(store.enqueue(descriptor('second'))).toEqual({ kind: 'hold', reason: 'queue_full' });
    expect(reopen().queue().map((d: any) => d.taskId)).toEqual(['first']);
  });
  it('s13 writes are owner-only atomic state; retained directory evidence has no deleted cleanup', () => {
    const { store, statePath, dir } = fixture();
    const lease = reserve(store, 1); store.commitAttempt(lease.id);
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toContain('state.json');
    expect(JSON.parse(readFileSync(statePath, 'utf8')).dailyCount).toBe(1);
  });
});
