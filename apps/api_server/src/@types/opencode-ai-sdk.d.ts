// Type declarations for @opencode-ai/sdk
//
// TRANSITIONAL SHIM (#1132 interim scope). The SDK is ESM-only with an
// "exports" map, which classic/Node10 TS module resolution (this project's
// "module": "commonjs") can't resolve for the bare specifier `@opencode-ai/sdk`
// — but it CAN resolve concrete deep paths like
// `@opencode-ai/sdk/dist/gen/types.gen` (Node10 resolution ignores "exports").
// So: leaf data shapes that are structurally identical to the real installed
// v1.14.49 generated types are re-exported from that deep path below. Shapes
// that are genuinely fork-only (not in the official build) or where the real
// generated shape has drifted from what this codebase's consumers depend on
// (e.g. flat `Message.parts`, `ToolPart.name/input/result`) stay hand-written
// here, verified against the live fork engine's actual wire payloads.
//
// The full flip — building the fork's own SDK dist and deleting this file
// entirely in favor of a thin re-export shim — is deferred to the
// fork-rebase-boundary PR (see docs/ai/decisions/2026-07-24-1132-interim-sdk-shim.md).
//
// hey-api envelope model: every generated SDK method returns
//   Promise<{ data?: T; error?: unknown }>
// (ThrowOnError=false default). All method signatures below follow that
// contract exactly.

declare module '@opencode-ai/sdk' {
  // ── Re-exported verbatim from the real installed @opencode-ai/sdk@1.14.49
  // generated types (dist/gen/types.gen.d.ts) — structurally identical (or a
  // safe optional-fields superset) to what this file previously hand-declared.
  export type {
    FileDiff,
    Todo,
    ProviderAuthAuthorization,
    SessionStatus,
    Permission,
    Pty,
    CompactionPart,
    Session,
    ApiAuth,
    OAuth,
    WellKnownAuth,
    Auth,
    EventFileEdited,
    EventSessionCompacted,
    EventPermissionUpdated,
    EventTodoUpdated,
    EventSessionDiff,
    EventMessageRemoved,
    EventMessagePartRemoved,
    EventSessionStatus,
    EventSessionIdle,
    EventSessionCreated,
    EventSessionUpdated,
  } from '@opencode-ai/sdk/dist/gen/types.gen';

  import type { OAuth as OAuthCred } from '@opencode-ai/sdk/dist/gen/types.gen';
  /** Legacy alias — the real generated type is named `OAuth`, not `OAuthAuth`. */
  export type OAuthAuth = OAuthCred;

  export function createOpencode(options?: Record<string, unknown>): Promise<{
    client: OpencodeClient;
    server: { url: string; close(): void };
  }>;

  export function createOpencodeClient(config?: {
    baseUrl?: string;
    directory?: string;
  }): OpencodeClient;

  // ── Part types ──
  // NOT re-exported: the real generated ToolPart/ReasoningPart shapes
  // (callID/tool/state, text/metadata/time) don't match the flat shapes this
  // codebase actually parses off the live fork's wire events.

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

  export type Part = TextPart | ReasoningPart | ToolPart | CompactionPart;

  // ── Input part types (used in prompt / promptAsync request body) ──

  /** `url` carries a data URI: `data:<mime>;base64,<payload>`. */
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
  // NOT re-exported: the real generated `Message = UserMessage | AssistantMessage`
  // has no flat `.parts` field at all (parts arrive separately via
  // message.part.updated). This codebase's Message/AssistantMessage model the
  // flat shape the live fork bridge actually assembles and consumes.

  export type Message = {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    parts: Array<Part>;
    time: { created: number };
  };

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

  // ── Event types (fork-only / diverged from the official build) ──

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
      /** UpdatedEventSchema = { sessionID, info } — no `parts` here. */
      info: Message;
    };
  };

  /** Fork-only: the running opencode binary emits per-field deltas the
   * official build doesn't declare. */
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

  export type EventSessionError = {
    type: 'session.error';
    properties: {
      sessionID?: string;
      error?: Record<string, unknown>;
    };
  };

  /**
   * Fork-only: the RUNNING opencode binary emits `permission.asked` (confirmed
   * from the live event trace) even though the official generated types only
   * declare `permission.updated`. Older payload shape: flat
   * permissionID/toolName/etc. The bridge handles both names + both shapes
   * defensively.
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

  // ── Question events (fork-only; AskUserQuestion handshake) ──
  //
  // opencode emits `question.asked` when the agent calls its `question` tool,
  // carrying a QuestionRequest { id, sessionID, questions, tool:{callID} }, and
  // blocks the tool until POST /question/{id}/reply. `question.replied` /
  // `question.rejected` fire on resolution. These are declared here for the
  // v1 stream even though the Question API itself lives in the SDK's v2
  // namespace (see the `@opencode-ai/sdk/v2/client` module below).
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
    | EventSessionCompacted
    | EventFileEdited
    | EventPermissionUpdated
    | EventPermissionAsked
    | EventQuestionAsked
    | EventQuestionReplied
    | EventQuestionRejected
    | EventTodoUpdated;

  // ── hey-api envelope alias ──
  // Every generated SDK method returns Promise<SdkEnvelope<T>>. When compiled
  // with the `fields` option (hey-api >=0.73), the underlying HTTP Response
  // object is attached as `response` on the envelope — present even for a
  // genuine 204 No Content success (used in #711 to distinguish that from an
  // OpenRouter silent no-op `{}`).
  export type SdkEnvelope<T> = { data?: T; error?: unknown; response?: { status?: number } };

  // ── MCP status / config-input types ──
  // NOT re-exported: the real `McpStatus` is a discriminated union
  // (connected/disabled/failed/needs_auth/needs_client_registration); this
  // codebase reads a flat `{status, error?}` shape off the wire instead. The
  // `*ConfigInput` names (vs. real `McpLocalConfig`/`McpRemoteConfig`) also
  // distinguish the POST /mcp request-body shape from the config-file shape.

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
           * #714 — reasoning/thinking configuration. Confirmed against the
           * opencode v1.14.40 binary (Ih zod schema). The older
           * `thinking: { budget_tokens }` field (snake_case) is silently
           * dropped by the server — not recognized.
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
      /** GET /session/{id}/diff — returns a list of file diffs for the session. */
      diff(options: {
        path: { id: string };
        query?: { directory?: string; messageID?: string };
      }): Promise<SdkEnvelope<Array<FileDiff>>>;
      /** POST /session/{id}/command — dispatch a slash command in the session. */
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
      /** POST /session/{id}/revert — revert to a prior message. */
      revert(options: {
        path: { id: string };
        body: { messageID: string; partID?: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
      /** POST /session/{id}/unrevert — restore all reverted messages. */
      unrevert(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
      /** POST /session/{id}/summarize — summarize the session. */
      summarize(options: {
        path: { id: string };
        body?: { providerID: string; modelID: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<boolean>>;
      /** GET /session/{id}/todo — get the todo list for the session. */
      todo(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Array<Todo>>>;
      /** POST /session/{id}/fork — fork the session at a message. */
      fork(options: {
        path: { id: string };
        body?: { messageID?: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
      /** GET /session/{id}/children — list child sessions. */
      children(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Array<Session>>>;
      /**
       * POST /session/{id}/shell — run a one-shot shell command in the
       * session. Returns AssistantMessage on success. OPC-M1-6 / issue #709.
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
       * PATCH /session/{id} — update session metadata. Note: the fork's
       * UpdatePayload also accepts `mcpAllowlist` (mcp-scope patch), but that
       * field is sent via direct fetch (updateSessionAllowlist) rather than
       * this SDK method to avoid SDK body-type constraints.
       */
      update(options: {
        path: { id: string };
        body?: {
          title?: string;
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Session>>;
    };
    /** MCP server management — client.mcp in sdk.gen.ts v1.14.49. */
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
       * For remote MCP servers that require OAuth, `start` begins the OAuth
       * flow and returns the consent URL the user must open in a browser.
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
      // hey-api { data, error } envelope. The real SDK returns
      // `{ stream: AsyncGenerator<Event> }` directly.
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
     * SDK: `client.app.agents(...)`. The optional `directory` query param
     * scopes results to that cwd.
     */
    app: {
      agents(options?: { query?: { directory?: string } }): Promise<
        SdkEnvelope<Array<SdkAgent>>
      >;
    };
    /**
     * OCU-27 (#1068) — PTY session management, `client.pty` in the real
     * @opencode-ai/sdk@1.14.49 sdk.gen.d.ts (class `Pty`).
     */
    pty: {
      /** POST /pty — create a new PTY session. */
      create(options?: {
        body?: {
          command?: string;
          args?: string[];
          cwd?: string;
          title?: string;
          env?: Record<string, string>;
        };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Pty>>;
      /** PATCH /pty/{id} — update a PTY session's title and/or size. */
      update(options: {
        path: { id: string };
        body?: { title?: string; size?: { rows: number; cols: number } };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<Pty>>;
      /** DELETE /pty/{id} — remove a PTY session. */
      remove(options: {
        path: { id: string };
        query?: { directory?: string };
      }): Promise<SdkEnvelope<boolean>>;
    };
  }

  /**
   * OPC-M4-4 — Agent descriptor returned by GET /agent. Fork-only: the real
   * generated `Agent` type requires `permission.bash` and doesn't support
   * arbitrary custom permission keys; the engine actually supports ~17 keys
   * (read, edit, glob, grep, list, bash, task, external_directory, todowrite,
   * question, webfetch, websearch, repo_clone, repo_overview, lsp, doom_loop,
   * skill, plus any custom key), so this keeps an index signature.
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
      [key: string]: string | Record<string, string> | undefined;
    };
  };
}

/**
 * OCU-27 (#1068) — the `/v2` export of the SAME @opencode-ai/sdk@1.14.49
 * dependency. The official v2 build (dist/v2/gen/{sdk,types}.gen.d.ts) DOES
 * cover the Question API and skill listing now, but as a class-based,
 * generic `Options<Data>`/`RequestResult<Responses,Errors,...>` surface —
 * not a drop-in replacement for the flat, minimal facade this codebase's
 * `opencode_client_service.ts` actually calls (same wire requests, simpler
 * client-side types). Kept fork-only/hand-written for that reason.
 *
 * `mcpAllowlist`/`skillAllowlist` and `skill.reload`/`config.reload` are NOT
 * declared here — those only exist in the fork's own regenerated v2 schema
 * (#1067), which has no consumable (built) form yet. Those direct-fetch
 * shims stay as-is.
 */
declare module '@opencode-ai/sdk/v2/client' {
  export function createOpencodeClient(config?: { baseUrl?: string }): V2OpencodeClient;

  type V2Envelope<T> = { data?: T; error?: unknown };

  export type QuestionOption = { label: string; value?: string };
  export type QuestionInfo = {
    question: string;
    header: string;
    options: Array<QuestionOption>;
    multiple?: boolean;
    custom?: boolean;
  };
  export type QuestionTool = { messageID: string; callID: string };
  export type QuestionRequest = {
    id: string;
    sessionID: string;
    questions: Array<QuestionInfo>;
    tool?: QuestionTool;
  };
  export type QuestionAnswer = string[];

  export type SkillWithContent = {
    name: string;
    description?: string;
    location: string;
    content: string;
  };

  export interface V2OpencodeClient {
    question: {
      /** GET /question — list pending question requests across all sessions. */
      list(params?: {
        directory?: string;
      }): Promise<V2Envelope<Array<QuestionRequest>>>;
      /** POST /question/{requestID}/reply — answer a pending question. */
      reply(params: {
        requestID: string;
        directory?: string;
        answers?: Array<QuestionAnswer>;
      }): Promise<V2Envelope<boolean>>;
      /** POST /question/{requestID}/reject — dismiss a pending question. */
      reject(params: {
        requestID: string;
        directory?: string;
      }): Promise<V2Envelope<boolean>>;
    };
    app: {
      /** GET /skill — list discovered skills, including full SKILL.md content. */
      skills(params?: {
        directory?: string;
      }): Promise<V2Envelope<Array<SkillWithContent>>>;
    };
  }
}
