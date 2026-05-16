// Type declarations for @opencode-ai/sdk
// The SDK is ESM-only and uses "exports" in package.json, which is incompatible
// with this project's CommonJS TypeScript configuration. These minimal type
// declarations provide what OpencodeClientService needs without requiring
// TypeScript to resolve the SDK's module graph.
//
// Based on @opencode-ai/sdk v0.x — types.gen.d.ts SDK-generated types.

declare module '@opencode-ai/sdk' {
  export function createOpencode(options?: Record<string, unknown>): Promise<{
    client: OpencodeClient;
  }>;

  export function createOpencodeClient(config?: {
    baseUrl?: string;
    directory?: string;
  }): OpencodeClient;

  // ── Auth credential types ──

  export type ApiAuth = {
    type: 'api';
    key: string;
    metadata?: Record<string, string>;
  };

  export type OAuth = {
    type: 'oauth';
    refresh: string;
    access: string;
    expires: number;
  };

  export type WellKnownAuth = {
    type: 'wellknown';
    key: string;
    token: string;
  };

  export type Auth = ApiAuth | OAuth | WellKnownAuth;

  // ── Session types ──

  export type Session = {
    id: string;
    projectID: string;
    directory: string;
    title: string;
    version: string;
    time: { created: number; updated: number };
  };

  // ── Part types ──

  export type TextPart = {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'text';
    text: string;
  };

  export type ReasoningPart = {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'reasoning';
    signature: string;
    content?: string;
  };

  export type ToolPart = {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'tool';
    name: string;
    input: unknown;
    result?: unknown;
  };

  export type Part = TextPart | ReasoningPart | ToolPart;

  // ── Message types ──

  export type Message = {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    parts: Array<Part>;
    time: { created: number };
  };

  // ── Event types ──

  export type EventMessagePartUpdated = {
    type: 'message.part.updated';
    properties: {
      part: Part;
      delta?: string;
    };
  };

  export type EventMessageUpdated = {
    type: 'message.updated';
    properties: {
      info: Message;
    };
  };

  export type EventMessageRemoved = {
    type: 'message.removed';
    properties: {
      sessionID: string;
      messageID: string;
    };
  };

  export type EventMessagePartDelta = {
    type: 'message.part.delta';
    properties: {
      sessionID: string;
      messageID: string;
      partID: string;
      field: string;
      delta: string;
    };
  };

  export type SessionStatus =
    | { type: 'idle' }
    | { type: 'retry'; attempt: number; message: string; next: number }
    | { type: 'busy' };

  export type EventSessionStatus = {
    type: 'session.status';
    properties: {
      sessionID: string;
      status: SessionStatus;
    };
  };

  export type EventSessionIdle = {
    type: 'session.idle';
    properties: {
      sessionID: string;
    };
  };

  export type EventSessionCreated = {
    type: 'session.created';
    properties: {
      session: Session;
    };
  };

  export type EventSessionError = {
    type: 'session.error';
    properties: {
      sessionID?: string;
      error?: Record<string, unknown>;
    };
  };

  export type EventFileEdited = {
    type: 'file.edited';
    properties: {
      file: string;
    };
  };

  // ── Permission event ──

  export type EventPermissionAsked = {
    type: 'permission.asked';
    properties: {
      sessionID: string;
      permissionID: string;
      toolName: string;
      args?: Record<string, unknown>;
      summary?: string;
    };
  };

  export type Event =
    | EventMessagePartUpdated
    | EventMessagePartDelta
    | EventMessageUpdated
    | EventMessageRemoved
    | EventSessionStatus
    | EventSessionIdle
    | EventSessionCreated
    | EventSessionError
    | EventFileEdited
    | EventPermissionAsked;

  // ── Provider types ──

  export type ProviderAuthAuthorization = {
    url: string;
    method: 'auto' | 'code';
    instructions: string;
  };

  // ── OpencodeClient ──

  export interface OpencodeClient {
    config: {
      providers(): Promise<{
        providers?: Array<{
          id: string;
          models?: Array<{ id: string; name?: string }>;
        }>;
      }>;
    };
    session: {
      list(): Promise<Array<Session>>;
      create(options: {
        body: { parentID?: string; title?: string };
        query?: { directory?: string };
      }): Promise<Session>;
      prompt(options: {
        path: { id: string };
        body: {
          messageID?: string;
          model?: { providerID: string; modelID: string };
          parts: Array<{ type: 'text'; text: string }>;
          system?: string;
        };
        query?: { directory?: string };
      }): Promise<{ info: Message; parts: Array<Part> }>;
      promptAsync(options: {
        path: { id: string };
        body: {
          messageID?: string;
          model?: { providerID: string; modelID: string };
          parts: Array<{ type: 'text'; text: string }>;
          system?: string;
        };
        query?: { directory?: string };
      }): Promise<void>;
      status(options?: {
        query?: { directory?: string };
      }): Promise<Record<string, SessionStatus>>;
      get(options: { path: { id: string } }): Promise<Session>;
      delete(options: { path: { id: string } }): Promise<void>;
      messages(options: {
        path: { id: string };
      }): Promise<Array<Message>>;
      abort(options: { path: { id: string } }): Promise<void>;
      /**
       * Respond to a pending permission request.
       * `permissionID` is the ID from the `permission.asked` event.
       */
      permission?: {
        respond(options: {
          path: { id: string; permissionId: string };
          body: { decision: 'accept' | 'deny' };
        }): Promise<void>;
      };
    };
    provider: {
      list(): Promise<Array<{ id: string }>>;
      auth(): Promise<Array<{ id: string; methods: Array<unknown> }>>;
      oauth: {
        authorize(options: {
          path: { id: string };
          body: { method: number };
          query?: { directory?: string };
        }): Promise<ProviderAuthAuthorization>;
        callback(options: {
          path: { id: string };
          body: { method: number; code?: string };
          query?: { directory?: string };
        }): Promise<boolean>;
      };
    };
    auth: {
      set(options: {
        path: { id: string };
        body: ApiAuth;
        query?: { directory?: string };
      }): Promise<boolean>;
    };
    event: {
      subscribe(options?: { query?: { directory?: string } }): Promise<{
        stream: AsyncIterable<Event>;
      }>;
    };
  }
}
