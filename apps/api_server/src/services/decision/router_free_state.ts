import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sortFreeQueue, type FreeQueueDescriptor } from './router_free_policy';

export interface RouterFreeLimits {
  rpm_limit: number;
  daily_request_limit: number;
  daily_reset_hour_utc: number;
  daily_reset_minute_utc: number;
  breaker_failures: number;
  failure_window_ms: number;
  breaker_open_ms: number;
  retry_delay_ms: number;
  queue_max_entries: number;
}
export interface RouterFreeStateOptions { statePath: string; clock: () => number; config: RouterFreeLimits }
export type FreeFailureCode = '429' | '5xx' | 'empty' | 'error_body' | 'truncated';
export interface FreeLease { id: string; remainingCalls: number }
export type FreeAdmission = { kind: 'lease'; lease: FreeLease }
  | { kind: 'hold'; reason: 'invalid_calls' | 'daily_budget' | 'rpm_budget' };
export type OwnedFreeQueueDescriptor = FreeQueueDescriptor & { ownerUserId: string };
export type FreeRetryDecision = { kind: 'hold'; reason: 'retry_delay'; retryAt: number }
  | { kind: 'retry_same_list' | 'random_fallback' | 'queue' };
interface ModelCircuit { model: string; failures: { at: number; code: FreeFailureCode }[]; openUntil: number }
interface RetryState { id: string; retryAt: number; stage: 0 | 1 | 2 }
interface State {
  version: 1;
  dailyPeriod: number;
  dailyCount: number;
  tokens: number;
  lastRefill: number;
  leases: FreeLease[];
  circuits: ModelCircuit[];
  retries: RetryState[];
  queue: OwnedFreeQueueDescriptor[];
}
const failureCodes: readonly string[] = ['429', '5xx', 'empty', 'error_body', 'truncated'];
const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const count = (n: unknown): n is number => nonnegative(n) && Number.isSafeInteger(n);
const identifier = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 512;

/** Projection is the trust boundary: unknown body fields are never copied. */
function projectDescriptor(value: unknown): OwnedFreeQueueDescriptor | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as OwnedFreeQueueDescriptor;
  const c = d.classification;
  if (!identifier(d.taskId) || !identifier(d.ownerUserId) || !identifier(d.reference) || !nonnegative(d.enqueuedAt)
    || !c || ![1, 2, 3, 4].includes(c.tier) || !['coding', 'knowledge', 'design'].includes(c.category)
    || typeof c.canQueue !== 'boolean' || ![true, false, 'unknown'].includes(c.containsPrivateData)) return null;
  return { taskId: d.taskId, ownerUserId: d.ownerUserId, reference: d.reference, enqueuedAt: d.enqueuedAt,
    classification: { tier: c.tier, category: c.category, canQueue: c.canQueue, containsPrivateData: c.containsPrivateData } };
}

/**
 * ponytail: synchronous single API-process owner, not a distributed lock. Share one
 * instance/path; multiple processes require a transactional DB or file locking.
 * statePath's parent must already exist in an operator-owned directory. Limits
 * and opaque IDs/references come from trusted config/task storage, never task text.
 * Local privacy preflight precedes ALL free calls (including classification).
 * No execution/timers/network: caller must commitAttempt successfully BEFORE EVERY
 * classifier/helper/answer/verifier/retry/probation call, and release unused calls.
 * Commit is the attempted-call boundary (including provider failure); cancellation
 * BEFORE that boundary only releases. A crash after commit is conservatively counted.
 */
export class RouterFreeStateStore {
  private state: State;
  private readonly config: RouterFreeLimits;
  constructor(private readonly options: RouterFreeStateOptions) {
    this.config = { ...options.config };
    for (const key of ['rpm_limit', 'daily_request_limit', 'breaker_failures', 'failure_window_ms',
      'breaker_open_ms', 'retry_delay_ms', 'queue_max_entries'] as const) {
      if (!count(this.config[key]) || this.config[key] <= 0) throw new Error('invalid_free_limits');
    }
    if (!count(this.config.daily_reset_hour_utc) || this.config.daily_reset_hour_utc > 23
      || !count(this.config.daily_reset_minute_utc) || this.config.daily_reset_minute_utc > 59
      || !identifier(options.statePath)) throw new Error('invalid_free_limits');
    const now = this.now();
    this.state = existsSync(options.statePath) ? this.read() : {
      version: 1, dailyPeriod: this.period(now), dailyCount: 0, tokens: this.config.rpm_limit,
      lastRefill: now, leases: [], circuits: [], retries: [], queue: [],
    };
    this.transaction(() => undefined);
  }

  private now(): number {
    const now = this.options.clock();
    if (!nonnegative(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('invalid_free_clock');
    return now;
  }
  private period(now: number): number {
    const d = new Date(now);
    const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      this.config.daily_reset_hour_utc, this.config.daily_reset_minute_utc);
    return now < reset ? reset - 86_400_000 : reset;
  }
  private reserved(): number { return this.state.leases.reduce((sum, l) => sum + l.remainingCalls, 0); }
  private refresh(now: number): void {
    const period = this.period(now);
    // Clock rollback cannot reset quota twice or mint tokens.
    if (period > this.state.dailyPeriod) { this.state.dailyPeriod = period; this.state.dailyCount = 0; }
    this.state.tokens = Math.min(this.config.rpm_limit,
      this.state.tokens + Math.max(0, now - this.state.lastRefill) * this.config.rpm_limit / 60_000);
    this.state.lastRefill = Math.max(now, this.state.lastRefill);
  }
  private read(): State {
    const s = JSON.parse(readFileSync(this.options.statePath, 'utf8')) as State;
    if (!s || s.version !== 1 || !nonnegative(s.dailyPeriod) || !count(s.dailyCount)
      || !nonnegative(s.tokens) || !nonnegative(s.lastRefill)
      || !Array.isArray(s.leases) || !Array.isArray(s.circuits) || !Array.isArray(s.retries) || !Array.isArray(s.queue)
      || s.leases.some(l => !l || !identifier(l.id) || !count(l.remainingCalls))
      || new Set(s.leases.map(l => l.id)).size !== s.leases.length
      || s.circuits.some(c => !c || !identifier(c.model) || !nonnegative(c.openUntil) || !Array.isArray(c.failures)
        || c.failures.some(f => !f || !nonnegative(f.at) || !failureCodes.includes(f.code)))
      || new Set(s.circuits.map(c => c.model)).size !== s.circuits.length
      || s.retries.some(r => !r || !identifier(r.id) || !nonnegative(r.retryAt) || ![0, 1, 2].includes(r.stage))
      || new Set(s.retries.map(r => r.id)).size !== s.retries.length
      || s.queue.some(d => !projectDescriptor(d))) throw new Error('invalid_free_state');
    // Project disk reads as well; never perpetuate injected extra fields.
    return { version: 1, dailyPeriod: s.dailyPeriod, dailyCount: s.dailyCount, tokens: s.tokens, lastRefill: s.lastRefill,
      leases: s.leases.map(l => ({ id: l.id, remainingCalls: l.remainingCalls })),
      circuits: s.circuits.map(c => ({ model: c.model, openUntil: c.openUntil,
        failures: c.failures.map(f => ({ at: f.at, code: f.code })) })),
      retries: s.retries.map(r => ({ id: r.id, retryAt: r.retryAt, stage: r.stage })),
      queue: s.queue.map(d => projectDescriptor(d)!) };
  }
  private persist(): void {
    // Unique same-directory temp, exclusive create, 0600, flush then atomic rename.
    // Failed-write temp evidence is intentionally retained; never unlink/delete.
    const temp = `${this.options.statePath}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(this.state)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temp, this.options.statePath);
  }
  private transaction<T>(operation: (now: number) => T): T {
    // Reload synchronously so sequential same-process re-instantiation cannot overwrite leases.
    if (existsSync(this.options.statePath)) this.state = this.read();
    const before = structuredClone(this.state);
    try {
      const now = this.now();
      this.refresh(now);
      const result = operation(now);
      this.persist();
      return result;
    } catch (error) { this.state = before; throw error; } // Never return a permit after failed persistence.
  }
  private reserve(requiredCalls: number): FreeAdmission {
    const held = this.reserved();
    if (this.config.daily_request_limit - this.state.dailyCount - held < requiredCalls) return { kind: 'hold', reason: 'daily_budget' };
    if (this.state.tokens - held < requiredCalls) return { kind: 'hold', reason: 'rpm_budget' };
    const lease = { id: randomUUID(), remainingCalls: requiredCalls };
    this.state.leases.push(lease);
    return { kind: 'lease', lease: { ...lease } };
  }
  tryReserve(requiredCalls: number): FreeAdmission {
    if (!count(requiredCalls) || requiredCalls <= 0) return { kind: 'hold', reason: 'invalid_calls' };
    return this.transaction(() => this.reserve(requiredCalls));
  }
  commitAttempt(leaseId: string): boolean {
    return this.transaction(() => {
      const lease = this.state.leases.find(l => l.id === leaseId);
      if (!lease || lease.remainingCalls <= 0 || this.state.tokens < 1
        || this.state.dailyCount >= this.config.daily_request_limit) return false;
      lease.remainingCalls--;
      this.state.tokens--;
      this.state.dailyCount++;
      return true;
    });
  }
  release(leaseId: string): number {
    return this.transaction(() => {
      const lease = this.state.leases.find(l => l.id === leaseId);
      if (!lease) return 0;
      this.state.leases = this.state.leases.filter(l => l.id !== leaseId);
      return lease.remainingCalls;
    });
  }
  usage(): { dailyCount: number; reservedCalls: number; availableTokens: number; dailyRemaining: number } {
    return this.transaction(() => ({ dailyCount: this.state.dailyCount, reservedCalls: this.reserved(),
      availableTokens: Math.max(0, this.state.tokens - this.reserved()),
      dailyRemaining: Math.max(0, this.config.daily_request_limit - this.state.dailyCount - this.reserved()) }));
  }
  recordFailure(model: string, code: FreeFailureCode): boolean {
    if (!identifier(model) || !failureCodes.includes(code)) return false;
    return this.transaction(now => {
      let circuit = this.state.circuits.find(c => c.model === model);
      if (!circuit) { circuit = { model, failures: [], openUntil: 0 }; this.state.circuits.push(circuit); }
      circuit.failures = circuit.failures.filter(f => f.at > now - this.config.failure_window_ms);
      circuit.failures.push({ at: now, code });
      if (circuit.failures.length >= this.config.breaker_failures && circuit.openUntil <= now)
        circuit.openUntil = now + this.config.breaker_open_ms;
      return true;
    });
  }
  reportSuccess(model: string): void {
    this.transaction(() => {
      const circuit = this.state.circuits.find(c => c.model === model);
      // Success clears sliding failures ONLY: an already-open breaker keeps its original deadline.
      if (circuit) circuit.failures = [];
    });
  }
  openCircuits(): ReadonlySet<string> {
    return this.transaction(now => new Set(this.state.circuits.filter(c => c.openUntil > now).map(c => c.model)));
  }
  /** Call after exhausting the ordered list; decisions are NOT call permits. No timers. */
  nextRetry(requestId: string): FreeRetryDecision {
    if (!identifier(requestId)) throw new Error('invalid_free_request_id');
    return this.transaction(now => {
      let retry = this.state.retries.find(r => r.id === requestId);
      if (!retry) { retry = { id: requestId, retryAt: now + this.config.retry_delay_ms, stage: 0 }; this.state.retries.push(retry); }
      if (retry.stage === 0) {
        if (now < retry.retryAt) return { kind: 'hold', reason: 'retry_delay', retryAt: retry.retryAt };
        retry.stage = 1;
        return { kind: 'retry_same_list' };
      }
      if (retry.stage === 1) { retry.stage = 2; return { kind: 'random_fallback' }; }
      return { kind: 'queue' };
    });
  }
  enqueue(value: unknown): { kind: 'queued' } | { kind: 'hold'; reason: 'invalid_descriptor' | 'queue_full' | 'already_queued' } {
    const descriptor = projectDescriptor(value);
    if (!descriptor) return { kind: 'hold', reason: 'invalid_descriptor' };
    return this.transaction(() => {
      if (this.state.queue.some(d => d.taskId === descriptor.taskId && d.ownerUserId === descriptor.ownerUserId))
        return { kind: 'hold', reason: 'already_queued' };
      if (this.state.queue.length >= this.config.queue_max_entries) return { kind: 'hold', reason: 'queue_full' };
      this.state.queue.push(descriptor);
      return { kind: 'queued' };
    });
  }
  /** Remove one descriptor for paid redispatch/release; reserves NO free calls. */
  take(taskId: string, ownerUserId: string): OwnedFreeQueueDescriptor | null {
    return this.transaction(() => {
      const found = this.state.queue.find(d => d.taskId === taskId && d.ownerUserId === ownerUserId) ?? null;
      if (found) this.state.queue = this.state.queue.filter(d => d !== found);
      return found;
    });
  }
  queue(): OwnedFreeQueueDescriptor[] {
    return this.transaction(() => sortFreeQueue(this.state.queue) as OwnedFreeQueueDescriptor[]);
  }
  /** Atomic descriptor dequeue + bundle reservation; NEVER executes or authorizes the task. */
  dequeue(requiredCalls: number): { kind: 'dequeued'; descriptor: OwnedFreeQueueDescriptor; lease: FreeLease }
    | Exclude<FreeAdmission, { kind: 'lease' }> | { kind: 'hold'; reason: 'queue_empty' } {
    if (!count(requiredCalls) || requiredCalls <= 0) return { kind: 'hold', reason: 'invalid_calls' };
    return this.transaction(() => {
      const descriptor = sortFreeQueue(this.state.queue)[0] as OwnedFreeQueueDescriptor | undefined;
      if (!descriptor) return { kind: 'hold', reason: 'queue_empty' };
      const admission = this.reserve(requiredCalls);
      if (admission.kind === 'hold') return admission;
      this.state.queue = this.state.queue.filter(d => !(d.taskId === descriptor.taskId && d.ownerUserId === descriptor.ownerUserId));
      return { kind: 'dequeued', descriptor, lease: admission.lease };
    });
  }
}
