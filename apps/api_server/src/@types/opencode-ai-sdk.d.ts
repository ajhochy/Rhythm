// Type declarations for @opencode-ai/sdk
// The SDK is ESM-only and uses "exports" in package.json, which is incompatible
// with this project's CommonJS TypeScript configuration. These minimal type
// declarations provide what OpencodeClientService needs without requiring
// TypeScript to resolve the SDK's module graph.
//
// hey-api envelope model: every generated SDK method returns
//   Promise<{ data?: T; error?: unknown }>
// (ThrowOnError=false default — verified in sdk.gen.ts v1.14.49).
// All method signatures below follow that contract exactly.

declare module '@opencode-ai/sdk' {
  export function createOpencode(options?: Record<string, unknown>): Promise<{
    client: OpencodeClient;
    server: { url: string; close(): void };
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

  export type OAuthAuth = {
    type: 'oauth';
    access: string;
    refresh: string;
    expires: number;
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

  /**
   * OPC-M3-3 — CompactionPart (v1.14.49 types.gen.d.ts).
   * Emitted by the SDK as a message.part.updated event after a summarize call.
   * `auto: false` for manual summarize (triggered by the user); `true` for
   * automatic compaction when the session exceeds the context window.
   */
  export type CompactionPart = {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'compaction';
    auto: boolean;
  };

  export type Part = TextPart | ReasoningPart | ToolPart | CompactionPart;

  // ── Input part types (used in prompt / promptAsync request body) ──

  /**
   * OPC-M4-1 — FilePartInput for multimodal prompts.
   * `url` carries a data URI: `data:<mime>;base64,<payload>`.
   * Verified against @opencode-ai/sdk v1.14.49 FilePartInput interface.
   */
  export type FilePartInput = {
    id?: string;
    type: 'file';
    mime: string;
    filename?: string;
    url: string; // data:<mime>;base64,<payload>
  };

  /** Union of all valid input part types for the prompt body. */
  export type PartInput =
    | { type: 'text'; text: string }
    | FilePartInput;

  // ── Message types ──

  export type Message = {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    parts: Array<Part>;
    time: { created: number };
  };

  /**
   * AssistantMessage — the return type of session.shell (and other SDK methods
   * that create a message and return its metadata).
   * Verified against @opencode-ai/sdk dist/gen/types.gen.d.ts (v1.14.49).
   * OPC-M1-6 / issue #709.
   */
  export type AssistantMessage = {
    id: string;
    sessionID: string;
    role: 'assistant';
    time: { created: number; completed?: number };
    parentID: string;
    modelID: string;
    providerID: string;
    mode: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      reasoning: number;
      cache: { read: number; write: number };
    };
    finish?: string;
    summary?: boolean;
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
      sessionID: string;
      /**
       * Message metadata only. UpdatedEventSchema = { sessionID, info } —
       * there is NO parts field here. Parts arrive via message.part.updated.
       */
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

  export type EventMessagePartRemoved = {
    type: 'message.part.removed';
    properties: {
      sessionID: string;
      messageID: string;
      partID: string;
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
      // Opencode SSE shape: { sessionID, info: Session.Info }.
      // The `session` key is NOT present; use `info` for the full session data.
      // Verified against opencode fork session.ts CreatedEventSchema.
      sessionID: string;
      info: Session & {
        /** Present when created via the `task` tool (delegated subagent). */
        parentID?: string;
        directory?: string;
      };
    };
  };

  export type EventSessionError = {
    type: 'session.error';
    properties: {
      sessionID?: string;
      error?: Record<string, unknown>;
    };
  };

  // OPC-M3-1: emitted by opencode when working-tree diffs change for a session.
  export type EventSessionDiff = {
    type: 'session.diff';
    properties: {
      sessionID: string;
    };
  };

  export type EventFileEdited = {
    type: 'file.edited';
    properties: {
      file: string;
    };
  };

  // ── Permission event ──

  /**
   * Real SDK permission shape (v1.14.49 types.gen.d.ts `Permission`). The
   * `type` field is the tool/permission kind; `title` is the human summary;
   * `metadata` carries the tool args. There is NO `permission.asked` event —
   * the SDK emits `permission.updated` with this payload.
   */
  export type Permission = {
    id: string;
    type: string;
    pattern?: string | Array<string>;
    sessionID: string;
    messageID: string;
    callID?: string;
    title: string;
    metadata: Record<string, unknown>;
    time: { created: number };
  };

  export type EventPermissionUpdated = {
    type: 'permission.updated';
    properties: Permission;
  };

  /**
   * The RUNNING opencode binary emits `permission.asked` (confirmed from the
   * live event trace) even though the generated sdk.gen types only declare
   * `permission.updated`. Older payload shape: flat permissionID/toolName/etc.
   * The bridge handles both names + both shapes defensively.
   */
  export type EventPermissionAsked = {
    type: 'permission.asked';
    properties: {
      sessionID?: string;
      permissionID?: string;
      toolName?: string;
      args?: Record<string, unknown>;
      summary?: string;
    };
  };

  // ── Question event (AskUserQuestion handshake) ──
  //
  // opencode emits `question.asked` when the agent calls its `question` tool,
  // carrying a QuestionRequest { id, sessionID, questions, tool:{callID} }, and
  // blocks the tool until POST /question/{id}/reply. `question.replied` /
  // `question.rejected` fire on resolution. Confirmed from the running binary's
  // event definitions + the live GET /question payload. The Question API lives
  // in the SDK's v2 namespace, so these are declared here for the v1 stream.
  export type EventQuestionAsked = {
    type: 'question.asked';
    properties: {
      id?: string;
      requestID?: string;
      sessionID?: string;
      questions?: unknown[];
      tool?: { callID?: string; messageID?: string };
    };
  };

  export type EventQuestionReplied = {
    type: 'question.replied';
    properties: {
      sessionID?: string;
      requestID?: string;
      id?: string;
      answers?: string[][];
    };
  };

  export type EventQuestionRejected = {
    type: 'question.rejected';
    properties: {
      sessionID?: string;
      requestID?: string;
      id?: string;
    };
  };

  // OPC-M3-5: emitted by opencode when the todo list for a session changes.
  export type EventTodoUpdated = {
    type: 'todo.updated';
    properties: {
      sessionID: string;
      todos: Todo[];
    };
  };

  /**
   * OPC-#710 — emitted by opencode after the first exchange when it auto-titles
   * the session. `properties.info` is the full Session shape (which includes
   * `title`). Verified against @opencode-ai/sdk dist/gen/types.gen.d.ts
   * (SessionUpdatedEvent, v1.14.49).
   *
   * NOTE: the sessionID for routing is nested inside `info.id` (the SDK session
   * id), NOT in a top-level `properties.sessionID`. The bridge must extract
   * `props.info.id` to look up the local session.
   */
  export type EventSessionUpdated = {
    type: 'session.updated';
    properties: {
      info: Session;
    };
  };

  export type Event =
    | EventMessagePartUpdated
    | EventMessagePartDelta
    | EventMessageUpdated
    | EventMessageRemoved
    | EventMessagePartRemoved
    | EventSessionStatus
    | EventSessionIdle
    | EventSessionCreated
    | EventSessionUpdated
    | EventSessionError
    | EventSessionDiff
    | EventFileEdited
    | EventPermissionUpdated
    | EventPermissionAsked
    | EventQuestionAsked
    | EventQuestionReplied
    | EventQuestionRejected
    | EventTodoUpdated;

  // ── Provider types ──

  export type ProviderAuthAuthorization = {
    url: string;
    method: 'auto' | 'code';
    instructions: string;
  };

  // ── File diff type (v1.14.49) ──

  export type FileDiff = {
    file: string;
    before: string;
    after: string;
    additions: number;
    deletions: number;
  };

  // ── Todo type (v1.14.49) ──

  export type Todo = {
    id: string;
    content: string;
    status: string;
    priority: string;
  };

  // ── MCP status types (v1.14.49) ──

  export type McpStatusEntry = {
    /** 'connected' | 'disconnected' | 'failed' | 'disabled' | 'needs_auth' | … */
    status: string;
    /** Present when status === 'failed' */
    error?: string;
    [key: string]: unknown;
  };

  /** Body shape for POST /mcp (add server). */
  export type McpLocalConfigInput = {
    type: 'local';
    command: string[];
    environment?: Record<string, string>;
    enabled?: boolean;
  };

  export type McpRemoteConfigInput = {
    type: 'remote';
    url: string;
    enabled?: boolean;
    headers?: Record<string, string>;
  };

  // ── hey-api envelope alias ──
  // Every generated SDK method returns Promise<SdkEnvelope<T>>.
  // When the SDK is compiled with the `fields` option (hey-api >=0.73),
  // the underlying HTTP Response object is attached as `response` on the
  // envelope. This is present for all successful calls, including 204 void
  // responses where `data` is undefined. Used in #711 to distinguish a
  // genuine 204 No Content success from an OpenRouter silent no-op ({}).
  export type SdkEnvelope<T> = { data?: T; error?: unknown; response?: { status?: number } };

  export interface OpencodeClient {
    config: {
      providers(): Promise<SdkEnvelope<{
        providers?: Array<{
          id: string;
          models?:
            | Array<{ id: string; name?: string; limit?: { context?: number; output?: number } }>
            | Record<string, { id?: string; name?: string; limit?: { context?: number; output?: number } }>;
        }>;
      }>>;
    };
    session: {
      list(): Promise<SdkEnvelope<Array<Session>>>;
      create(options: {
        body: { parentID?: string; title?: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
      prompt(options: {
        path: { id: string };
        body: {
          messageID?: string;
          model?: { providerID: string; modelID: string };
          parts: Array<PartInput>;
          system?: string;
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<{ info: Message; parts: Array<Part> }>>;
      promptAsync(options: {
        path: { id: string };
        body: {
          messageID?: string;
          model?: { providerID: string; modelID: string };
          parts: Array<PartInput>;
          system?: string;
          /**
           * #714 — reasoning/thinking configuration for the opencode server.
           *
           * Confirmed against the opencode v1.14.40 binary (Ih zod schema):
           *   reasoningConfig: { type, budgetTokens, maxReasoningEffort, display }
           *
           * For the anthropic provider: set type:'enabled' + budgetTokens to
           * enable extended thinking. The older `thinking: { budget_tokens }` field
           * (snake_case) is NOT recognized by the server and is silently dropped.
           */
          reasoningConfig?: {
            type?: 'enabled' | 'disabled' | 'adaptive';
            budgetTokens?: number;
            maxReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
            display?: 'omitted' | 'summarized';
          };
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<void>>;
      status(options?: {
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Record<string, SessionStatus>>>;
      get(options: { path: { id: string } }): Promise<SdkEnvelope<Session>>;
      delete(options: { path: { id: string } }): Promise<SdkEnvelope<void>>;
      messages(options: {
        path: { id: string };
      }): Promise<SdkEnvelope<Array<Message>>>;
      abort(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<void>>;
      /**
       * GET /session/{id}/diff — returns a list of file diffs for the session.
       * Real SDK method name verified in sdk.gen.ts v1.14.49.
       */
      diff(options: {
        path: { id: string };
        query?: { directory?: string; messageID?: string };
      }): Promise<SdkEnvelope<Array<FileDiff>>>;
      /**
       * POST /session/{id}/command — dispatch a slash command in the session.
       * Real SDK method name verified in sdk.gen.ts v1.14.49.
       */
      command(options: {
        path: { id: string };
        body: {
          command: string;
          arguments: string;
          messageID?: string;
          agent?: string;
          model?: string;
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<{ info: Message; parts: Array<Part> }>>;
      /**
       * POST /session/{id}/revert — revert to a prior message.
       */
      revert(options: {
        path: { id: string };
        body: { messageID: string; partID?: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
      /**
       * POST /session/{id}/unrevert — restore all reverted messages.
       */
      unrevert(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
      /**
       * POST /session/{id}/summarize — summarize the session.
       */
      summarize(options: {
        path: { id: string };
        body?: { providerID: string; modelID: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<boolean>>;
      /**
       * GET /session/{id}/todo — get the todo list for the session.
       */
      todo(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Array<Todo>>>;
      /**
       * POST /session/{id}/fork — fork the session at a message.
       */
      fork(options: {
        path: { id: string };
        body?: { messageID?: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
      /**
       * GET /session/{id}/children — list child sessions.
       */
      children(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Array<Session>>>;
      /**
       * POST /session/{id}/shell — run a one-shot shell command in the session.
       *
       * Real SDK shape verified in @opencode-ai/sdk dist/gen/types.gen.d.ts
       * (SessionShellData, v1.14.49):
       *   body: { agent: string; model?: { providerID, modelID }; command: string }
       * Returns AssistantMessage on success.
       * OPC-M1-6 / issue #709.
       */
      shell(options: {
        path: { id: string };
        body: {
          agent: string;
          model?: { providerID: string; modelID: string };
          command: string;
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<AssistantMessage>>;
      /**
       * PATCH /session/{sessionID} — update session metadata.
       * Rhythm carried patch (mcp-scope): also accepts mcpAllowlist to set the
       * per-session MCP tool allowlist in the fork's DB so prompt.ts filters it.
       */
      update(options: {
        path: { sessionID: string };
        body: {
          title?: string;
          mcpAllowlist?: { servers: string[]; tools: string[] };
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
    };
    /**
     * MCP server management — client.mcp in sdk.gen.ts v1.14.49.
     */
    mcp: {
      /** GET /mcp — status map keyed by server name. */
      status(options?: {
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Record<string, McpStatusEntry>>>;
      /** POST /mcp — add a new MCP server dynamically (OPC-M4-3). */
      add(options?: {
        body?: {
          name: string;
          config: McpLocalConfigInput | McpRemoteConfigInput;
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Record<string, McpStatusEntry>>>;
      /** POST /mcp/{name}/connect */
      connect(options: {
        path: { name: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<boolean>>;
      /** POST /mcp/{name}/disconnect */
      disconnect(options: {
        path: { name: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<boolean>>;
      /**
       * client.mcp.auth in sdk.gen.ts v1.14.49.
       *
       * For remote MCP servers that require OAuth, `start` begins the OAuth
       * flow and returns the consent URL the user must open in a browser.
       * Shape verified against node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts
       * (McpAuthStartResponses → 200: { authorizationUrl: string }).
       */
      auth: {
        /** POST /mcp/{name}/auth/start — begin OAuth, return consent URL. */
        start(options: {
          path: { name: string };
          query?: { directory?: string };
        }): Promise<SdkEnvelope<{ authorizationUrl: string }>>;
      };
    };
    /**
     * POST /session/{id}/permissions/{permissionID}
     * Top-level method on OpencodeClient in sdk.gen.ts v1.14.49.
     * Method name: postSessionIdPermissionsPermissionId
     */
    postSessionIdPermissionsPermissionId(options: {
      path: { id: string; permissionID: string };
      body?: { response: 'once' | 'always' | 'reject' };
      query?: { directory?: string };
    }): Promise<SdkEnvelope<boolean>>;
    provider: {
      list(): Promise<SdkEnvelope<Array<{ id: string }>>>;
      auth(): Promise<SdkEnvelope<Array<{ id: string; methods: Array<unknown> }>>>;
      oauth: {
        authorize(options: {
          path: { id: string };
          body: { method: number };
          query?: { directory?: string };
        }): Promise<SdkEnvelope<ProviderAuthAuthorization>>;
        callback(options: {
          path: { id: string };
          body: { method: number; code?: string };
          query?: { directory?: string };
        }): Promise<SdkEnvelope<boolean>>;
      };
    };
    auth: {
      set(options: {
        path: { id: string };
        body: ApiAuth | OAuthAuth;
        query?: { directory?: string };
      }): Promise<SdkEnvelope<boolean>>;
    };
    event: {
      // NOTE: event.subscribe is the ONE endpoint that does NOT use the
      // hey-api { data, error } envelope. The real SDK returns a
      // ServerSentEventsResult = `{ stream: AsyncGenerator<Event> }` directly
      // (dist/gen/core/serverSentEvents.gen.d.ts, v1.14.49). Wrapping it in
      // SdkEnvelope was wrong and made subscribeToEvents always see a missing
      // `.data` → "No event stream available".
      subscribe(options?: { query?: { directory?: string } }): Promise<{
        stream: AsyncIterable<Event>;
      }>;
    };
    command: {
      list(options?: { query?: { directory?: string } }): Promise<
        SdkEnvelope<Array<{ name: string; description?: string }>>
      >;
    };
    /**
     * OPC-M4-4 — "List all agents" lives under the `app` namespace in the real
     * SDK: `client.app.agents(...)` (v1.14.49 sdk.gen.d.ts class App). It was
     * previously (and wrongly) declared as a top-level `client.agents(...)`,
     * which threw `client.agents is not a function` at runtime.
     * The optional `directory` query param scopes results to that cwd.
     */
    app: {
      agents(options?: { query?: { directory?: string } }): Promise<
        SdkEnvelope<Array<SdkAgent>>
      >;
    };
  }

  /**
   * OPC-M4-4 — Agent descriptor returned by GET /agent.
   * Mirrors @opencode-ai/sdk types.gen.d.ts `Agent` type (v1.14.49).
   */
  export type SdkAgent = {
    name: string;
    description?: string;
    /** 'subagent' | 'primary' | 'all' */
    mode: string;
    builtIn: boolean;
    color?: string;
    model?: { modelID: string; providerID: string };
    permission?: {
      edit?: string;
      bash?: Record<string, string>;
      webfetch?: string;
    };
  };
}
