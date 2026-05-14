import { broadcast } from './ws_gateway';
import { opencodeClient } from './opencode_engine';
import { logger } from '../utils/logger';

/**
 * Bridges Opencode SSE events to the existing WebSocket gateway.
 * Subscribes to Opencode's event stream and relays session events
 * (status changes, output) in the format the Flutter client expects.
 */
export class OpencodeStreamBridge {
  private activeStreams = new Map<string, AbortController>();
  private globalEvents: { stream: AsyncIterable<{ type: string; properties?: Record<string, unknown> }> } | null = null;
  private globalAbort: AbortController | null = null;

  /** Start streaming events from an Opencode session through the WS gateway. */
  async streamSession(sessionId: string, _opencodeSessionId: string): Promise<void> {
    // Subscribe to Opencode's global event stream if not yet connected
    if (!this.globalEvents) {
      try {
        const events = await opencodeClient.subscribeToEvents();
        if (!events) {
          console.warn('[OpencodeStreamBridge] No event stream available');
          return;
        }
        this.globalEvents = events;
        this.globalAbort = new AbortController();
        this._listenGlobal(sessionId);
      } catch (err) {
        logger.error('[OpencodeStreamBridge] Failed to subscribe:', err);
      }
    }
  }

  private async _listenGlobal(initialSessionId: string): Promise<void> {
    if (!this.globalEvents) return;
    try {
      for await (const event of this.globalEvents.stream) {
        if (this.globalAbort?.signal.aborted) break;

        // Map Opencode events to our WS message format.
        // Event types are from Opencode's SSE stream — adjust after real testing.
        if (event.type === 'session.status') {
          broadcast({
            type: 'session.status',
            sessionId: initialSessionId,
            working: (event.properties?.working as boolean) ?? false,
          });
        } else if (event.type === 'session.output') {
          broadcast({
            type: 'session.output',
            sessionId: initialSessionId,
            data: String(event.properties?.text ?? ''),
          });
        }
      }
    } catch (err) {
      logger.error('[OpencodeStreamBridge] Global event stream error:', err);
    } finally {
      this.globalAbort = null;
      this.globalEvents = null;
    }
  }

  /** Stop streaming for a session. */
  stopStream(sessionId: string): void {
    this.activeStreams.delete(sessionId);
    // If this was the last active stream, disconnect from Opencode events
    if (this.activeStreams.size === 0) {
      this.globalAbort?.abort();
      this.globalAbort = null;
      this.globalEvents = null;
    }
  }

  /** Clean up all streams. */
  dispose(): void {
    this.globalAbort?.abort();
    this.globalAbort = null;
    this.globalEvents = null;
    this.activeStreams.clear();
  }
}

/** Singleton stream bridge instance. */
export const streamBridge = new OpencodeStreamBridge();
