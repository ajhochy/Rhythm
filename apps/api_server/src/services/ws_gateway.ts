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

function handleClientMessage(ws: WebSocket, raw: import('ws').RawData): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString()) as Record<string, unknown>;
  } catch {
    ws.send(JSON.stringify({ v: 1, type: 'error', message: 'invalid json' }));
    return;
  }

  switch (msg?.type) {
    case 'session.input': {
      const id = msg.id as string | undefined;
      // M4-1: accept either legacy `data: string` or new `parts: Array<...>`.
      // When `parts` is present, the first text part becomes the prompt
      // string we hand to promptAsync; file/image parts are appended as a
      // bullet list so the agent can see them. Real multimodal hand-off
      // requires the SDK's `parts` array — wired here for forward-compat,
      // gracefully degraded when the SDK doesn't support it yet.
      let data = msg.data as string | undefined;
      const partsInput = msg.parts as
        | Array<Record<string, unknown>>
        | undefined;
      if (!data && Array.isArray(partsInput)) {
        const textParts = partsInput
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text as string);
        const fileParts = partsInput.filter((p) => p.type === 'file');
        const imageParts = partsInput.filter((p) => p.type === 'image');
        const lines: string[] = [...textParts];
        for (const fp of fileParts) {
          const path = (fp.filePath ?? fp.path) as unknown;
          if (typeof path === 'string') lines.push(`@${path}`);
        }
        for (const ip of imageParts) {
          const path = (ip.filePath ?? ip.url) as unknown;
          if (typeof path === 'string') lines.push(`[image] ${path}`);
        }
        data = lines.join('\n').trim();
      }
      // M2-2: per-turn override on the WS frame, never persisted.
      const perTurnOverride = (msg.modelOverride ?? null) as {
        providerId?: string;
        modelId?: string;
      } | null;
      if (id && typeof data === 'string') {
        (async () => {
          let opencodeId = opencodeSessionMap.get(id);
          let cwd: string | undefined;
          let agentKind: string | undefined;
          let sessionName: string | undefined;
          let sessionProviderId: string | null = null;
          let sessionModelId: string | null = null;
          try {
            const session = new AgentSessionsRepository().findById(id);
            if (session) {
              cwd = session.cwd;
              agentKind = session.agentKind;
              sessionName = session.name;
              sessionProviderId = session.providerId;
              sessionModelId = session.modelId;
            }
          } catch {
            /* DB unavailable — proceed without context */
          }

          // Auto-resume: sessions persist in SQLite across api_server
          // restarts, but `opencodeSessionMap` is in-process and is wiped
          // on each boot. If the user sends input to a session that has
          // no current SDK mapping, transparently create a fresh SDK
          // session, register the mapping, start the stream bridge, and
          // continue with the prompt — instead of silently dropping it.
          if (!opencodeId) {
            if (!cwd) {
              console.warn(
                `[ws_gateway] session.input for unknown session ${id} (no DB row); dropping`,
              );
              return;
            }
            try {
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
                    message:
                      'Could not resume session — Opencode engine unavailable.',
                  }),
                );
                return;
              }
              opencodeId = opencodeSession.id;
              opencodeSessionMap.set(id, opencodeId);
              const { streamBridge } = await import(
                './opencode_stream_bridge'
              );
              streamBridge
                .streamSession(id, opencodeId, cwd)
                .catch((err) =>
                  console.error(
                    `[ws_gateway] auto-resume stream bridge error for ${id}:`,
                    err,
                  ),
                );
              console.log(
                `[ws_gateway] auto-resumed session ${id} -> SDK ${opencodeId}`,
              );
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
            await opencodeClient.promptAsync(opencodeId, data, model, cwd);
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
        })();
      }
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
