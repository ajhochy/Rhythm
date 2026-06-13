import { broadcast, broadcastSessionUpdated } from './ws_gateway';
import { opencodeClient } from './opencode_engine';
import { opencodeSessionMap } from './opencode_engine';
import { logger } from '../utils/logger';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import type { PermissionMode } from '../models/agent_session';

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

/** Shape of a pending permission stored in-memory. */
export interface PendingPermission {
  permissionId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  /** SDK session ID (needed to call respondPermission). */
  sdkSessionId: string;
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

  // OPC-M1-4: Sessions that have been explicitly stopped (via DELETE or
  // close). Events arriving for a stopped session are silently dropped —
  // no WS broadcast, no DB write — so the shared SSE stream can stay alive
  // without producing ghost events for dead local IDs.
  //
  // Note: the old `erroredSessions` Set (which used a 5s setTimeout to
  // auto-clear) has been removed. Error state is now persisted on the DB
  // row (status='error', status_message). We detect "already errored" by
  // reading the DB row status, which survives bridge restarts and never
  // resets on a timer.
  private stoppedSessions = new Set<string>();

  // In-memory accumulator for message.part.delta events, keyed by
  // `${sdkMessageId}:${partId}`. Deltas are written-through to the DB via
  // applyPartDelta immediately (so a bridge restart loses at most in-flight
  // deltas). This accumulator is only used to assemble the full text for
  // the legacy transcript.append broadcast on session.idle.
  //
  // Flush points: next message.part.updated for the same part (bridge
  // receives the authoritative full-text version — accumulator discarded),
  // message.updated for the same message, or session.idle (turn boundary).
  private pendingPartDeltas = new Map<string, { sdkMessageId: string; partId: string; text: string }>();

  // In-memory map of pending permissions. Key = `${localSessionId}:${permissionId}`.
  // Cleared when the user (or auto-logic) resolves the permission.
  private pendingPermissions = new Map<string, PendingPermission>();

  /** Return the pending permission for a session+permissionId, or undefined. */
  getPendingPermission(localSessionId: string, permissionId: string): PendingPermission | undefined {
    return this.pendingPermissions.get(`${localSessionId}:${permissionId}`);
  }

  /** Remove a pending permission after it is resolved. */
  clearPendingPermission(localSessionId: string, permissionId: string): void {
    this.pendingPermissions.delete(`${localSessionId}:${permissionId}`);
  }

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
    //   message.updated     → properties.info.sessionID  (message.info.sessionID)
    //   message.part.updated→ properties.part.sessionID
    //   message.removed     → properties.sessionID
    //   session.updated     → properties.info.id  (Session.id, not sessionID)
    const props = (event.properties ?? {}) as Record<string, unknown>;
    const propsInfo = props.info as Record<string, unknown> | undefined;
    const propsPart = props.part as Record<string, unknown> | undefined;
    const opencodeSessionId = (props.sessionID ??
      propsInfo?.sessionID ??
      // session.updated carries Session shape where id = sdk session id
      propsInfo?.id ??
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

    // OPC-M1-4: If the local session has been explicitly stopped (via
    // stopStream), drop all events for it. The shared SSE subscription stays
    // alive for other sessions in the same directory.
    if (localSessionId && this.stoppedSessions.has(localSessionId)) {
      return;
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
        // upsert by part.id keyed under part.messageID.
        //
        // OPC-M1-2 — message.part.updated is the ONLY carrier of part data.
        // UpdatedEventSchema carries only { sessionID, info } — no parts.
        // Persist the part into the DB row's parts_json here.
        const part = props?.part as Record<string, unknown> | undefined;
        if (part) {
          broadcast({
            v: 1,
            type: 'message.part.updated',
            id: eventId,
            part,
          });

          // Persist part to DB.
          if (localSessionId) {
            const sdkMessageId = part.messageID as string | undefined;
            if (sdkMessageId) {
              try {
                // When part.updated arrives, the authoritative text is in the
                // part object — discard any in-memory delta accumulator for
                // this part since the full value supersedes it.
                const partId = part.id as string | undefined;
                if (partId) {
                  this.pendingPartDeltas.delete(`${sdkMessageId}:${partId}`);
                }
                this.messagesRepo.upsertPart(localSessionId, sdkMessageId, part);
              } catch (err) {
                logger.error('[OpencodeStreamBridge] Failed to persist part:', err);
              }
            }
          }
        }
        break;
      }

      case 'message.part.delta': {
        // Streaming text delta during an assistant turn. Forward verbatim
        // so the client can append delta into the right part by partID.
        //
        // OPC-M1-2 — Write-through delta to DB immediately via applyPartDelta
        // so a bridge restart loses at most in-flight (unwritten) deltas. The
        // authoritative full-text arrives later in message.part.updated, which
        // overwrites the accumulated value, making delta accumulation lossless
        // across a normal turn.
        //
        // Flush points for pendingPartDeltas in-memory accumulator (used only
        // for the legacy transcript.append broadcast on session.idle):
        //   1. Next message.part.updated for the same part — full value replaces.
        //   2. message.updated for the same message — delta discarded.
        //   3. session.idle — full turn boundary flush.
        const messageID = props?.messageID as string | undefined;
        const partID = props?.partID as string | undefined;
        const field = props?.field as string | undefined;
        const delta = props?.delta as string | undefined;
        if (delta && field === 'text' && localSessionId) {
          // Keep the per-session accumulator so we can persist assistant turns on idle.
          this.pendingText.set(
            localSessionId,
            (this.pendingText.get(localSessionId) ?? '') + delta,
          );
          // Keep per-part accumulator for structured transcript.
          if (messageID && partID) {
            const key = `${messageID}:${partID}`;
            const existing = this.pendingPartDeltas.get(key);
            if (existing) {
              existing.text += delta;
            } else {
              this.pendingPartDeltas.set(key, { sdkMessageId: messageID, partId: partID, text: delta });
            }
          }
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
          // Write-through to DB — bounded loss on restart (only unsaved deltas lost).
          if (localSessionId && field) {
            try {
              this.messagesRepo.applyPartDelta(localSessionId, messageID, partID, field, delta);
            } catch (err) {
              logger.error('[OpencodeStreamBridge] Failed to apply part delta to DB:', err);
            }
          }
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
        //
        // OPC-M1-2 — IMPORTANT: the real UpdatedEventSchema = { sessionID, info }
        // carries NO parts field. Parts arrive exclusively via message.part.updated.
        // We only persist info-level metadata (role, tokens, cost) here and
        // deliberately preserve any parts_json already accumulated in the DB row.
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

        if (localSessionId && info) {
          try {
            const sdkMessageId = info.id as string | undefined;
            const role = info.role as string | undefined;
            const tokens = (info.tokens ?? null) as Record<string, unknown> | null;
            const cost = typeof info.cost === 'number' ? info.cost : null;

            if (sdkMessageId && role) {
              const dbRole: 'output' | 'input' | 'system' =
                role === 'assistant' ? 'output' : role === 'user' ? 'input' : 'system';
              // upsertMessageInfo preserves existing parts_json — does NOT clobber
              // parts accumulated from earlier message.part.updated events.
              this.messagesRepo.upsertMessageInfo(
                localSessionId,
                sdkMessageId,
                dbRole,
                tokens != null ? JSON.stringify(tokens) : null,
                cost,
              );
            }
          } catch (err) {
            logger.error('[OpencodeStreamBridge] Failed to persist message info:', err);
          }
        }
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
          // OPC-M1-2 — Delete the row from the DB.
          if (localSessionId) {
            try {
              this.messagesRepo.deleteBySdkMessageId(localSessionId, messageID);
            } catch (err) {
              logger.error('[OpencodeStreamBridge] Failed to delete message row:', err);
            }
          }
        }
        break;
      }

      case 'message.part.removed': {
        const messageID = props?.messageID as string | undefined;
        const partID = props?.partID as string | undefined;
        if (messageID && partID) {
          broadcast({
            v: 1,
            type: 'message.part.removed',
            id: eventId,
            messageId: messageID,
            partId: partID,
          });
          // OPC-M1-2 — Remove the part from parts_json in the DB.
          if (localSessionId) {
            try {
              this.messagesRepo.removePart(localSessionId, messageID, partID);
            } catch (err) {
              logger.error('[OpencodeStreamBridge] Failed to remove part from DB:', err);
            }
          }
        }
        break;
      }

      case 'session.status': {
        // status.type tells us busy | idle | retry
        const statusProps = event.properties as Record<string, unknown>;
        const status = statusProps?.status as { type: string; attempt?: number; message?: string; next?: number } | undefined;
        if (status) {
          if (status.type === 'retry') {
            // OPC-M2-4: relay retry as a distinct WS status 'retrying' carrying
            // attempt count and reason. Do NOT persist to DB (retry is transient;
            // the session is still in its prior persistent status). Do NOT update
            // the DB row — idle/busy transitions do that; retry is in-flight.
            broadcast({
              v: 1,
              type: 'session.status',
              id: eventId,
              working: true,
              status: 'retrying',
              attempt: status.attempt ?? 1,
              reason: status.message ?? '',
            });
            // No DB update for retry — the session status stays at its previous value
            // (busy/working). The retrying state is surfaced purely in the WS frame.
          } else {
            // idle or busy — existing behaviour unchanged.
            broadcast({
              v: 1,
              type: 'session.status',
              id: eventId,
              working: status.type === 'busy',
              status: status.type,
            });
            // Persist to DB so the agents list badge moves off "Starting".
            // OPC-M1-4: Skip the update if the session DB row is already in
            // status='error' — otherwise the SDK's idle event would clobber
            // the persisted error state. We read from DB (not an in-memory set)
            // so the check survives bridge restarts.
            const currentStatus = (() => {
              try {
                return this.sessionsRepo.findById(localSessionId!)?.status;
              } catch { return undefined; }
            })();
            if (localSessionId && currentStatus !== 'error') {
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
        // OPC-M1-4: Check DB for error status instead of in-memory set.
        const idleSessionStatus = (() => {
          try {
            return localSessionId ? this.sessionsRepo.findById(localSessionId)?.status : undefined;
          } catch { return undefined; }
        })();
        if (localSessionId && idleSessionStatus !== 'error') {
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
          // Finalize the assistant turn into the Flutter transcript via
          // `transcript.append` and clear the pending buffer. Without this
          // broadcast, the streaming delta text lives only in the Flutter
          // `_liveOutputBuffer` preview and never appears as a finalized
          // assistant message in the chat history.
          //
          // OPC-M1-2: When structured messages are already persisted (from
          // message.part.updated events), skip the legacy DB append — it would
          // create a duplicate row. We still broadcast transcript.append so the
          // Flutter client finalizes the live preview. Legacy sessions (no SDK
          // message IDs) still use the append path for DB persistence.
          const text = this.pendingText.get(localSessionId);
          if (text && text.length > 0) {
            const hasStructured = this.messagesRepo.hasStructuredMessages(localSessionId);
            if (!hasStructured) {
              // Legacy path: no structured messages — persist the plain-text row.
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
            } else {
              // Structured path: raw_text already updated by upsertPart/applyPartDelta.
              // Just update the session preview from the accumulated text.
              try {
                this.sessionsRepo.updatePreview(
                  localSessionId,
                  text.slice(0, 200),
                  new Date().toISOString(),
                );
              } catch (err) {
                logger.error(
                  '[OpencodeStreamBridge] Failed to update session preview:',
                  err,
                );
              }
            }
            broadcast({
              v: 1,
              type: 'transcript.append',
              id: localSessionId,
              role: 'output',
              text,
            });
            this.pendingText.delete(localSessionId);
            // Clear per-part delta accumulators — turn boundary reached.
            this.pendingPartDeltas.clear();
          } else {
            // Zero tokens streamed this turn — surface as user-visible error (#636)
            broadcast({
              v: 1,
              type: 'error',
              id: localSessionId,
              message: 'The model returned an empty response.',
            });
          }
        }
        break;
      }

      case 'session.diff': {
        // OPC-M3-1: relay session.diff events so the Flutter Changes tab knows
        // to refetch GET /agent-sessions/:id/diff for the affected session.
        // The event carries no diff payload itself — the client must call the
        // REST endpoint to get the full FileDiff array.
        broadcast({
          v: 1,
          type: 'session.diff',
          id: eventId,
        });
        break;
      }

      case 'todo.updated': {
        // OPC-M3-5: relay todo.updated events so the Flutter todo panel can
        // update in real-time without polling. The full todo list is embedded
        // in the event properties — no REST refetch needed.
        const todoProps = event.properties as Record<string, unknown>;
        const todos = todoProps?.todos as Array<unknown> | undefined;
        broadcast({
          v: 1,
          type: 'todo.updated',
          id: eventId,
          todos: todos ?? [],
        });
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

      case 'session.updated': {
        // OPC-#710 — auto-title: opencode emits session.updated after the first
        // exchange with a generated title in info.title. Map it to the Rhythm
        // session name, persist it, and broadcast SessionUpdatedMessage so the
        // Flutter session list updates live without polling.
        //
        // NOTE: The SDK session id for routing lives in `properties.info.id`
        // (NOT in a top-level `properties.sessionID`). The `localSessionId` /
        // `eventId` resolved above already handles this via the opencodeSessionMap
        // reverse-lookup on `propsInfo?.sessionID` — but for session.updated the
        // SDK id is `info.id` (not `info.sessionID`). Re-resolve from info.id
        // to ensure correct mapping.
        const updatedInfo = props.info as Record<string, unknown> | undefined;
        if (updatedInfo && localSessionId) {
          const title = updatedInfo.title as string | undefined;
          if (title && title.trim().length > 0) {
            try {
              this.sessionsRepo.updateFields(localSessionId, { name: title.trim() });
              const updated = this.sessionsRepo.findById(localSessionId);
              if (updated) broadcastSessionUpdated(updated);
            } catch (err) {
              logger.error(
                '[OpencodeStreamBridge] Failed to update session name from session.updated:',
                err,
              );
            }
          }
        }
        break;
      }

      case 'session.error': {
        const errProps = event.properties as Record<string, unknown>;
        const errorInfo = errProps?.error as Record<string, unknown> | undefined;
        const message = extractErrorMessage(errorInfo);
        if (localSessionId) {
          // OPC-M1-4: Flush any partial assistant text accumulated during the
          // turn so the user sees what arrived before the error. Then drop the
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
        // OPC-M1-4: Persist error state on the DB row (status='error',
        // status_message=message). This replaces the old in-memory
        // erroredSessions + 5s setTimeout sentinel:
        //   - Error state survives bridge restarts (persisted in SQLite).
        //   - No time-based auto-clear: error clears only on an explicit
        //     user action (new prompt → ws_gateway calls clearErrorStatus,
        //     or resume → controller transitions status to 'starting').
        //   - session.idle after session.error is suppressed by DB check
        //     (idleSessionStatus === 'error') — no race condition.
        if (localSessionId) {
          try {
            this.messagesRepo.append(
              localSessionId,
              'system',
              `Error: ${message}`,
              `Error: ${message}`,
            );
            this.sessionsRepo.setErrorStatus(localSessionId, message);
            const updated = this.sessionsRepo.findById(localSessionId);
            if (updated) broadcastSessionUpdated(updated);
          } catch (err) {
            logger.error(
              '[OpencodeStreamBridge] Failed to persist session error:',
              err,
            );
          }
        }
        break;
      }

      case 'permission.updated': {
        // The real SDK emits `permission.updated` with a `Permission` payload
        // (v1.14.49) — there is NO `permission.asked` event. Listening for the
        // wrong name silently dropped every permission request, so any
        // permission-gated tool (write/edit) hung the session forever with no
        // card. `event.properties` IS the Permission object:
        //   { id, type, pattern?, sessionID, messageID, callID?, title, metadata, time }
        const perm = event.properties as {
          id?: string;
          type?: string;
          sessionID?: string;
          title?: string;
          metadata?: Record<string, unknown>;
        };
        const permissionId = perm.id;
        if (!permissionId || !localSessionId) break;

        const sdkSessionId = opencodeSessionId ?? '';
        const toolName = perm.type ?? '';
        const args = perm.metadata ?? {};
        const summary = perm.title ?? toolName;

        // Consult the session's permission_mode to decide whether to
        // auto-respond or forward to the user.
        let permissionMode: PermissionMode = 'default';
        try {
          const dbSession = this.sessionsRepo.findById(localSessionId);
          permissionMode = (dbSession?.permissionMode ?? 'default') as PermissionMode;
        } catch (err) {
          logger.error('[OpencodeStreamBridge] Failed to load session for permission mode:', err);
        }

        const editTools = new Set(['write', 'edit', 'patch']);
        const shouldAutoAccept =
          permissionMode === 'bypassPermissions' ||
          (permissionMode === 'acceptEdits' && editTools.has(toolName.toLowerCase()));
        const shouldAutoDeny = permissionMode === 'plan';

        if (shouldAutoAccept || shouldAutoDeny) {
          const decision = shouldAutoAccept ? 'accept' : 'deny';
          // Auto-resolve — call the SDK to unblock the agent.
          (async () => {
            try {
              await opencodeClient.respondPermission(sdkSessionId, permissionId, decision);
            } catch (err) {
              logger.error(`[OpencodeStreamBridge] Auto-${decision} respondPermission failed:`, err);
            }
          })();
          // Broadcast a permission.resolved so Flutter can update its UI.
          broadcast({
            v: 1,
            type: 'permission.resolved',
            sessionId: localSessionId,
            permissionId,
            decision,
          });
          break;
        }

        // Default / acceptEdits-but-non-edit path: store in pending map and broadcast.
        const pending: PendingPermission = {
          permissionId,
          toolName,
          args,
          summary,
          sdkSessionId,
        };
        this.pendingPermissions.set(`${localSessionId}:${permissionId}`, pending);
        broadcast({
          v: 1,
          type: 'permission.asked',
          sessionId: localSessionId,
          permissionId,
          toolName,
          args,
          summary,
        });
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

  /**
   * OPC-M1-4 — Stop relaying events for a specific local session.
   *
   * Unregisters the session from the routing/filter map so that any
   * subsequent SSE events for its SDK session ID are silently dropped —
   * no WS broadcast and no DB write. The shared SSE subscription for the
   * directory stays alive so other sessions in the same cwd are unaffected.
   *
   * Called by the controller on DELETE /agent-sessions/:id and destroy().
   */
  stopStream(localSessionId: string): void {
    this.stoppedSessions.add(localSessionId);
    // Also clean up the pending-text accumulator for this session so stale
    // deltas don't linger in memory after the session is closed.
    this.pendingText.delete(localSessionId);
  }

  /**
   * OPC-M1-4 — Clear error state for a session on an explicit user action.
   *
   * Called by the ws_gateway when a session.input frame arrives for a
   * session that is currently in status='error'. Transitions the DB row to
   * status='working' and nulls out status_message so the next turn starts
   * fresh. No-op if the session is not in error state.
   */
  clearErrorStatus(localSessionId: string): void {
    try {
      this.sessionsRepo.clearErrorStatus(localSessionId);
      const updated = this.sessionsRepo.findById(localSessionId);
      if (updated) broadcastSessionUpdated(updated);
    } catch (err) {
      logger.error('[OpencodeStreamBridge] Failed to clear error status:', err);
    }
  }

  /** Clean up all streams. */
  dispose(): void {
    for (const [, entry] of this.streamsByDirectory) {
      entry.abort.abort();
    }
    this.streamsByDirectory.clear();
    this.stoppedSessions.clear();
    this.pendingText.clear();
  }
}

/** Singleton stream bridge instance. */
export const streamBridge = new OpencodeStreamBridge();
