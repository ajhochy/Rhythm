import type { GatewayMode } from '.';

export interface MessageThreadParticipant { id: number; name: string; email: string }
export interface MessageThread { id: number; title: string; threadType: 'direct' | 'group'; taskId: string | null; createdBy: number | null; createdAt: string; updatedAt: string; lastMessage?: string | null; unreadCount: number; isUnread: boolean; participants: MessageThreadParticipant[] }
export interface Message { id: number; threadId: number; senderId: number | null; senderName: string; body: string; createdAt: string }
export interface CreateThreadInput { participantIds: number[]; threadType?: 'direct' | 'group'; title?: string; taskId?: string | null }

export interface MessagesGateway {
  readonly mode: GatewayMode;
  threads(taskId?: string): Promise<MessageThread[]>;
  createThread(input: CreateThreadInput): Promise<MessageThread>;
  messages(threadId: number): Promise<Message[]>;
  sendMessage(threadId: number, input: { body: string }): Promise<Message>;
  markRead(threadId: number): Promise<void>;
  markUnread(threadId: number): Promise<void>;
  // The recipient picker for a new conversation needs the workspace directory. Without it the live
  // picker is permanently empty and a user cannot start a conversation at all. `GET /users` is
  // declared at apps/api_server/src/app.ts:144 (usersRouter) and returns {id,name,email} per
  // apps/api_server/src/models/user.ts:1-7 — the same numeric ids MessageThreadParticipant uses.
  users(): Promise<MessageThreadParticipant[]>;
}

export class MessagesGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const failureText = (status: number, operation: string) => ({ 0: 'Messages service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Message thread not found' })[status] ?? `${operation} failed (${status})`;
async function response<T>(operation: string, pending: Promise<Response>): Promise<T> { try { const result = await pending; if (!result.ok) throw new MessagesGatewayError(result.status, failureText(result.status, operation)); return result.status === 204 ? undefined as T : await result.json() as T; } catch (error) { if (error instanceof MessagesGatewayError) throw error; throw new MessagesGatewayError(0, failureText(0, operation)); } }

export function createFixtureMessagesGateway(_fetcher?: typeof fetch): MessagesGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new MessagesGatewayError(0, 'Fixture messages gateway is unsupported'); };
  return { mode: 'fixture', threads: unsupported, createThread: unsupported, messages: unsupported, sendMessage: unsupported, markRead: unsupported, markUnread: unsupported, users: unsupported };
}

export function createLiveMessagesGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): MessagesGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit messages token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  return {
    mode: 'live',
    // Mounted at /message-threads in apps/api_server/src/app.ts:145; declared in apps/api_server/src/routes/messages_routes.ts:9-14.
    threads: (taskId) => response<MessageThread[]>('Load message threads', request(`/message-threads${taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''}`)),
    createThread: (input) => response<MessageThread>('Create message thread', request('/message-threads', { method: 'POST', body: json(input) })),
    messages: (threadId) => response<Message[]>('Load messages', request(`/message-threads/${encodeURIComponent(threadId)}/messages`)),
    sendMessage: (threadId, input) => response<Message>('Send message', request(`/message-threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: json(input) })),
    markRead: (threadId) => response<void>('Mark thread read', request(`/message-threads/${encodeURIComponent(threadId)}/read`, { method: 'POST' })),
    markUnread: (threadId) => response<void>('Mark thread unread', request(`/message-threads/${encodeURIComponent(threadId)}/unread`, { method: 'POST' })),
    // Mounted at /users in apps/api_server/src/app.ts:144; shape {id,name,email} per
    // apps/api_server/src/models/user.ts:1-7 — the same numeric ids MessageThreadParticipant uses.
    // Without this the live recipient picker is permanently empty and no user can start a new
    // conversation; the wiring agent correctly reported that gap rather than reaching for the
    // test-only token to fetch /users directly.
    users: () => response<MessageThreadParticipant[]>('Load workspace directory', request('/users')),
  };
}
