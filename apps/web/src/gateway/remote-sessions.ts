// #1374 slice 2 — web-remote-sessions-gateway.
//
// Talks only to window.rhythmShell.remoteEnvironments (apps/electron/src/remote-environments.mjs),
// which is the sole holder of the relay Device token. This module never sees that token: it sends
// opaque {method,path,body} requests and gets back {state,status,body} — the same shape the desktop
// custody layer already enforces server-side allowlisting for.
//
// Reuses the existing transcript reducer (./transcript-reducer.ts) for message/part de-duplication:
// folding the same wire event twice through applyTranscriptEvent is already idempotent (upsert by
// id), which is exactly what "re-subscribe after reconnect without duplicating" needs — no separate
// de-dupe cache required here.
import type { GatewayMode } from '.';
import { mapMessage, type RichTranscriptMessage, type SessionWireEvent } from './sessions';
import { applyTranscriptEvent, emptyTranscript, mergeTranscriptPage, type TranscriptState } from './transcript-reducer';

export interface RemoteEnvironmentSummary {
  id: string;
  name: string;
  status: 'online' | 'offline';
  historyAvailable: boolean;
}

// The engine's own session/message shapes are intentionally NOT re-typed here; they pass through
// as opaque records the same way apps/web/src/gateway/sessions.ts's raw SDK types do.
export type RemoteSessionSummary = Record<string, unknown> & { id: string };

export type RemoteConnectResult =
  | { state: 'connected'; environmentId: string; deviceId: string }
  | { state: 'offline' | 'signed_out' | 'error' | 'disabled' | 'not_connected' };

export type RemotePageResult = { messages: RichTranscriptMessage[]; pageInfo: { nextCursor: string | null; hasMore: boolean } };

export type RemoteSessionSocket = { close(): void };

const UNSUPPORTED_OPS = ['create', 'hardDelete', 'createWorktree', 'updateProfile', 'browseFiles'] as const;
export type RemoteUnsupportedOp = (typeof UNSUPPORTED_OPS)[number];

export class RemoteSessionsGatewayError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** The exact surface apps/electron/src/preload.cjs exposes as window.rhythmShell.remoteEnvironments. */
export interface RemoteEnvironmentsBridge {
  readonly enabled: boolean;
  list(): Promise<{ state: string; environments?: RemoteEnvironmentSummary[] }>;
  connect(environmentId: string): Promise<{ state: string; environmentId?: string; deviceId?: string }>;
  disconnect(): Promise<void>;
  request(request: { method: string; path: string; body?: unknown; headers?: Record<string, string> }):
    Promise<{ state: string; status?: number; body?: string; headers?: Record<string, string> }>;
  subscribe(sessionId: string, onChunk: (chunk: string) => void, onEnd?: () => void):
    Promise<{ state: string; unsubscribe?: () => Promise<void> }>;
}

export interface RemoteSessionsGateway {
  readonly mode: GatewayMode;
  readonly enabled: boolean;
  listEnvironments(): Promise<RemoteEnvironmentSummary[]>;
  connect(environmentId: string): Promise<RemoteConnectResult>;
  disconnect(): Promise<void>;
  list(): Promise<RemoteSessionSummary[]>;
  detail(sessionId: string): Promise<RemotePageResult>;
  pageOlder(sessionId: string, cursor: string): Promise<RemotePageResult>;
  connectSession(sessionId: string, onUpdate: (messages: RichTranscriptMessage[], event: SessionWireEvent) => void): RemoteSessionSocket;
  prompt(sessionId: string, text: string, clientMessageId?: string): Promise<{ clientMessageId: string }>;
  cancel(sessionId: string): Promise<void>;
  replyPermission(permissionId: string, reply: 'once' | 'always' | 'reject'): Promise<void>;
  replyQuestion(questionId: string, answers: string[][]): Promise<void>;
  create(): Promise<never>;
  hardDelete(): Promise<never>;
  createWorktree(): Promise<never>;
  updateProfile(): Promise<never>;
  browseFiles(): Promise<never>;
}

function unsupported(op: RemoteUnsupportedOp): Promise<never> {
  return Promise.reject(new RemoteSessionsGatewayError('remote_unsupported', `Remote sessions do not support ${op}`));
}

/** Minimal SSE framer: buffers across chunk boundaries and yields one JSON payload per `data:` frame. */
function createSseFramer(onEvent: (event: SessionWireEvent) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let boundary: number;
    // eslint-disable-next-line no-cond-assign
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
      const dataLines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart());
      if (!dataLines.length) continue;
      try {
        const parsed = JSON.parse(dataLines.join('\n'));
        if (parsed && typeof parsed === 'object') onEvent(parsed as SessionWireEvent);
      } catch { /* malformed frame from a slow/partial relay write; skip it, the next frame recovers */ }
    }
  };
}

function parsePage(body: string | undefined, headers: Record<string, string> | undefined): { rows: unknown[]; nextCursor: string | null } {
  let rows: unknown[] = [];
  try { const parsed = JSON.parse(body ?? '[]'); if (Array.isArray(parsed)) rows = parsed; } catch { /* treat as an empty page */ }
  return { rows, nextCursor: headers?.['x-next-cursor'] ?? null };
}

export function createFixtureRemoteSessionsGateway(): RemoteSessionsGateway {
  const fixtureUnsupported = async (): Promise<never> => {
    throw new RemoteSessionsGatewayError('remote_unsupported', 'Fixture remote sessions gateway is unsupported');
  };
  return {
    mode: 'fixture',
    enabled: false,
    listEnvironments: async () => [],
    connect: async () => ({ state: 'disabled' }),
    disconnect: async () => {},
    list: async () => [],
    detail: async () => ({ messages: [], pageInfo: { nextCursor: null, hasMore: false } }),
    pageOlder: async () => ({ messages: [], pageInfo: { nextCursor: null, hasMore: false } }),
    connectSession: () => ({ close() {} }),
    prompt: fixtureUnsupported,
    cancel: fixtureUnsupported,
    replyPermission: fixtureUnsupported,
    replyQuestion: fixtureUnsupported,
    create: () => unsupported('create'),
    hardDelete: () => unsupported('hardDelete'),
    createWorktree: () => unsupported('createWorktree'),
    updateProfile: () => unsupported('updateProfile'),
    browseFiles: () => unsupported('browseFiles'),
  };
}

export function createLiveRemoteSessionsGateway(bridge: RemoteEnvironmentsBridge | undefined): RemoteSessionsGateway {
  const enabled = bridge?.enabled === true;
  const transcripts = new Map<string, TranscriptState>();
  const clientMessageIds = new Map<string, string>();
  // Best-effort project scoping. The relay's requireMobileProjectScope (apps/api_server/src/
  // services/mobile_project_scope.ts) falls back to the server's default/no-project session scope
  // when X-Rhythm-Project-ID is absent, rather than 400ing — correct for this v1 (there is no
  // project picker in the remote-attach UI yet). Once a session's project id IS known (from a row
  // returned by list()), thread it through so a multi-project primary Mac still resolves that
  // session's real scope instead of silently falling back.
  const sessionProjectIds = new Map<string, string>();
  let activeSessionId: string | undefined;
  const projectHeaders = (sessionId: string | undefined): Record<string, string> | undefined => {
    const projectId = sessionId ? sessionProjectIds.get(sessionId) : undefined;
    return projectId ? { 'X-Rhythm-Project-ID': projectId } : undefined;
  };

  const call = async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    if (!bridge || !enabled) throw new RemoteSessionsGatewayError('remote_disabled', 'Remote attach is disabled');
    const result = await bridge.request({ method, path, body, headers });
    if (result.state === 'revoked') throw new RemoteSessionsGatewayError('remote_revoked', 'The remote grant was revoked');
    if (result.state === 'not_connected') throw new RemoteSessionsGatewayError('remote_not_connected', 'No remote environment is connected');
    if (result.state === 'disabled') throw new RemoteSessionsGatewayError('remote_disabled', 'Remote attach is disabled');
    if (result.status === 409) throw new RemoteSessionsGatewayError('remote_busy', 'This session is busy on another device');
    if (result.state !== 'ok' || (result.status ?? 200) >= 300) {
      throw new RemoteSessionsGatewayError('remote_request_failed', `Remote request failed (${result.status ?? 'unknown'})`);
    }
    return result;
  };

  const stateFor = (sessionId: string): TranscriptState => transcripts.get(sessionId) ?? emptyTranscript();

  const fetchPage = async (sessionId: string, cursor: string | undefined, older: boolean): Promise<RemotePageResult> => {
    activeSessionId = sessionId;
    // `before` (not `cursor`) is the real relay/OpenCode pagination param for this route — see
    // apps/electron/src/remote-environments.mjs's ALLOWED_REQUESTS comment for the server-side
    // trace. The allowlist there rejects any other query key, so this name must stay in sync.
    const query = cursor ? `?before=${encodeURIComponent(cursor)}` : '';
    const result = await call('GET', `/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/message${query}`, undefined, projectHeaders(sessionId));
    const { rows, nextCursor } = parsePage(result.body, result.headers);
    const page = rows.map((row) => mapMessage(row));
    const next = mergeTranscriptPage(stateFor(sessionId), page, { mode: older ? 'merge' : 'replace', older, hasMore: nextCursor !== null, nextCursor });
    transcripts.set(sessionId, next);
    return { messages: next.messages, pageInfo: { nextCursor: next.cursor ?? null, hasMore: next.hasMore ?? false } };
  };

  return {
    mode: 'live',
    enabled,

    async listEnvironments() {
      if (!bridge || !enabled) return [];
      const result = await bridge.list();
      return result.state === 'ok' ? result.environments ?? [] : [];
    },

    async connect(environmentId) {
      if (!bridge || !enabled) return { state: 'disabled' };
      const result = await bridge.connect(environmentId);
      if (result.state === 'connected' && result.environmentId && result.deviceId) {
        return { state: 'connected', environmentId: result.environmentId, deviceId: result.deviceId };
      }
      return { state: (['offline', 'signed_out', 'error', 'disabled', 'not_connected'] as const).includes(result.state as never) ? (result.state as 'offline' | 'signed_out' | 'error' | 'disabled' | 'not_connected') : 'error' };
    },

    async disconnect() {
      transcripts.clear();
      clientMessageIds.clear();
      await bridge?.disconnect();
    },

    async list() {
      const result = await call('GET', '/mobile-gateway/opencode/experimental/session');
      try {
        const parsed = JSON.parse(result.body ?? '[]');
        const rows: RemoteSessionSummary[] = Array.isArray(parsed) ? parsed.filter((row): row is RemoteSessionSummary => row && typeof row.id === 'string') : [];
        for (const row of rows) {
          const projectId = (row as Record<string, unknown>).projectId;
          if (typeof projectId === 'string' && projectId) sessionProjectIds.set(row.id, projectId);
        }
        return rows;
      } catch { return []; }
    },

    detail: (sessionId) => fetchPage(sessionId, undefined, false),
    pageOlder: (sessionId, cursor) => fetchPage(sessionId, cursor, true),

    connectSession(sessionId, onUpdate) {
      activeSessionId = sessionId;
      let closed = false;
      let unsubscribe: (() => Promise<void>) | undefined;
      const feed = createSseFramer((event) => {
        if (closed) return;
        const next = applyTranscriptEvent(stateFor(sessionId), event);
        transcripts.set(sessionId, next);
        onUpdate(next.messages, event);
      });
      const attach = () => {
        if (closed || !bridge) return;
        void bridge.subscribe(
          sessionId,
          feed,
          () => { if (!closed) attach(); }, // the relay/uplink dropped the stream; reconnect (fold is idempotent)
        ).then((result) => {
          // close() may have already run while this IPC round-trip was in flight (a fast session
          // switch closes the old socket well before its own subscribe() resolves). Stashing
          // `result.unsubscribe` in that case would leave it never invoked — a live relay SSE
          // stream and its main-process fetch loop would keep running past this socket's own
          // lifetime. Tear it down immediately instead of storing it.
          if (closed) { void result.unsubscribe?.(); return; }
          unsubscribe = result.unsubscribe;
        });
      };
      if (bridge && enabled) attach();
      return {
        close() {
          if (closed) return; // idempotent: a second close() must not re-invoke unsubscribe
          closed = true;
          void unsubscribe?.();
        },
      };
    },

    async prompt(sessionId, text, clientMessageId) {
      activeSessionId = sessionId;
      const messageID = clientMessageId ?? `web-${crypto.randomUUID()}`;
      clientMessageIds.set(sessionId, messageID);
      await call('POST', `/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        messageID, parts: [{ type: 'text', text }],
      }, projectHeaders(sessionId));
      return { clientMessageId: messageID };
    },

    async cancel(sessionId) {
      await call('POST', `/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/abort`, undefined, projectHeaders(sessionId));
    },

    async replyPermission(permissionId, reply) {
      await call('POST', `/mobile-gateway/opencode/permission/${encodeURIComponent(permissionId)}/reply`, { reply }, projectHeaders(activeSessionId));
    },

    async replyQuestion(questionId, answers) {
      await call('POST', `/mobile-gateway/opencode/question/${encodeURIComponent(questionId)}/reply`, { answers }, projectHeaders(activeSessionId));
    },

    create: () => unsupported('create'),
    hardDelete: () => unsupported('hardDelete'),
    createWorktree: () => unsupported('createWorktree'),
    updateProfile: () => unsupported('updateProfile'),
    browseFiles: () => unsupported('browseFiles'),
  };
}
