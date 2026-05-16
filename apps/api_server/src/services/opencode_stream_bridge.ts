import { broadcast, broadcastSessionUpdated } from './ws_gateway';
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

/**
 * Best-effort message extraction from the opencode session.error payload.
 * The SDK wraps API errors in {name, data: {message, ...}} or sometimes
 * delivers nested AI SDK errors. We surface the most useful string we can
 * find so the UI shows something readable like "Key limit exceeded" instead
 * of "[object Object]".
 */
function extractErrorMessage(errorInfo: unknown): string {
  if (!errorInfo) return 'Unknown error';
  if (typeof errorInfo === 'string') return errorInfo;
  if (typeof errorInfo !== 'object') return String(errorInfo);
  const obj = errorInfo as Record<string, unknown>;
  const data = obj.data as Record<string, unknown> | undefined;
  // Try data.message first (most common shape).
  if (typeof data?.message === 'string') return data.message;
  // Top-level message.
  if (typeof obj.message === 'string') return obj.message;
  // AI SDK upstream: data.responseBody is JSON with {error: {message, code}}.
  if (typeof data?.responseBody === 'string') {
    try {
      const parsed = JSON.parse(data.responseBody) as Record<string, unknown>;
      const err = parsed.error as Record<string, unknown> | undefined;
      if (typeof err?.message === 'string') {
        return data.responseBody.length > 200
          ? err.message
          : `${err.message} (HTTP ${err.code ?? data.statusCode ?? '?'})`;
      }
    } catch (_) {
      /* fall through */
    }
  }
  // AI SDK upstream: data.responseBody object form.
  const responseBody = data?.responseBody as Record<string, unknown> | undefined;
  const innerError = responseBody?.error as Record<string, unknown> | undefined;
  if (typeof innerError?.message === 'string') return innerError.message;
  // Errors as arrays (Zod-style).
  const errArr = data?.error as Array<{ message?: string }> | undefined;
  if (Array.isArray(errArr) && errArr[0]?.message) return errArr[0].message;
  // Last resort: stringify (capped).
  try {
    const j = JSON.stringify(errorInfo);
    return j.length > 300 ? j.slice(0, 300) + '…' : j;
  } catch {
    return String(errorInfo);
  }
}

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

  // Sessions that have already received a session.error event in the
  // current turn. The SDK fires session.idle right after session.error,
  // which would clobber the 'closed' status we set on error. Track the
  // failure and let session.idle skip the status update.
  private erroredSessions = new Set<string>();

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
    logger.info(
      `[OpencodeStreamBridge] streamSession entry session=${localSessionId} sdkSession=${_opencodeSessionId} directory=${directory}`,
    );
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
        // Forward the full part object to the client so it can mirror
        // Opencode Desktop's `setStore("part", messageID, ...)` pattern —
        // upsert by part.id keyed under part.messageID. Also keep emitting
        // the legacy `output` delta for any client still on the old buffer
        // model (used only for the live preview animation).
        const part = props?.part as Record<string, unknown> | undefined;
        const delta = props?.delta as string | undefined;
        if (part) {
          broadcast({
            v: 1,
            type: 'message.part.updated',
            id: eventId,
            part,
          });
        }
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
        // Streaming text delta during an assistant turn. Forward verbatim
        // so the client can append delta into the right part by partID.
        const messageID = props?.messageID as string | undefined;
        const partID = props?.partID as string | undefined;
        const field = props?.field as string | undefined;
        const delta = props?.delta as string | undefined;
        if (delta && field === 'text' && localSessionId) {
          // Keep the accumulator so we can persist assistant turns on idle.
          this.pendingText.set(
            localSessionId,
            (this.pendingText.get(localSessionId) ?? '') + delta,
          );
        }
        if (messageID && partID && typeof delta === 'string') {
          broadcast({
            v: 1,
            type: 'message.part.delta',
            id: eventId,
            messageId: messageID,
            partId: partID,
            field: field ?? 'text',
            delta,
          });
        }
        // Keep legacy `output` event for older client builds.
        if (delta && field === 'text') {
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
        // Forward the full message info so the client can upsert it under
        // its sessionID — same as Opencode Desktop's reducer pattern.
        const info = props?.info as Record<string, unknown> | undefined;
        if (info) {
          broadcast({
            v: 1,
            type: 'message.updated',
            id: eventId,
            info,
          });
        }
        // Legacy flush event kept for back-compat.
        broadcast({
          v: 1,
          type: 'output.flush',
          id: eventId,
          properties: event.properties ?? {},
        });
        break;
      }

      case 'message.removed': {
        const messageID = props?.messageID as string | undefined;
        if (messageID) {
          broadcast({
            v: 1,
            type: 'message.removed',
            id: eventId,
            messageId: messageID,
          });
        }
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
          // Skip the update if the session already errored this turn —
          // otherwise the SDK's idle event would clobber 'closed'.
          if (localSessionId && !this.erroredSessions.has(localSessionId)) {
            try {
              const dbStatus = status.type === 'busy' ? 'working' : 'idle';
              this.sessionsRepo.updateStatus(localSessionId, dbStatus);
              const updated = this.sessionsRepo.findById(localSessionId);
              if (updated) broadcastSessionUpdated(updated);
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
        if (localSessionId && !this.erroredSessions.has(localSessionId)) {
          try {
            this.sessionsRepo.updateStatus(localSessionId, 'idle');
            const updated = this.sessionsRepo.findById(localSessionId);
            if (updated) broadcastSessionUpdated(updated);
          } catch (err) {
            logger.error(
              '[OpencodeStreamBridge] Failed to update session status to idle:',
              err,
            );
          }
          // Persist the assembled assistant turn (if any), finalize it into
          // the Flutter transcript via `transcript.append`, and clear the
          // pending buffer. Without this broadcast, the streaming delta text
          // lives only in the Flutter `_liveOutputBuffer` preview and never
          // appears as a finalized assistant message in the chat history.
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
            broadcast({
              v: 1,
              type: 'transcript.append',
              id: localSessionId,
              role: 'output',
              text,
            });
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
        const message = extractErrorMessage(errorInfo);
        if (localSessionId) {
          this.erroredSessions.add(localSessionId);
          // Clear the failure flag after a short delay so a follow-up
          // prompt on the same session can transition cleanly.
          setTimeout(
            () => this.erroredSessions.delete(localSessionId),
            5000,
          ).unref?.();
          // Flush any partial assistant text accumulated during the turn so
          // the user sees what arrived before the error. Then drop the
          // pending buffer so the follow-up session.idle doesn't re-emit it.
          const partial = this.pendingText.get(localSessionId);
          if (partial && partial.length > 0) {
            broadcast({
              v: 1,
              type: 'transcript.append',
              id: localSessionId,
              role: 'output',
              text: partial,
            });
            this.pendingText.delete(localSessionId);
          }
        }
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
            const closed = this.sessionsRepo.findById(localSessionId);
            if (closed) broadcastSessionUpdated(closed);
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
