/**
 * #1379 Phase 2 — in-process fan-out of the consolidated `/global/event`
 * stream.
 *
 * Before this, every paired phone opened its OWN engine SSE connection
 * (`MobileSseProxy` → `http://127.0.0.1:4096/global/event`), so N phones meant
 * N engine streams, each blocking on engine liveness. The api_server was
 * already consuming that exact stream once, in `OpencodeStreamBridge`, and
 * persisting every frame to SQLite — but its only fan-out was
 * `ws_gateway.broadcast()`, which writes desktop-shaped `{v:1,…}` frames to the
 * loopback `/ws/agents` client set. Mobile speaks the engine's own event shape
 * and arrives over Tailscale, so it received none of those frames.
 *
 * This hub is the missing fan-out, placed at the layer where the frames are
 * still engine-shaped: the bridge republishes each `/global/event` envelope
 * here *after* its own persistence pass, and mobile subscribers read from the
 * hub instead of dialing the engine. `broadcast()` keeps serving the desktop
 * DTO unchanged — deliberately, because reshaping it for mobile would move the
 * phone off the fingerprint-pinned engine event contract.
 *
 * Subscribers get a bounded queue. A subscriber that cannot keep up overflows
 * rather than growing the api_server's heap; the overflow surfaces as the same
 * `STREAM_BACKPRESSURE` condition the per-device proxy already reported.
 */

/** The wire shape of one `/global/event` frame. */
export interface GlobalEventEnvelope {
  directory?: string;
  payload?: unknown;
}

const DEFAULT_MAX_QUEUE = 512;

export interface HubSubscription {
  /** Yields envelopes until `close()` is called. */
  stream: AsyncIterable<GlobalEventEnvelope>;
  /** Number of envelopes dropped because the queue was full. */
  overflowed(): boolean;
  close(): void;
}

class Subscriber {
  private readonly queue: GlobalEventEnvelope[] = [];
  private wake: (() => void) | null = null;
  private overflow = false;
  private closed = false;

  constructor(private readonly maxQueue: number) {}

  push(envelope: GlobalEventEnvelope): void {
    if (this.closed) return;
    if (this.queue.length >= this.maxQueue) {
      this.overflow = true;
      this.close();
      return;
    }
    this.queue.push(envelope);
    this.wake?.();
  }

  overflowed(): boolean {
    return this.overflow;
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *drain(): AsyncGenerator<GlobalEventEnvelope> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = () => {
          this.wake = null;
          resolve();
        };
      });
    }
  }
}

class OpencodeEventHub {
  private readonly subscribers = new Set<Subscriber>();
  private live = false;

  /**
   * True once the bridge has an established `/global/event` subscription.
   * Callers use this to decide whether the hub can serve them; when it cannot
   * (legacy per-directory mode, an engine binary without `/global/event`, or a
   * subscribe failure) they must keep their own transport.
   *
   * Checked synchronously on purpose. The consolidated stream is started by
   * `server.ts` on engine-ready and by `streamSession`, so a device connect
   * must never pay an engine round-trip just to find out where to read from.
   */
  isLive(): boolean {
    return this.live;
  }

  setLive(value: boolean): void {
    this.live = value;
  }

  subscribe(maxQueue = DEFAULT_MAX_QUEUE): HubSubscription {
    const subscriber = new Subscriber(maxQueue);
    this.subscribers.add(subscriber);
    return {
      stream: subscriber.drain(),
      overflowed: () => subscriber.overflowed(),
      close: () => {
        this.subscribers.delete(subscriber);
        subscriber.close();
      },
    };
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Fan one envelope out. Never throws — a bad subscriber cannot stall the bridge. */
  publish(envelope: GlobalEventEnvelope): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber.push(envelope);
      } catch {
        // A subscriber that cannot accept a frame is dropped by its own
        // overflow path; nothing here may propagate into the bridge loop.
      }
    }
  }
}

export const opencodeEventHub = new OpencodeEventHub();
