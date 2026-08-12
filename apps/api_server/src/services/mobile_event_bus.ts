import { AppError } from '../errors/app_error';

/**
 * In-process fan-out of the engine's consolidated `/global/event` envelopes
 * (#1379b, plan Phase 2).
 *
 * Before this, every mobile device opened its own `/global/event` SSE stream
 * against the engine through `MobileSseProxy` — N phones meant N engine
 * streams, each independently blocking on engine liveness and each re-running
 * a 30s scope pre-check after any engine hiccup. The bridge (OCU-29 #1070)
 * already holds exactly one consolidated subscription for persistence; this
 * bus republishes those same envelopes in-process so phones ride it instead.
 *
 * The published value is the **raw envelope** as the engine sent it
 * (`{ directory, project?, workspace?, payload }`), before any unwrapping,
 * because that is byte-for-byte what `MobileSseProxy` used to parse off the
 * wire — including `server.heartbeat`, which the bridge swallows but which is
 * the phone's keepalive.
 *
 * Delivery is per-subscriber queued and bounded. A slow phone must never
 * exert backpressure on the producer: the bridge's stream also drives SQLite
 * persistence for every session, so blocking it would stall transcript writes
 * system-wide. An over-budget subscriber is failed instead.
 */

export type GlobalEventEnvelope = Record<string, unknown>;

const DEFAULT_MAX_QUEUED = 512;

interface Subscriber {
  queue: GlobalEventEnvelope[];
  maxQueued: number;
  overflowed: boolean;
  ended: boolean;
  wake: (() => void) | null;
}

const subscribers = new Set<Subscriber>();
let producerLive = false;

function wake(subscriber: Subscriber): void {
  const resume = subscriber.wake;
  subscriber.wake = null;
  resume?.();
}

/**
 * Mark whether a consolidated engine stream is currently feeding this bus.
 *
 * `MobileSseProxy` reads this to decide between the fan-out and its legacy
 * direct-to-engine stream, so it must be flipped false the moment the
 * producing stream dies — otherwise phones sit on a silent bus.
 */
export function setGlobalEventProducerLive(live: boolean): void {
  producerLive = live;
  if (live) return;
  for (const subscriber of subscribers) {
    subscriber.ended = true;
    wake(subscriber);
  }
}

export function globalEventProducerLive(): boolean {
  return producerLive;
}

/** Publish one raw engine envelope to every attached subscriber. */
export function publishGlobalEvent(envelope: GlobalEventEnvelope): void {
  for (const subscriber of subscribers) {
    if (subscriber.ended || subscriber.overflowed) continue;
    if (subscriber.queue.length >= subscriber.maxQueued) {
      // Drop the whole backlog: the subscriber is about to be failed and
      // retaining it only holds engine payloads (which carry host paths) in
      // memory for longer than the connection they belong to.
      subscriber.queue.length = 0;
      subscriber.overflowed = true;
    } else {
      subscriber.queue.push(envelope);
    }
    wake(subscriber);
  }
}

export interface GlobalEventSubscription {
  /**
   * Yields envelopes until the producer detaches or `close()` is called.
   * Throws `STREAM_BACKPRESSURE` if this subscriber fell too far behind.
   */
  events: AsyncIterableIterator<GlobalEventEnvelope>;
  close(): void;
}

export function subscribeGlobalEvents(
  options: { maxQueued?: number } = {},
): GlobalEventSubscription {
  const subscriber: Subscriber = {
    queue: [],
    maxQueued: options.maxQueued ?? DEFAULT_MAX_QUEUED,
    overflowed: false,
    ended: false,
    wake: null,
  };
  subscribers.add(subscriber);

  const close = (): void => {
    subscriber.ended = true;
    subscriber.queue.length = 0;
    subscribers.delete(subscriber);
    wake(subscriber);
  };

  async function* iterate(): AsyncIterableIterator<GlobalEventEnvelope> {
    try {
      while (true) {
        if (subscriber.overflowed) {
          throw new AppError(
            503,
            'STREAM_BACKPRESSURE',
            'Mobile event stream client is too slow',
          );
        }
        const next = subscriber.queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (subscriber.ended) return;
        await new Promise<void>((resolve) => {
          subscriber.wake = resolve;
        });
      }
    } finally {
      close();
    }
  }

  return { events: iterate(), close };
}

/** Test-only: drop every subscriber and reset producer state. */
export function resetGlobalEventBus(): void {
  for (const subscriber of subscribers) {
    subscriber.ended = true;
    wake(subscriber);
  }
  subscribers.clear();
  producerLive = false;
}
