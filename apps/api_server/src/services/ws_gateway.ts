import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { appEvents } from '../utils/app_events';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { bridgePty, ptyEngineUrl } from './pty_proxy';
import { buildSkillsPreface, isSkillInjectionEnabled } from './skill_retrieval';
import { buildMemoryPreface, isMemoryInjectionEnabled } from './memory_retrieval';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentSessionMemoryProvenanceRepository } from '../repositories/agent_session_memory_provenance_repository';
import { resolveProfileScope } from './agent_profile_scope';
import { retainTurn } from './turn_redispatch';

export interface WsMessage {
  v: 1;
  type: string;
  [key: string]: unknown;
}

const clients = new Set<WebSocket>();
let attached = false;

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const normalized = address.toLowerCase().startsWith('::ffff:')
    ? address.slice('::ffff:'.length)
    : address;
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/.test(part)) &&
    Number(octets[0]) === 127 &&
    octets.every((part) => Number(part) <= 255)
  );
}

function rejectRemoteLegacyUpgrade(
  socket: import('node:stream').Duplex,
): void {
  if (socket.destroyed) return;
  socket.end(
    'HTTP/1.1 403 Forbidden\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      'Cache-Control: no-store\r\n\r\n',
  );
}

export interface MobileUpgradeHandler {
  handleUpgrade(
    request: http.IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): boolean;
  close(): void;
}

export function attachWsGateway(
  server: http.Server,
  mobileUpgradeHandler?: MobileUpgradeHandler,
): WebSocketServer {
  // Idempotency guard: if already attached, return a no-op WSS
  if (attached) {
    mobileUpgradeHandler?.close();
    return new WebSocketServer({ noServer: true });
  }
  attached = true;

  // noServer mode: a single server.on('upgrade') handler (below) routes
  // upgrade requests to the agents WSS (/ws/agents) or the PTY proxy WSS
  // (/ws/pty/<id>). The agents `connection` behavior is unchanged.
  const wss = new WebSocketServer({ noServer: true });

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

  // Dedicated WSS for PTY proxy connections (/ws/pty/<id>).
  const ptyWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (mobileUpgradeHandler?.handleUpgrade(req, socket, head)) return;
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      /* default pathname */
    }
    const legacyAgentSocket = pathname === '/ws/agents';
    const legacyPtyMatch = pathname.match(/^\/ws\/pty\/([^/]+)$/);
    if (
      (legacyAgentSocket || legacyPtyMatch) &&
      !isLoopbackAddress(
        (socket as import('node:stream').Duplex & {
          remoteAddress?: string;
        }).remoteAddress,
      )
    ) {
      rejectRemoteLegacyUpgrade(socket);
      return;
    }
    if (legacyAgentSocket) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      return;
    }
    if (legacyPtyMatch) {
      const ptyId = decodeURIComponent(legacyPtyMatch[1]);
      ptyWss.handleUpgrade(req, socket, head, (ws) => bridgePty(ws, ptyEngineUrl(ptyId)));
      return;
    }
    socket.destroy();
  });
  wss.once('close', () => mobileUpgradeHandler?.close());

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

/** Broadcast that the agent-profile catalog changed. */
export function broadcastAgentConfigsChanged(): void {
  broadcast({ v: 1, type: 'agent-configs.changed' });
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
  // OPC-M4-4: per-turn intra-session agent override, never persisted.
  // The Flutter composer sends `agent: <name>` (e.g. 'plan', 'build', or a
  // custom agent name) alongside the session.input frame. The SDK's
  // promptAsync body accepts an `agent?: string` field that routes the turn
  // to the named agent. Absent → SDK uses its default (build).
  const perTurnAgent = typeof msg.agent === 'string' && msg.agent.length > 0
    ? msg.agent
    : null;

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
  // #711: read permissionMode so it can be forwarded in the prompt opts.
  // The opencode server inspects this field in the body to bypass its
  // own per-tool permission gate — when 'bypassPermissions', it executes
  // tools without emitting permission.updated events. Without forwarding
  // it here, Claude/anthropic sessions silently hang waiting for user
  // approval while openrouter free sessions (chat-only, no tool calls)
  // appear to "work" because they never trigger tool-use at all.
  let sessionPermissionMode: string = 'default';
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
      sessionPermissionMode = session.permissionMode ?? 'default';
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

  // #765 — Resolve profile scope (model + MCP config) for the profile that
  // ACTUALLY drives this turn.
  //
  // The interactive create path (POST /agent-sessions, agents_view.dart) makes
  // agent-LESS sessions (agentId:null → agent_kind '' or a base kind like
  // 'claude-code'). The real profile (e.g. 'secretary') is picked per-turn in
  // the composer and arrives on the frame as `agent` (perTurnAgent). Resolving
  // scope from the row's stored agentKind therefore loses the chosen profile's
  // MCP restriction entirely (base kinds carry no allowed_mcps_json → null
  // config → ALL tools). We must prefer the per-turn picked profile, falling
  // back to the session's agentKind only when no per-turn agent was sent.
  //
  // No override is passed (undefined) so the helper derives MCP scope from the
  // resolved profile's own allowed_mcps_json column — giving interactive
  // sessions the same MCP restriction the scheduled path enforces. This must
  // happen BEFORE any createSession call so the mcpRoleConfig is available for
  // init-time scoping. Non-fatal: a missing/unknown profile id returns null
  // mcpRoleConfig (no restriction).
  const scopeAgentId = perTurnAgent ?? agentKind ?? null;
  if (scopeAgentId) {
    try {
      const configsRepo = new AgentConfigsRepository();
      const config =
        configsRepo.getById(scopeAgentId) ??
        configsRepo.list().find((candidate) => candidate.ocAgent === scopeAgentId);
      if (config) {
        const blockReason = agentConfigExecutionBlockReason(config);
        if (blockReason) {
          ws.send(JSON.stringify({ v: 1, type: 'error', id, message: blockReason }));
          return;
        }
      }
    } catch {
      // Preserve the existing fail-open behavior when the local DB is
      // unavailable; the projection/registry boundaries remain fail-closed.
    }
  }

  // #884 — resolve the model/provider for this turn ONCE, BEFORE
  // building/pushing the MCP allowlist, so createSession/updateSessionAllowlist
  // can trim the allowlist to Gemini's function-declaration cap when the
  // resolved provider is `google` (direct route or a model-fallback route).
  // The prompt-send path further below reuses `resolvedTurnModel` instead of
  // calling resolveModelForSessionTurn a second time — same inputs
  // (agentKind/sessionProviderId/sessionModelId/perTurnOverride) each produce
  // the same result, so this is a pure move, not a behavior change. Non-fatal:
  // a resolution failure here leaves `resolvedTurnModel` undefined, which is
  // treated as "not google" (no cap applied) here — the prompt-send path's own
  // undefined-model guard still runs unchanged below.
  let resolvedTurnModel: { providerID: string; modelID: string } | undefined;
  if (agentKind) {
    try {
      const { resolveModelForSessionTurn } = await import('./agent_model_resolver');
      resolvedTurnModel = await resolveModelForSessionTurn({
        agentId: agentKind,
        sessionProviderId,
        sessionModelId,
        perTurnOverride,
        // #1108 — lets a successful manual per-turn override persist onto
        // this session row so it survives the NEXT prompt instead of
        // silently reverting to the stale stored provider/model.
        sessionId: id,
      });
    } catch (err) {
      console.error(`[ws_gateway] early model resolution for Gemini tool cap failed (non-fatal):`, err);
    }
  }
  const resolvedTurnProviderId: string | null = resolvedTurnModel?.providerID ?? null;

  let wsMcpRoleConfig: import('./agent_profile_scope').McpRoleConfig | undefined;
  let wsAllowedSkillsJson: string | null = null;
  // #775/#916 (skill-scope): the resolved profile's permitted skill NAMES,
  // parsed from allowed_skills_json. undefined = unrestricted; [] = deny all.
  let wsSkillNames: string[] | undefined = undefined;
  let wsSystemPrompt: string | null = null;
  let wsOcAgent: string | null = null;
  try {
    const wsProfileScope = await resolveProfileScope(scopeAgentId);
    wsMcpRoleConfig = wsProfileScope.mcpRoleConfig ?? undefined;
    wsAllowedSkillsJson = wsProfileScope.allowedSkillsJson;
    // #775/#916 (skill-scope): parse allowed_skills_json into the names array
    // pushed to the fork. null means unrestricted; a present empty or malformed
    // value denies all.
    if (wsAllowedSkillsJson !== null) {
      wsSkillNames = [];
      try {
        const parsed = JSON.parse(wsAllowedSkillsJson);
        if (Array.isArray(parsed)) {
          wsSkillNames = parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
        }
      } catch {
        console.error(
          `[ws_gateway] session ${id}: profile=${scopeAgentId ?? 'profile'} invalid allowedSkillsJson; denying all skills. offendingValue=`,
          wsAllowedSkillsJson,
        );
      }
    }
    wsSystemPrompt = wsProfileScope.systemPrompt;
    wsOcAgent = wsProfileScope.ocAgent;
    if (wsMcpRoleConfig) {
      console.log(
        `[ws_gateway] session ${id}: profile mcpRoleConfig resolved from '${scopeAgentId}' (role=${wsMcpRoleConfig.role}, servers=${Object.keys(wsMcpRoleConfig.mcpServers).join(',')})`,
      );
    }
    // #765 — persist the resolved scope onto the session row so it is auditable
    // and survives a later resume. Clear it (null) when the picked profile
    // imposes no restriction so a row never carries a stale allowlist after the
    // user switches to an unrestricted profile.
    try {
      new AgentSessionsRepository().setMcpScope(
        id,
        wsMcpRoleConfig?.role ?? null,
        wsMcpRoleConfig?.allowedToolsJson ?? null,
      );
    } catch (persistErr) {
      console.error(`[ws_gateway] setMcpScope persist failed (non-fatal):`, persistErr);
    }
  } catch (err) {
    // Non-fatal: a scope-resolution failure must never block an interactive turn.
    console.error(`[ws_gateway] resolveProfileScope failed (non-fatal):`, err);
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
          // P1a: pass wsMcpRoleConfig so the new session inherits the profile's
          // MCP scope even after an auto-resume.
          console.warn(
            `[ws_gateway] SDK session "${persistedSdkId}" gone for local session ${id} — creating fresh`,
          );
          const freshSession = await opencodeClient.createSession(
            sessionName ?? 'Resumed',
            cwd,
            wsMcpRoleConfig,
            wsSkillNames,
            resolvedTurnProviderId,
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
        // P1a: pass wsMcpRoleConfig so the new session inherits the profile's
        // MCP scope.
        const opencodeSession = await opencodeClient.createSession(
          sessionName ?? 'Resumed',
          cwd,
          wsMcpRoleConfig,
          wsSkillNames,
          resolvedTurnProviderId,
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

  // #765 — push the resolved MCP allowlist onto the existing fork session so
  // filterMcpToolsByAllowlist in prompt.ts reads it at prompt time. This is
  // necessary when `opencodeId` was already in the map (set by
  // POST /agent-sessions before the user picked a profile); those sessions
  // were created without an allowlist, so we PATCH it here per-turn.
  // For freshly-created sessions (the if-block above) this is a no-op
  // update to the same value, which is harmless.
  // Issue #855: pass the WHOLE wsMcpRoleConfig through to updateSessionAllowlist
  // (which expands it via the same expandMcpAllowlist() createSession uses) —
  // do NOT hand-roll `JSON.parse(wsMcpRoleConfig.allowedToolsJson) as string[]`
  // here. `allowedToolsJson` is the raw, UNEXPANDED profile JSON and can be a
  // tools-map object (`{"canva":["tool1"]}`) rather than a bare server-name
  // array, depending on how the profile's allowed_mcps_json was authored. That
  // wrong-shape parse was silently defeating this entire guard: the malformed
  // PATCH failed the fork's strict McpAllowlist schema validation, was
  // swallowed by the catch below as "non-fatal", and the session's
  // mcpAllowlist stayed unset — so filterMcpToolsByAllowlist saw `undefined`
  // and injected the FULL tool surface for every profiled turn.
  try {
    await opencodeClient.updateSessionAllowlist(
      opencodeId,
      wsMcpRoleConfig ?? null,
      resolvedTurnProviderId,
    );
  } catch (allowlistErr) {
    console.error(`[ws_gateway] updateSessionAllowlist failed (non-fatal):`, allowlistErr);
  }

  // #775 (skill-scope): push the resolved skill allowlist onto the existing fork
  // session so SystemPrompt.skills / the skill tool / its execute-guard scope to it
  // at prompt time. Mirrors the MCP block above — necessary because sessions created
  // by POST /agent-sessions (before the user picked a profile) carry no allowlist, so
  // we PATCH it here per-turn. null clears a stale prior restriction when the user
  // switches to an unrestricted profile; [] is an explicit deny-all restriction.
  try {
    await opencodeClient.updateSessionSkillAllowlist(opencodeId, wsSkillNames ?? null);
  } catch (skillAllowlistErr) {
    console.error(`[ws_gateway] updateSessionSkillAllowlist failed (non-fatal):`, skillAllowlistErr);
  }

  try {
    // #884: reuse the model resolved earlier (before the MCP allowlist push)
    // instead of calling resolveModelForSessionTurn again — same inputs,
    // same result, one fewer auth-catalog round trip per turn.
    const model = resolvedTurnModel;

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
    // OPC-M4-4: include the per-turn agent name when provided.
    // #711: include permissionMode so the opencode server can honour
    // it in-turn (bypassing its per-tool permission gate) rather than
    // relying solely on the stream bridge's post-hoc auto-respond path.
    // The opencode server reads this field from the prompt body and
    // skips emitting permission.updated events for tool calls when it
    // is 'bypassPermissions' — without this, Claude/anthropic sessions
    // silently stall while waiting for user permission approval, even
    // though Rhythm already has the permissionMode stored on the session.
    //
    // #714: The opencode server's prompt body accepts `reasoningConfig` to
    // enable extended thinking / reasoning. The field shape (confirmed by
    // inspecting the opencode v1.14.40 binary) is:
    //   reasoningConfig: { type: "enabled", budgetTokens: <N> }
    // This is the canonical field for BOTH the anthropic and bedrock paths.
    // The older `thinking: { budget_tokens: N }` (snake_case) was wrong and
    // silently ignored by the server — it is NOT in the opencode prompt body
    // schema (Ih in the binary). openrouter "free" models (e.g. DeepSeek-R1)
    // emit reasoning blocks unconditionally, masking the bug on that path.
    if (effectiveThinkingBudget !== null) {
      console.log(
        `[ws_gateway] session ${id}: enabling reasoning via reasoningConfig.budgetTokens=${effectiveThinkingBudget}`,
      );
    }
    // P2: Resolve `agent` with precedence: per-turn override > profile ocAgent > none.
    // Per docs/ai/decisions/2026-06-24-sdk-per-session-system-prompt.md:
    //   profile.ocAgent is an opencode *mode* ('build'/'plan'/etc.), NOT the Rhythm
    //   provider kind — forwarding it is safe and different from the #738 guardrail.
    //   wsOcAgent is null when the profile has no ocAgent; perTurnAgent is null when
    //   the Flutter client didn't send an explicit per-turn agent override.
    const effectiveAgent: string | null = perTurnAgent ?? wsOcAgent;
    const sdkOpts = (effectiveThinkingBudget !== null || effectiveFastMode || effectiveAgent !== null || sessionPermissionMode !== 'default' || wsSystemPrompt !== null)
      ? {
          ...(effectiveThinkingBudget !== null
            ? { reasoningConfig: { type: 'enabled', budgetTokens: effectiveThinkingBudget } }
            : {}),
          ...(effectiveFastMode ? { fastMode: true } : {}),
          ...(effectiveAgent !== null ? { agent: effectiveAgent } : {}),
          ...(sessionPermissionMode !== 'default' ? { permissionMode: sessionPermissionMode } : {}),
          ...(wsSystemPrompt !== null ? { system: wsSystemPrompt } : {}),
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

    // P3-2: inject retrieved skills as a TRANSIENT preface. The WS prompt body
    // has no system-prompt seam (sdkOpts only carries reasoning/fastMode/agent/
    // permission fields), so the preface is prepended to the forwarded user
    // text — both the `data` string and the leading text part (whichever the
    // SDK uses). This is in-memory only for this turn: nothing is persisted to
    // the session, profile systemPrompt, or any opencode .md. uses are bumped
    // after a successful enqueue.
    let forwardData = data;
    let forwardParts = partsToForward;
    let wsInjectedSkillIds: string[] = [];
    if (isSkillInjectionEnabled()) {
      try {
        // P1b: pass the profile's allowedSkillsJson so only permitted skills are injected.
        const preface = buildSkillsPreface(data, { allowedSkillsJson: wsAllowedSkillsJson });
        if (preface.text) {
          forwardData = `${preface.text}\n\n${data}`;
          wsInjectedSkillIds = preface.skillIds;
          if (partsToForward) {
            // Prepend to the first text part so the parts payload (which the
            // SDK prefers over `data` when present) also carries the preface.
            const idx = partsToForward.findIndex(
              (p) => p.type === 'text' && typeof p.text === 'string',
            );
            forwardParts = partsToForward.map((p, i) =>
              i === idx ? { ...p, text: `${preface.text}\n\n${p.text as string}` } : p,
            );
          }
          console.log(
            `[ws_gateway] session ${id}: injected ${wsInjectedSkillIds.length} retrieved skill(s) into prompt preface`,
          );
        }
      } catch (err) {
        // Non-fatal — never block a turn on retrieval failure.
        console.error(`[ws_gateway] skill preface build failed (non-fatal):`, err);
      }
    }

    // FOLLOW-UP (memory injection): prepend an OWNER-SCOPED, TRANSIENT
    // "## Known context" block ALONGSIDE the skills preface (additive, not a
    // replacement) — final forwarded text is:
    //   <memory preface>\n\n<skills preface>\n\n<original user text>
    // matching the AgentRunner composition order. Independently toggle-guarded.
    //
    // FAIL-SAFE OWNER RESOLUTION: the interactive `agent_sessions` row has NO
    // owner/user column (sessions are not user-scoped on the local agent
    // server), so the owning user CANNOT be determined here. Per the issue's
    // fail-closed rule we pass ownerUserId=null → ONLY instance-global
    // (null-owner) memory is retrieved; a user-owned fact can never leak into
    // another user's interactive turn. As with skills, this is in-memory only:
    // nothing is persisted to the session, profile systemPrompt, or any
    // opencode .md.
    if (isMemoryInjectionEnabled()) {
      try {
        const memPreface = await buildMemoryPreface(data, null);
        if (memPreface.text) {
          forwardData = `${memPreface.text}\n\n${forwardData}`;
          if (forwardParts) {
            const idx = forwardParts.findIndex(
              (p) => p.type === 'text' && typeof p.text === 'string',
            );
            forwardParts = forwardParts.map((p, i) =>
              i === idx
                ? { ...p, text: `${memPreface.text}\n\n${p.text as string}` }
                : p,
            );
          }
          console.log(
            `[ws_gateway] session ${id}: injected ${memPreface.memoryIds.length} relevant memory item(s) into prompt preface (owner=global)`,
          );
        }
        // #862 — record provenance for THIS turn (overwrites the session's
        // previous record) so the desktop app can render "Memories used in
        // this reply: …", including the explicit "none" case when
        // memoryIds is empty. Non-fatal: a recording failure must never
        // block the turn.
        try {
          new AgentSessionMemoryProvenanceRepository().record(
            id,
            memPreface.memoryIds,
            memPreface.notePaths,
          );
        } catch (err) {
          console.error(`[ws_gateway] memory provenance record failed (non-fatal):`, err);
        }
      } catch (err) {
        // Non-fatal — never block a turn on retrieval failure.
        console.error(`[ws_gateway] memory preface build failed (non-fatal):`, err);
      }
    }

    // #930 — retain the fully-composed turn (incl. the transient skill/memory
    // prefaces above) so a mid-run rate-limit exhaustion handoff can revert and
    // re-dispatch it verbatim on the new provider. Cleared on normal turn
    // completion (stream bridge session.idle → clearTurn).
    if (opencodeId) {
      retainTurn(id, {
        sdkSessionId: opencodeId,
        data: forwardData,
        parts: forwardParts,
        cwd,
        sdkOpts,
        model,
        mcpRoleConfig: wsMcpRoleConfig ?? null,
      });
    }

    await promptFn(opencodeId, forwardData, model, cwd, sdkOpts, forwardParts);

    // #929 — evaluateHarvestedDrafts() is NOT called here. `promptFn`
    // (promptAsync) resolves once the turn is submitted to the engine, not
    // once its response (incl. any `skill`-tool call) is durably persisted —
    // that happens later, asynchronously, when OpencodeStreamBridge handles
    // the SDK's `session.idle` event. Calling the evaluator here always sees
    // last turn's usage count, one behind the turn that just ran — with no
    // later turn to re-check, a draft that crosses the threshold on its LAST
    // exercising turn would never get evaluated. See the real post-turn hook
    // (same posture as queueSkillExtraction) in opencode_stream_bridge.ts's
    // `session.idle` handler, right after the turn's message is persisted.

    // P3-2: bump `uses` for each injected skill (non-fatal). Done after a
    // successful enqueue; the preface text itself is never persisted.
    if (wsInjectedSkillIds.length > 0) {
      try {
        const skillsRepo = new AgentSkillsRepository();
        for (const skillId of wsInjectedSkillIds) {
          skillsRepo.incrementUses(skillId);
        }
      } catch (err) {
        console.error(`[ws_gateway] incrementUses failed (non-fatal):`, err);
      }
    }
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
