import { realpathSync } from 'node:fs';
import path from 'node:path';
import { registerCanonicalMutationSink, type CanonicalMemoryMutation } from './memory_canonical_mutation';

export interface RefreshAdmission { requestMemoryRefresh(input: CanonicalMemoryMutation): boolean; }

/**
 * Retains canonical dirty intent until the current manager owner admits it.
 * Admission is not completion: the manager scheduler exclusively owns refresh
 * revisions, retry budget, and acknowledgement.
 */
export class EngraphMemoryRefreshBridge {
  private readonly pending = new Map<string, { serial: number; memoryDir: string; destructive: boolean }>();
  private serial = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly disposeSink: () => void;

  constructor(
    private readonly manager: RefreshAdmission,
    private readonly options: { retryMs?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {},
  ) {
    this.disposeSink = registerCanonicalMutationSink((mutation) => this.publish(mutation));
  }

  publish(mutation: CanonicalMemoryMutation): void {
    if (this.closed || !path.isAbsolute(mutation.memoryDir)) return;
    const existing = this.pending.get(mutation.memoryDir);
    this.pending.set(mutation.memoryDir, { serial: ++this.serial, memoryDir: mutation.memoryDir, destructive: Boolean(mutation.destructive) || existing?.destructive === true });
    this.drain();
  }

  private drain(): void {
    if (this.pending.size === 0 || this.closed) return;
    for (const pending of [...this.pending.values()]) try {
      // Do not reinterpret a missing/replaced root as a request for another root.
      realpathSync(pending.memoryDir);
      if (this.manager.requestMemoryRefresh({ memoryDir: pending.memoryDir, destructive: pending.destructive })) {
        if (this.pending.get(pending.memoryDir)?.serial === pending.serial) this.pending.delete(pending.memoryDir);
        continue;
      }
    } catch { /* retain current intent for explicit later admission */ }
    if (this.pending.size === 0) this.clearRetry(); else this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.timer || this.closed || this.pending.size === 0) return;
    const set = this.options.setTimer ?? setTimeout;
    this.timer = set(() => { this.timer = undefined; this.drain(); }, Math.max(5_000, this.options.retryMs ?? 5_000));
    this.timer.unref?.();
  }
  private clearRetry(): void {
    if (!this.timer) return;
    (this.options.clearTimer ?? clearTimeout)(this.timer); this.timer = undefined;
  }
  dispose(): void { this.closed = true; this.clearRetry(); this.disposeSink(); this.pending.clear(); }
}
