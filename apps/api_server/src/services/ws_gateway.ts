import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { appEvents } from '../utils/app_events';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import * as ptyRunner from './pty_runner';

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
      // DB may not be ready yet (e.g. tests) — ignore
    }

    // Replay ring-buffer output for all currently-live PTY sessions
    // so a freshly connecting client sees recent terminal output.
    for (const sessionId of ptyRunner.listAlive()) {
      const buffered = ptyRunner.getBuffer(sessionId);
      if (buffered.length > 0) {
        try {
          ws.send(
            JSON.stringify({ v: 1, type: 'output', id: sessionId, data: buffered, replay: true }),
          );
        } catch {
          // ignore
        }
      }
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
      const data = msg.data as string | undefined;
      if (id && typeof data === 'string') {
        ptyRunner.sendInput(id, data);
      }
      return;
    }
    case 'session.resize': {
      const id = msg.id as string | undefined;
      const cols = msg.cols as number | undefined;
      const rows = msg.rows as number | undefined;
      if (id && typeof cols === 'number' && typeof rows === 'number') {
        ptyRunner.resize(id, cols, rows);
      }
      return;
    }
    case 'session.subscribe': {
      const id = msg.id as string | undefined;
      if (id) {
        const buffered = ptyRunner.getBuffer(id);
        ws.send(
          JSON.stringify({ v: 1, type: 'output', id, data: buffered, replay: true }),
        );
      }
      return;
    }
    default:
      ws.send(JSON.stringify({ v: 1, type: 'error', message: `unknown type: ${String(msg?.type)}` }));
  }
}
