import { broadcast } from './ws_gateway';
import { opencodeClient } from './opencode_engine';
import { opencodeSessionMap } from './opencode_engine';
import { logger } from '../utils/logger';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

/**
 * Bridges Opencode SSE events to the existing WebSocket gateway.
 *
 * The bridge subscribes to the Opencode event stream once (on first session)
 * and relays events to the WS gateway in the format the Flutter client expects.
 *
 * Real Opencode event types (from the SDK's SSE stream → WS messages):
 *   message.part.updated  → output       { id, data }        (text delta)
 *   message.updated       → output.flush { id, parts }       (final message)
 *   session.status        → session.status { id, working }   (busy/idle)
 *   session.idle          → session.status { id, working: false }
 *   session.error         → error         { id, message }
 *   file.edited           → event         { type, file }
 *
 * Session ID routing: Opencode events carry `properties.sessionID` (SDK session ID).
 * The bridge uses opencodeSessionMap to look up the local session ID for each event.
 */
type DirectoryStream = {
  eventStream: AsyncIterable<import('@opencode-ai/sdk').Event>;
  abort: AbortController;
};

export class OpencodeStreamBridge {
  // One SSE subscription per directory, because opencode's /event endpoint
  // filters by ?directory= — sessions whose cwd is outside the subscribed
  // directory never produce events on that stream. The same process may
  // host sessions across different cwds, so we track multiple streams.
  private streamsByDirectory = new Map<string, DirectoryStream>();
  private sessionsRepo = new AgentSessionsRepository();
  private messagesRepo = new AgentSessionMessagesRepository();

  // Accumulate assistant text deltas keyed by local session id. The SDK
  // streams text via `message.part.delta` events; the message body itself
  // arrives empty. We append on session.idle (end of turn) to keep the
  // agent_session_messages history populated.
  private pendingText = new Map<string, string>();

  /**
   * Start streaming events for a given local session.
   * Subscribes (idempotently) to the opencode /event SSE for the session's
   * cwd. Multiple sessions in the same directory share a single subscriber.
   */
  async streamSession(
    localSessionId: string,
    _opencodeSessionId: string,
    cwd: string,
  ): Promise<void> {
    const directory = cwd && cwd.length > 0 ? cwd : '/';
    if (this.streamsByDirectory.has(directory)) return;

    try {
      const events = await opencodeClient.subscribeToEvents(directory);
      if (!events) {
        logger.error(
          `[OpencodeStreamBridge] No event stream available for directory=${directory}`,
        );
        return;
      }
      const abort = new AbortController();
      this.streamsByDirectory.set(directory, {
        eventStream: events.stream,
        abort,
      });
      // Fire-and-forget listener loop. Failures inside the loop unset the
      // entry so a subsequent session in the same directory can re-subscribe.
      this._listen(directory).catch((err) =>
        logger.error('[OpencodeStreamBridge] listener crashed:', err),
      );
      logger.info(
        `[OpencodeStreamBridge] Subscribed to events for directory=${directory} (session=${localSessionId})`,
      );
    } catch (err) {
      logger.error(
        `[OpencodeStreamBridge] Failed to subscribe to ${directory}:`,
        err,
      );
    }
  }

  private async _listen(directory: string): Promise<void> {
    const entry = this.streamsByDirectory.get(directory);
    if (!entry) return;
    try {
      for await (const event of entry.eventStream) {
        if (entry.abort.signal.aborted) break;
        this._relayEvent(event);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      logger.error(
        `[OpencodeStreamBridge] Event stream error for ${directory}:`,
        err,
      );
    } finally {
      this.streamsByDirectory.delete(directory);
    }
  }

  private _relayEvent(
    event: import('@opencode-ai/sdk').Event,
  ): void {
    // Extract the Opencode session ID — different event types nest it
    // differently:
    //   session.*           → properties.sessionID
    //   message.updated     → properties.info.sessionID
    //   message.part.updated→ properties.part.sessionID
    //   message.removed     → properties.sessionID
    const props = (event.properties ?? {}) as Record<string, unknown>;
    const propsInfo = props.info as Record<string, unknown> | undefined;
    const propsPart = props.part as Record<string, unknown> | undefined;
    const opencodeSessionId = (props.sessionID ??
      propsInfo?.sessionID ??
      propsPart?.sessionID) as string | undefined;

    // Look up the local session ID from the opencodeSessionMap.
    // Map is opencodeSessionId → localSessionId, so we need to reverse look up.
    let localSessionId: string | undefined;
    if (opencodeSessionId) {
      for (const [localId, sdkId] of opencodeSessionMap.entries()) {
        if (sdkId === opencodeSessionId) {
          localSessionId = localId;
          break;
        }
      }
    }

    // If no session mapping found, use the event's sessionID as a fallback key
    const eventId = localSessionId ?? opencodeSessionId;
    if (!eventId) {
      // Events without a session ID (e.g. file.edited) are still broadcast
      // with the event type so Flutter can handle them globally if needed
      broadcast({
        v: 1,
        type: 'event',
        eventType: event.type,
        properties: event.properties ?? {},
      });
      return;
    }

    // Map Opencode event types to Flutter's expected WS message format
    switch (event.type) {
      case 'message.part.updated': {
        // The 'delta' property here is incremental streaming text for the
        // current assistant part — broadcast for UI live update, but DO NOT
        // accumulate (we'd double-count vs message.part.delta). The
        // part.text field carries the user's echoed prompt for user parts,
        // so we deliberately ignore it for persistence.
        const delta = props?.delta as string | undefined;
        if (delta) {
          broadcast({
            v: 1,
            type: 'output',
            id: eventId,
            data: delta,
          });
        }
        break;
      }

      case 'message.part.delta': {
        // Streaming text delta during an assistant turn. This is the
        // canonical source of assistant text — accumulate for persistence.
        const delta = props?.delta as string | undefined;
        const field = props?.field as string | undefined;
        if (delta && field === 'text' && localSessionId) {
          this.pendingText.set(
            localSessionId,
            (this.pendingText.get(localSessionId) ?? '') + delta,
          );
          broadcast({
            v: 1,
            type: 'output',
            id: eventId,
            data: delta,
          });
        }
        break;
      }

      case 'message.updated': {
        // Final message — flush remaining output. Persistence happens on
        // session.idle so we have the complete assistant turn assembled.
        broadcast({
          v: 1,
          type: 'output.flush',
          id: eventId,
          properties: event.properties ?? {},
        });
        break;
      }

      case 'session.status': {
        // status.type tells us busy/idle
        const statusProps = event.properties as Record<string, unknown>;
        const status = statusProps?.status as { type: string } | undefined;
        if (status) {
          broadcast({
            v: 1,
            type: 'session.status',
            id: eventId,
            working: status.type === 'busy',
            status: status.type,
          });
          // Persist to DB so the agents list badge moves off "Starting".
          if (localSessionId) {
            try {
              const dbStatus = status.type === 'busy' ? 'working' : 'idle';
              this.sessionsRepo.updateStatus(localSessionId, dbStatus);
            } catch (err) {
              logger.error(
                '[OpencodeStreamBridge] Failed to update session status:',
                err,
              );
            }
          }
        }
        break;
      }

      case 'session.idle': {
        broadcast({
          v: 1,
          type: 'session.status',
          id: eventId,
          working: false,
        });
        if (localSessionId) {
          try {
            this.sessionsRepo.updateStatus(localSessionId, 'idle');
          } catch (err) {
            logger.error(
              '[OpencodeStreamBridge] Failed to update session status to idle:',
              err,
            );
          }
          // Persist the assembled assistant turn (if any) and clear the
          // pending buffer.
          const text = this.pendingText.get(localSessionId);
          if (text && text.length > 0) {
            try {
              this.messagesRepo.append(localSessionId, 'output', text, text);
              this.sessionsRepo.updatePreview(
                localSessionId,
                text.slice(0, 200),
                new Date().toISOString(),
              );
            } catch (err) {
              logger.error(
                '[OpencodeStreamBridge] Failed to persist assistant turn:',
                err,
              );
            }
            this.pendingText.delete(localSessionId);
          }
        }
        break;
      }

      case 'session.created': {
        broadcast({
          v: 1,
          type: 'session.created',
          id: eventId,
          properties: event.properties ?? {},
        });
        break;
      }

      case 'session.error': {
        const errProps = event.properties as Record<string, unknown>;
        const errorInfo = errProps?.error as Record<string, unknown> | undefined;
        const message = String(
          errorInfo?.message ?? errorInfo ?? 'Unknown error',
        );
        broadcast({
          v: 1,
          type: 'error',
          id: eventId,
          message,
        });
        // Persist the error so the Agents view doesn't spin "Starting"
        // forever. We can't add a 'failed' status (the type union doesn't
        // include one without a migration), so we append an error message
        // and mark the session 'closed'. The UI's session detail view will
        // render the appended message and the resumable list will surface
        // the closure.
        if (localSessionId) {
          try {
            this.messagesRepo.append(
              localSessionId,
              'system',
              `Error: ${message}`,
              `Error: ${message}`,
            );
            this.sessionsRepo.markClosed(localSessionId);
          } catch (err) {
            logger.error(
              '[OpencodeStreamBridge] Failed to persist session error:',
              err,
            );
          }
        }
        break;
      }

      default: {
        // Relay any unrecognized event as a generic event
        broadcast({
          v: 1,
          type: 'event',
          id: eventId,
          eventType: event.type,
          properties: event.properties ?? {},
        });
        break;
      }
    }
  }

  /** Stop streaming for a session. */
  stopStream(_sessionId: string): void {
    // Keep the event stream alive for other sessions.
    // Only disconnect if explicitly disposed.
  }

  /** Clean up all streams. */
  dispose(): void {
    for (const [, entry] of this.streamsByDirectory) {
      entry.abort.abort();
    }
    this.streamsByDirectory.clear();
  }
}

/** Singleton stream bridge instance. */
export const streamBridge = new OpencodeStreamBridge();
