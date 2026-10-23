export type EngraphRefreshState = 'idle' | 'queued' | 'refreshing' | 'error';

export interface EngraphRefreshStatus {
  state: EngraphRefreshState;
  requestedRevision: number;
  appliedRevision: number;
  lastDestructiveRevision: number;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
  failureAttempts: number;
}

export interface EngraphRefreshSchedulerOptions {
  performRefresh: (targetRevision: number, destructive: boolean) => Promise<void>;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  debounceMs?: number;
  maxDelayMs?: number;
  retryDelaysMs?: readonly number[];
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1_000;
const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000] as const;

/**
 * Coalesces canonical-memory mutations into serialized refresh passes. It is
 * deliberately pure coordination: the manager owns root validation and all
 * process lifecycle work supplied through `performRefresh`.
 */
export class EngraphRefreshScheduler {
  private readonly performRefresh: EngraphRefreshSchedulerOptions['performRefresh'];
  private readonly now: () => number;
  private readonly setTimer: NonNullable<EngraphRefreshSchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<EngraphRefreshSchedulerOptions['clearTimer']>;
  private readonly debounceMs: number;
  private readonly maxDelayMs: number;
  private readonly retryDelaysMs: readonly number[];
  private requestedRevision = 0;
  private appliedRevision = 0;
  private lastDestructiveRevision = 0;
  private firstPendingAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Retry/yield deadlines cannot be shortened by ordinary new writes. */
  private protectedNotBefore: number | null = null;
  private active: Promise<void> | null = null;
  private disposed = false;
  private paused = false;
  private failureAttempts = 0;
  private nextRetryAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private state: EngraphRefreshState = 'idle';
  private consecutivePasses = 0;

  constructor(options: EngraphRefreshSchedulerOptions) {
    this.performRefresh = options.performRefresh;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  request(destructive: boolean): number {
    if (this.disposed) return this.requestedRevision;
    this.requestedRevision += 1;
    if (destructive) this.lastDestructiveRevision = this.requestedRevision;
    if (this.firstPendingAt === null) this.firstPendingAt = this.now();
    const protectedPending = this.protectedNotBefore !== null && this.now() < this.protectedNotBefore;
    if (!this.paused && !this.active && !protectedPending && this.failureAttempts < this.maxAttempts()) {
      this.scheduleDebounced();
    }
    return this.requestedRevision;
  }

  retry(): void {
    if (this.disposed || this.paused || this.requestedRevision <= this.appliedRevision) return;
    this.failureAttempts = 0;
    this.nextRetryAt = null;
    this.protectedNotBefore = null;
    this.schedule(0, true);
  }

  dispose(): void {
    this.disposed = true;
    this.clearScheduled();
    this.nextRetryAt = null;
    this.protectedNotBefore = null;
    this.state = 'idle';
  }

  pause(): void {
    this.paused = true;
    this.clearScheduled();
    this.nextRetryAt = null;
    this.protectedNotBefore = null;
    if (this.requestedRevision > this.appliedRevision) this.state = 'queued';
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    if (!this.active && this.requestedRevision > this.appliedRevision) this.schedule(0, true);
  }

  getStatus(): EngraphRefreshStatus {
    return {
      state: this.state,
      requestedRevision: this.requestedRevision,
      appliedRevision: this.appliedRevision,
      lastDestructiveRevision: this.lastDestructiveRevision,
      lastSuccessAt: this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt).toISOString(),
      nextRetryAt: this.nextRetryAt === null ? null : new Date(this.nextRetryAt).toISOString(),
      failureAttempts: this.failureAttempts,
    };
  }

  private maxAttempts(): number { return this.retryDelaysMs.length + 1; }

  private clearScheduled(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private scheduleDebounced(): void {
    const now = this.now();
    const first = this.firstPendingAt ?? now;
    const delay = Math.max(0, Math.min(now + this.debounceMs, first + this.maxDelayMs) - now);
    this.schedule(delay, true);
  }

  private schedule(delayMs: number, replace = false): void {
    if (this.disposed || this.paused || this.active || this.requestedRevision <= this.appliedRevision) return;
    if (this.timer !== null && !replace) return;
    if (this.timer !== null) this.clearScheduled();
    this.state = 'queued';
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.run().catch(() => undefined);
    }, delayMs);
    // Node timers should not keep the desktop process alive solely to refresh.
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  private async run(): Promise<void> {
    if (this.disposed || this.paused || this.active || this.requestedRevision <= this.appliedRevision) return;
    const targetRevision = this.requestedRevision;
    const destructive = this.lastDestructiveRevision > this.appliedRevision &&
      this.lastDestructiveRevision <= targetRevision;
    this.state = 'refreshing';
    let run!: Promise<void>;
    // Defer user work by one microtask so `active` is published before a
    // synchronously throwing or reentrant callback can observe scheduler state.
    run = Promise.resolve().then(async () => {
      try {
        if (this.protectedNotBefore !== null && this.now() >= this.protectedNotBefore) {
          this.protectedNotBefore = null;
        }
        await this.performRefresh(targetRevision, destructive);
        if (this.disposed) return;
        this.appliedRevision = Math.max(this.appliedRevision, targetRevision);
        this.failureAttempts = 0;
        this.nextRetryAt = null;
        this.protectedNotBefore = null;
        this.lastSuccessAt = this.now();
        this.consecutivePasses += 1;
      } catch {
        if (this.disposed) return;
        this.failureAttempts += 1;
        this.consecutivePasses = 0;
        if (this.failureAttempts < this.maxAttempts()) {
          const delay = this.retryDelaysMs[this.failureAttempts - 1] ?? 0;
          this.nextRetryAt = this.now() + delay;
          this.protectedNotBefore = this.nextRetryAt;
        }
      } finally {
        // `run` is the sole serialized worker; clear before scheduling any
        // follow-up so a settled promise can never suppress pending work.
        this.active = null;
        if (this.disposed) return;
        if (this.requestedRevision > this.appliedRevision) {
          if (this.failureAttempts >= this.maxAttempts()) {
            this.state = 'error';
            this.nextRetryAt = null;
            this.protectedNotBefore = null;
          } else if (this.failureAttempts > 0) {
            this.state = 'queued';
            this.schedule(Math.max(0, (this.nextRetryAt ?? this.now()) - this.now()));
          } else if (this.consecutivePasses >= 2) {
            this.consecutivePasses = 0;
            this.firstPendingAt = this.now();
            this.protectedNotBefore = this.now() + 5_000;
            this.schedule(5_000);
          } else {
            this.firstPendingAt = this.now();
            this.schedule(0);
          }
        } else {
          this.firstPendingAt = null;
          this.protectedNotBefore = null;
          this.state = 'idle';
          this.consecutivePasses = 0;
        }
      }
    });
    this.active = run;
    await run;
  }
}
