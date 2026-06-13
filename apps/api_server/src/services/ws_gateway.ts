import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { appEvents } from '../utils/app_events';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';

export interface WsMessage {
  v: 1;
  type: string;
  [key: string]: unknown;
}

const clients = new Set<WebSocket>();
let attached = false;

export function attachWsGateway(server: http.Server): WebSocketServer {
  // Idempotency guard: if already attached, return a no-op WSS
  if (attached) {
    return new WebSocketServer({ noServer: true });
  }
  attached = true;

  const wss = new WebSocketServer({ server, path: '/ws/agents' });

  wss.on('connection', (ws) => {
    clients.add(ws);

    // Send initial sessions.list on connect
    try {
      const repo = new AgentSessionsRepository();
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'sessions.list',
          sessions: repo.listActive(),
          resumable: repo.listResumable(),
        }),
      );
    } catch {
      // DB may not be ready yet — ignore
    }

    ws.on('message', (raw) => handleClientMessage(ws, raw));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Forward claude.trigger events to all connected WS clients
  appEvents.on('claude.trigger', (payload: { taskId: string; taskTitle: string; triggeredByUserId: number | null }) => {
    broadcast({
      v: 1,
      type: 'trigger.fired',
      taskId: payload.taskId,
      taskTitle: payload.taskTitle,
      triggeredByUserId: payload.triggeredByUserId,
    });
  });

  return wss;
}

export function broadcast(msg: object): void {
  const raw = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(raw);
      } catch {
        // ignore broken pipe
      }
    }
  }
}

/**
 * Broadcast a full session row update to all connected WS clients.
 * Used by controller / stream bridge whenever a session row changes
 * in a way the client's local cache should reflect immediately (rename,
 * status transition, archive toggle, etc.).
 */
export function broadcastSessionUpdated(session: import('../models/agent_session').AgentSession): void {
  broadcast({ v: 1, type: 'session.updated', session });
}

/**
 * Broadcast a session removal (hard-delete) to all connected WS clients so
 * they can drop the row from their local cache immediately.
 */
export function broadcastSessionRemoved(id: string): void {
  broadcast({ v: 1, type: 'session.removed', id });
}

/**
 * OPC-M3-4 — Handle a `session.command` WS frame.
 *
 * Transport choice: WS frame over `session.command` (not a REST route).
 * Rationale: slash-command dispatch is a fire-and-forget operation that
 * arrives on the same live WS connection as `session.input`. Using a WS
 * frame keeps all user-initiated session interactions on the same channel
 * and avoids a cross-channel ordering hazard (WS input vs. REST command
 * racing in the SDK's message queue).
 *
 * Frame shape: { v:1, type:'session.command', id: localSessionId,
 *                command: string, arguments: string }
 *
 * On success: dispatchCommand is called with (sdkId, command, arguments).
 *             The SDK streams the response back via the event stream (same
 *             path as promptAsync), so no synchronous response is needed.
 * On error:   a { v:1, type:'error', id, message } frame is sent back.
 */
export async function handleCommandFrame(
  ws: WebSocket,
  msg: Record<string, unknown>,
): Promise<void> {
  const id = msg.id as string | undefined;
  const command = msg.command as string | undefined;
  const args = (msg.arguments ?? '') as string;

  if (!id || !command) {
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'error',
        id: id ?? '',
        message: 'session.command requires id and command fields',
      }),
    );
    return;
  }

  // Look up local session to verify it exists.
  let dbSession: import('../models/agent_session').AgentSession | null = null;
  try {
    dbSession = new AgentSessionsRepository().findById(id);
  } catch {
    // DB unavailable — treat as unknown session.
  }

  if (!dbSession) {
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'error',
        id,
        message: `Unknown session: ${id}`,
      }),
    );
    return;
  }

  // Look up the SDK session mapping.
  const sdkId = opencodeSessionMap.get(id);
  if (!sdkId) {
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'error',
        id,
        message: `No SDK session mapping for local session ${id}. Start or resume the session first.`,
      }),
    );
    return;
  }

  try {
    await opencodeClient.dispatchCommand(sdkId, command, args);
  } catch (err) {
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'error',
        id,
        message: String(err),
      }),
    );
  }
}

/**
 * OPC-M4-1 — Handle a `session.input` WS frame.
 *
 * Accepts either:
 *   - Legacy shape: `{ type: 'session.input', id, data: string }`
 *   - Parts shape:  `{ type: 'session.input', id, parts: Array<Part> }`
 *
 * When `parts` is present the full parts array is forwarded verbatim to
 * `promptAsync` (6th arg), enabling real multimodal input (FilePart with
 * data URIs). The text extracted from text-type parts is used as the
 * `data` string argument so the SDK's text path works unchanged.
 *
 * Size guard: any FilePart whose `url` exceeds 20 MB yields a clear error
 * frame and returns without calling promptAsync.
 *
 * Exported for unit testing (see src/__tests__/opc_m4_1_file_attachments.test.ts).
 */
export async function handleInputFrame(
  ws: WebSocket,
  msg: Record<string, unknown>,
): Promise<void> {
  const id = msg.id as string | undefined;

  // OPC-M4-1: accept either legacy `data: string` or new `parts: Array<...>`.
  let data = msg.data as string | undefined;
  const partsInput = msg.parts as
    | Array<Record<string, unknown>>
    | undefined;

  let partsToForward: Array<Record<string, unknown>> | undefined;

  if (Array.isArray(partsInput) && partsInput.length > 0) {
    // OPC-M4-1 size guard: reject payloads with oversized file data URIs.
    const kMaxBytes = 20 * 1024 * 1024; // 20 MB
    for (const p of partsInput) {
      if (p.type === 'file' || p.type === 'image') {
        const url = p.url as unknown;
        if (typeof url === 'string' && url.length > kMaxBytes) {
          if (id) {
            ws.send(
              JSON.stringify({
                v: 1,
                type: 'error',
                id,
                message:
                  `Attachment exceeds the 20 MB size limit. Please reduce the file size and try again.`,
              }),
            );
          }
          return;
        }
      }
    }

    // Extract text from text parts for the `data` string.
    if (!data) {
      const textLines = partsInput
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string);
      data = textLines.join('\n').trim();
    }

    // Forward the full parts array (text + file parts) to the SDK.
    partsToForward = partsInput;
  }

  // M2-2: per-turn override on the WS frame, never persisted.
  const perTurnOverride = (msg.modelOverride ?? null) as {
    providerId?: string;
    modelId?: string;
  } | null;
  // Issue #604: per-turn reasoning budget + fast-mode, never persisted.
  const perTurnThinking = (msg.thinking ?? null) as {
    budget_tokens?: number;
  } | null;
  const perTurnFastMode = typeof msg.fastMode === 'boolean' ? msg.fastMode : null;

  if (!id || typeof data !== 'string') {
    return;
  }

  let opencodeId = opencodeSessionMap.get(id);
  let cwd: string | undefined;
  let agentKind: string | undefined;
  let sessionName: string | undefined;
  let sessionProviderId: string | null = null;
  let sessionModelId: string | null = null;
  let sessionThinkingBudget: number | null = null;
  let sessionFastMode = false;
  try {
    const session = new AgentSessionsRepository().findById(id);
    if (session) {
      cwd = session.cwd;
      agentKind = session.agentKind;
      sessionName = session.name;
      sessionProviderId = session.providerId;
      sessionModelId = session.modelId;
      sessionThinkingBudget = session.thinkingBudget ?? null;
      sessionFastMode = session.fastMode ?? false;
    }
  } catch {
    /* DB unavailable — proceed without context */
  }

  // OPC-M1-4: If the session is in status='error', clear the error
  // state before forwarding the prompt. This is the "explicit user
  // action" that transitions the session out of error — the new
  // prompt signals intent to retry. clearErrorStatus is a no-op if
  // the session is not in error state.
  {
    const session = new AgentSessionsRepository().findById(id);
    if (session?.status === 'error') {
      const { streamBridge } = await import('./opencode_stream_bridge');
      streamBridge.clearErrorStatus(id);
    }
  }

  // Issue #653: legacy '__pending__' agent-less sessions are no
  // longer supported. The client must pick a model in the trigger
  // bubble BEFORE creating the session (POST /agent-sessions
  // rejects null/empty/'__pending__' agentIds with 400). Any session
  // row carrying the historical sentinel is invalid — reject the
  // input frame with a clear error so a stale client can be
  // updated. We deliberately do NOT resurrect the previous
  // resolve-on-first-turn path; that's the architectural mistake
  // #653 fixes.
  if (agentKind === '__pending__') {
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'error',
        id,
        message:
          "This chat was created in a legacy state ('__pending__'). " +
          'Close it and open a new chat from the task — the new ' +
          'flow lets you pick the model before sending. (#653)',
      }),
    );
    return;
  }

  // OPC-M1-5 Auto-resume: sessions persist in SQLite across api_server
  // restarts, but `opencodeSessionMap` is in-process and is wiped
  // on each boot. If the user sends input to a session that has
  // no current SDK mapping, try to re-attach to the EXISTING SDK
  // session first (using sdk_session_id from the DB row), then
  // fall back to creating a fresh session only if the SDK session
  // is gone.
  if (!opencodeId) {
    if (!cwd) {
      console.warn(
        `[ws_gateway] session.input for unknown session ${id} (no DB row); dropping`,
      );
      return;
    }
    try {
      // OPC-M1-5: look up the persisted sdk_session_id first.
      const dbSessionForResume = new AgentSessionsRepository().findById(id);
      const persistedSdkId = dbSessionForResume?.sdkSessionId ?? null;

      if (persistedSdkId) {
        // Try to re-attach to the existing SDK session.
        const existingSession = await opencodeClient.getSession(persistedSdkId);
        if (existingSession) {
          // Re-attach path — session is alive.
          opencodeId = existingSession.id;
          opencodeSessionMap.set(id, opencodeId);
          const { streamBridge } = await import('./opencode_stream_bridge');
          streamBridge.clearErrorStatus(id);
          streamBridge
            .streamSession(id, opencodeId, cwd)
            .catch((err) =>
              console.error(
                `[ws_gateway] auto-resume (re-attach) stream bridge error for ${id}:`,
                err,
              ),
            );
          console.log(
            `[ws_gateway] auto-resumed (re-attached) session ${id} -> SDK ${opencodeId}`,
          );
        } else {
          // SDK session is gone — create a fresh one and persist the new id.
          console.warn(
            `[ws_gateway] SDK session "${persistedSdkId}" gone for local session ${id} — creating fresh`,
          );
          const freshSession = await opencodeClient.createSession(
            sessionName ?? 'Resumed',
            cwd,
          );
          if (!freshSession) {
            ws.send(
              JSON.stringify({
                v: 1,
                type: 'error',
                id,
                message: 'Could not resume session — Opencode engine unavailable.',
              }),
            );
            return;
          }
          opencodeId = freshSession.id;
          opencodeSessionMap.set(id, opencodeId);
          new AgentSessionsRepository().setSdkSessionId(id, opencodeId);
          const { streamBridge } = await import('./opencode_stream_bridge');
          streamBridge
            .streamSession(id, opencodeId, cwd)
            .catch((err) =>
              console.error(
                `[ws_gateway] auto-resume (fresh after gone) stream bridge error for ${id}:`,
                err,
              ),
            );
          console.log(
            `[ws_gateway] auto-resumed (fresh, old SDK gone) session ${id} -> SDK ${opencodeId}`,
          );
        }
      } else {
        // Legacy path: no sdk_session_id persisted — create a fresh session.
        const opencodeSession = await opencodeClient.createSession(
          sessionName ?? 'Resumed',
          cwd,
        );
        if (!opencodeSession) {
          ws.send(
            JSON.stringify({
              v: 1,
              type: 'error',
              id,
              message: 'Could not resume session — Opencode engine unavailable.',
            }),
          );
          return;
        }
        opencodeId = opencodeSession.id;
        opencodeSessionMap.set(id, opencodeId);
        new AgentSessionsRepository().setSdkSessionId(id, opencodeId);
        const { streamBridge } = await import('./opencode_stream_bridge');
        streamBridge
          .streamSession(id, opencodeId, cwd)
          .catch((err) =>
            console.error(
              `[ws_gateway] auto-resume (legacy fresh) stream bridge error for ${id}:`,
              err,
            ),
          );
        console.log(
          `[ws_gateway] auto-resumed (legacy fresh) session ${id} -> SDK ${opencodeId}`,
        );
      }
    } catch (err) {
      console.error(
        `[ws_gateway] auto-resume failed for session ${id}:`,
        err,
      );
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'error',
          id,
          message: `Could not resume session: ${String(err)}`,
        }),
      );
      return;
    }
  }

  try {
    const { resolveModelForSessionTurn } = await import(
      './agent_model_resolver'
    );
    const model = agentKind
      ? await resolveModelForSessionTurn({
          agentId: agentKind,
          sessionProviderId,
          sessionModelId,
          perTurnOverride,
        })
      : undefined;

    // Guard: if model is undefined (unknown agentKind not in the
    // resolver's fallback table), surface the problem explicitly
    // instead of forwarding an undeclared model to the SDK.  The SDK
    // silently no-ops on undefined model — it stores the user message
    // part and publishes message.updated events, but never fires an
    // LLM call, leaving the UI stuck on "working" indefinitely.
    if (!model && agentKind) {
      console.error(
        `[ws_gateway] session ${id}: could not resolve model for agentKind='${agentKind}' — no route in catalog`,
      );
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'error',
          id,
          message: `Could not resolve a model for agent '${agentKind}'. Please select a model in the session settings.`,
        }),
      );
      return;
    }
    console.log(
      `[ws_gateway] session ${id}: routing turn to ${model ? `${model.providerID}/${model.modelID}` : '<no model>'}`,
    );

    // Issue #604: build optional thinking / fast-mode opts to pass through.
    // Resolution order: per-turn field overrides session-level field.
    const effectiveThinkingBudget = perTurnThinking?.budget_tokens ?? sessionThinkingBudget;
    const effectiveFastMode = perTurnFastMode ?? sessionFastMode;
    const sdkOpts = (effectiveThinkingBudget !== null || effectiveFastMode)
      ? {
          ...(effectiveThinkingBudget !== null ? { thinking: { budget_tokens: effectiveThinkingBudget } } : {}),
          ...(effectiveFastMode ? { fastMode: true } : {}),
        }
      : undefined;

    // Bind through unknown to allow passing extra opts / parts that the
    // hand-typed SDK typedef may not list — these are forwarded
    // best-effort. CRITICAL: use `.bind(opencodeClient)` so the
    // method retains its `this` binding. Bare `as unknown as` cast
    // loses `this`, and the very first line of promptAsync reads
    // `this.client` → throws `TypeError: Cannot read properties of
    // undefined (reading 'client')` on every prompt. Regression from
    // acdc835 (#604) which introduced the casted alias.
    const promptFn = opencodeClient.promptAsync.bind(
      opencodeClient,
    ) as unknown as (
      id: string,
      data: string,
      model?: { providerID: string; modelID: string },
      cwd?: string,
      opts?: Record<string, unknown>,
      parts?: Array<Record<string, unknown>>,
    ) => Promise<unknown>;
    await promptFn(opencodeId, data, model, cwd, sdkOpts, partsToForward);
  } catch (err) {
    console.error(
      `[ws_gateway] SDK prompt error for session ${id}:`,
      err,
    );
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'error',
        id,
        message: String(err),
      }),
    );
  }
}

function handleClientMessage(ws: WebSocket, raw: import('ws').RawData): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString()) as Record<string, unknown>;
  } catch {
    ws.send(JSON.stringify({ v: 1, type: 'error', message: 'invalid json' }));
    return;
  }

  switch (msg?.type) {
    case 'session.command': {
      // OPC-M3-4: handle structured slash-command dispatch.
      handleCommandFrame(ws, msg).catch((err) =>
        console.error('[ws_gateway] session.command handler error:', err),
      );
      return;
    }
    case 'session.input': {
      handleInputFrame(ws, msg).catch((err) =>
        console.error('[ws_gateway] session.input handler error:', err),
      );
      return;
    }
    case 'session.resize': {
      // PTY resize is irrelevant for SDK-backed sessions — no-op
      return;
    }
    case 'session.subscribe': {
      // No PTY buffer to replay — send empty output to acknowledge
      const id = msg.id as string | undefined;
      if (id) {
        ws.send(JSON.stringify({ v: 1, type: 'output', id, data: '', replay: true }));
      }
      return;
    }
    default:
      ws.send(JSON.stringify({ v: 1, type: 'error', message: `unknown type: ${String(msg?.type)}` }));
  }
}
