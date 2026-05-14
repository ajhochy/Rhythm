import { broadcast } from './ws_gateway';
import { opencodeClient } from './opencode_engine';
import { logger } from '../utils/logger';

/**
 * Bridges Opencode SSE events to the existing WebSocket gateway.
 *
 * When a local session is created, the bridge starts listening to Opencode's
 * global event stream and relays session-relevant events to the WS gateway
 * in the format the Flutter client expects.
 *
 * Event types (from Opencode's SSE stream, mapped to WS messages):
 *   Opencode → WS gateway
 *   session.status     → session.status { sessionId, working }
 *   session.idle       → session.status { sessionId, working: false }
 *   session.error      → session.error  { sessionId, message }
 *   session.output     → output          { id, data }
 */
export class OpencodeStreamBridge {
  private globalEvents: {
    stream: AsyncIterable<{ type: string; properties?: Record<string, unknown> }>;
  } | null = null;
  private globalAbort: AbortController | null = null;
  private subscriptionCount = 0;

  /** Start streaming events for a given local session. */
  async streamSession(
    localSessionId: string,
    _opencodeSessionId: string,
  ): Promise<void> {
    this.subscriptionCount++;

    // Subscribe to the global event stream on first call
    if (!this.globalEvents) {
      try {
        const events = await opencodeClient.subscribeToEvents();
        if (!events) {
          console.warn('[OpencodeStreamBridge] No event stream available');
          return;
        }
        this.globalEvents = events;
        this.globalAbort = new AbortController();
        this._listen(localSessionId);
      } catch (err) {
        logger.error('[OpencodeStreamBridge] Failed to subscribe:', err);
      }
    }
  }

  private async _listen(initialSessionId: string): Promise<void> {
    if (!this.globalEvents) return;
    try {
      for await (const event of this.globalEvents.stream) {
        if (this.globalAbort?.signal.aborted) break;
        this._relayEvent(event, initialSessionId);
      }
    } catch (err) {
      logger.error('[OpencodeStreamBridge] Event stream error:', err);
    } finally {
      this.globalAbort = null;
      this.globalEvents = null;
    }
  }

  private _relayEvent(
    event: { type: string; properties?: Record<string, unknown> },
    sessionId: string,
  ): void {
    // Drain event — always forward to Flutter
    broadcast({
      v: 1,
      type: 'event',
      id: sessionId,
      eventType: event.type,
      properties: event.properties ?? {},
    });

    // Also map known event types to Flutter's expected WS formats
    switch (event.type) {
      case 'session.status':
        broadcast({
          v: 1,
          type: 'session.status',
          id: sessionId,
          working: (event.properties?.working as boolean) ?? false,
        });
        break;
      case 'session.idle':
        broadcast({
          v: 1,
          type: 'session.status',
          id: sessionId,
          working: false,
        });
        break;
      case 'session.error':
        broadcast({
          v: 1,
          type: 'error',
          id: sessionId,
          message: String(event.properties?.message ?? 'Unknown error'),
        });
        break;
    }
  }

  /** Stop streaming for a session. */
  stopStream(_sessionId: string): void {
    this.subscriptionCount = Math.max(0, this.subscriptionCount - 1);
    if (this.subscriptionCount === 0) {
      this._disconnect();
    }
  }

  /** Clean up all streams. */
  dispose(): void {
    this._disconnect();
  }

  private _disconnect(): void {
    this.globalAbort?.abort();
    this.globalAbort = null;
    this.globalEvents = null;
  }
}

/** Singleton stream bridge instance. */
export const streamBridge = new OpencodeStreamBridge();
