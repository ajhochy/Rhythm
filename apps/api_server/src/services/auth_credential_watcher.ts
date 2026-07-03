import { watch as fsWatch, type FSWatcher } from 'fs';
import { readFile as readFileCb } from 'fs';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const readFileAsync = promisify(readFileCb);

/**
 * Issue #856 — reload provider credentials on auth change.
 *
 * Problem: switching Claude accounts (or any provider re-auth) writes fresh
 * credentials to `~/.local/share/opencode/auth.json`, but the long-running
 * opencode engine subprocess keeps the OLD in-memory token — every call
 * 401s until a full app restart. This module watches auth.json and decides
 * when a content change warrants bouncing the engine so it re-reads the file
 * (see `OpencodeClientService.reloadCredentials` / `restoreAuth`).
 *
 * Lowest-risk first cut (per the issue): api_server-side fs.watch + a
 * debounced content/mtime comparison, NOT an in-engine/fork change. The
 * decision logic ({@link decideReload}) is a pure function extracted from the
 * fs binding so it is unit-testable without touching a real filesystem or
 * real timers.
 */

/** A snapshot of the watched file's content at a point in time. */
export interface AuthFileSnapshot {
  /** Raw file content, or `null` when the file does not exist / is unreadable. */
  content: string | null;
  /** `Date.now()` when this snapshot was taken. */
  observedAtMs: number;
}

export interface DecideReloadResult {
  /** True when the manager should bounce the engine for this transition. */
  shouldReload: boolean;
  /** Human-readable reason, useful for logging. */
  reason:
    | 'unchanged'
    | 'first-observation-no-baseline'
    | 'changed'
    | 'debounced';
}

/**
 * Pure decision function: given the PREVIOUS accepted snapshot (the content
 * a prior reload decision was already made against, or `null` before the
 * first observation) and a NEW snapshot, decide whether to bounce the
 * engine.
 *
 * Rules (acceptance criteria for #856):
 *   - Unchanged content → never reload (`unchanged`).
 *   - Changed content, and at least `debounceMs` has elapsed since the last
 *     ACCEPTED reload decision → reload exactly once (`changed`).
 *   - Changed content, but within `debounceMs` of the last accepted
 *     reload → do not reload again yet (`debounced`); the caller should keep
 *     the latest snapshot pending and re-decide on the next fs event (a
 *     rapid double-write during a single credential rotation collapses to
 *     one bounce, not two).
 *   - No previous snapshot at all (first observation since process start) →
 *     do NOT reload. There is nothing stale to recover from on first
 *     observation (the engine has not initialized against any prior content
 *     yet); recording a baseline here also avoids a spurious bounce
 *     immediately on watcher startup.
 *
 * `lastAcceptedReloadAtMs` is `null` until the first accepted reload.
 */
export function decideReload(
  previous: AuthFileSnapshot | null,
  next: AuthFileSnapshot,
  lastAcceptedReloadAtMs: number | null,
  debounceMs: number,
): DecideReloadResult {
  if (previous === null) {
    return { shouldReload: false, reason: 'first-observation-no-baseline' };
  }

  if (previous.content === next.content) {
    return { shouldReload: false, reason: 'unchanged' };
  }

  if (
    lastAcceptedReloadAtMs !== null &&
    next.observedAtMs - lastAcceptedReloadAtMs < debounceMs
  ) {
    return { shouldReload: false, reason: 'debounced' };
  }

  return { shouldReload: true, reason: 'changed' };
}

/** Injectable dependencies for {@link AuthCredentialWatcher} (testable seam). */
export interface AuthCredentialWatcherDeps {
  /** Reads the watched file; resolves `null` when absent/unreadable. */
  readFile: (path: string) => Promise<string | null>;
  /** Starts watching `path`; returns a disposer. Real impl wraps `fs.watch`. */
  watch: (path: string, onEvent: () => void) => { close(): void };
  /** `Date.now()` — injected so tests control time without real timers. */
  now: () => number;
  /** `setTimeout` — injected so tests can flush debounce windows synchronously. */
  setTimer: (fn: () => void, ms: number) => unknown;
  /** `clearTimeout` for the handle returned by `setTimer`. */
  clearTimer: (handle: unknown) => void;
}

const defaultDeps: AuthCredentialWatcherDeps = {
  readFile: async (path) => {
    try {
      return await readFileAsync(path, 'utf8');
    } catch {
      return null;
    }
  },
  watch: (path, onEvent) => {
    let watcher: FSWatcher;
    try {
      watcher = fsWatch(path, { persistent: false }, () => onEvent());
    } catch (err) {
      logger.warn(
        `[AuthCredentialWatcher] fs.watch failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { close: () => {} };
    }
    return { close: () => watcher.close() };
  },
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface AuthCredentialWatcherOptions {
  /** Absolute path to the file to watch (defaults to auth.json's real path). */
  path: string;
  /** Called when {@link decideReload} decides a bounce is warranted. */
  onReload: (reason: string) => void | Promise<void>;
  /** Debounce window in ms — rapid writes within this window collapse to one bounce. Default 500ms. */
  debounceMs?: number;
  /** fs.watch fires multiple events per logical write; settle for this long before re-reading. Default 150ms. */
  settleMs?: number;
}

/**
 * Watches a credentials file and bounces the engine (via `onReload`) on a
 * genuine content change, debounced against rapid double-writes. Exposes
 * {@link start} / {@link stop} for lifecycle management from server.ts, and
 * keeps its fs/timer bindings behind {@link AuthCredentialWatcherDeps} so the
 * decision path can be driven deterministically in tests without touching a
 * real file or waiting on real timers.
 */
export class AuthCredentialWatcher {
  private readonly deps: AuthCredentialWatcherDeps;
  private readonly path: string;
  private readonly onReload: (reason: string) => void | Promise<void>;
  private readonly debounceMs: number;
  private readonly settleMs: number;

  private lastSnapshot: AuthFileSnapshot | null = null;
  private lastAcceptedReloadAtMs: number | null = null;
  private settleTimer: unknown = null;
  private watcher: { close(): void } | null = null;
  /** Serializes overlapping fs events so re-entrant reads can't race. */
  private processing = false;
  private pendingRecheck = false;

  constructor(
    options: AuthCredentialWatcherOptions,
    deps: AuthCredentialWatcherDeps = defaultDeps,
  ) {
    this.path = options.path;
    this.onReload = options.onReload;
    this.debounceMs = options.debounceMs ?? 500;
    this.settleMs = options.settleMs ?? 150;
    this.deps = deps;
  }

  /** Begin watching. Establishes the initial baseline snapshot (no reload fired for it). */
  async start(): Promise<void> {
    const content = await this.deps.readFile(this.path);
    this.lastSnapshot = { content, observedAtMs: this.deps.now() };
    this.watcher = this.deps.watch(this.path, () => this.scheduleRecheck());
    logger.info(`[AuthCredentialWatcher] watching ${this.path}`);
  }

  stop(): void {
    if (this.settleTimer !== null) {
      this.deps.clearTimer(this.settleTimer);
      this.settleTimer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }

  /**
   * Debounces the flurry of fs.watch events a single logical write can emit
   * (rename + change, or several change events) into one settled re-check.
   */
  private scheduleRecheck(): void {
    if (this.settleTimer !== null) {
      this.deps.clearTimer(this.settleTimer);
    }
    this.settleTimer = this.deps.setTimer(() => {
      this.settleTimer = null;
      void this.recheck();
    }, this.settleMs);
  }

  /** Exposed for tests that want to drive a recheck without a real timer. */
  async recheck(): Promise<DecideReloadResult> {
    if (this.processing) {
      this.pendingRecheck = true;
      return { shouldReload: false, reason: 'debounced' };
    }
    this.processing = true;
    try {
      const content = await this.deps.readFile(this.path);
      const next: AuthFileSnapshot = { content, observedAtMs: this.deps.now() };
      const decision = decideReload(
        this.lastSnapshot,
        next,
        this.lastAcceptedReloadAtMs,
        this.debounceMs,
      );

      // The new snapshot becomes the baseline for the NEXT comparison
      // regardless of the decision, so an unchanged/no-op recheck doesn't
      // re-fire on the same content, and a debounced change is compared
      // against its own (already-seen) content next time, not the stale one.
      this.lastSnapshot = next;

      if (decision.shouldReload) {
        this.lastAcceptedReloadAtMs = next.observedAtMs;
        logger.info(
          `[AuthCredentialWatcher] ${this.path} changed — bouncing engine to reload credentials`,
        );
        await this.onReload(decision.reason);
      }
      return decision;
    } finally {
      this.processing = false;
      if (this.pendingRecheck) {
        this.pendingRecheck = false;
        await this.recheck();
      }
    }
  }
}
