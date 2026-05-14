import { spawnSync } from 'child_process';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { broadcast } from './ws_gateway';
import { emitAppEvent } from '../utils/app_events';
import type { AgentSession } from '../models/agent_session';

// node-pty is a native module — load lazily so import failures surface clearly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pty: typeof import('node-pty') | null = null;
let ptyLoadError: Error | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  pty = require('node-pty') as typeof import('node-pty');
} catch (err) {
  ptyLoadError = err instanceof Error ? err : new Error(String(err));
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PtySession {
  id: string;
  agentId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pty: import('node-pty').IPty;
  cwd: string;
  /** Rolling 200 KB ring buffer for replay on WS connect/subscribe */
  chunks: string[];
  chunksSize: number;
  /** Session token extracted from PTY output (when config.isAgent && config.sessionIdPattern) */
  sessionToken: string | null;
  /** Accumulator used during token scan (discarded once token found) */
  preCaptureBuffer: string;
  /** Timestamps for the activity tracker (issue #372) */
  lastOutAt: number;
  lastInAt: number;
  burstStart: number;
  working: boolean;
}

// ─── Module-level state ───────────────────────────────────────────────────────

const sessions = new Map<string, PtySession>();
const RING_LIMIT = 200 * 1024; // 200 KB

/** Cache compiled regexes by config id to avoid recompiling per chunk. */
const regexCache = new Map<string, RegExp>();

// ─── shlex-style command splitter ────────────────────────────────────────────

/**
 * Splits a shell command string into [binary, ...args] using a minimal
 * shlex-style parser. Handles single and double quotes and backslash escapes.
 * Does NOT support backticks, env expansion, or glob patterns.
 * Returns an empty array if the input is blank.
 */
export function shlexSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === ' ' || ch === '\t') {
      // Token boundary
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < command.length) {
      // Backslash escape outside quotes
      current += command[i + 1];
      i += 2;
      continue;
    }

    if (ch === "'") {
      // Single-quoted string — no escapes inside
      i++;
      while (i < command.length && command[i] !== "'") {
        current += command[i];
        i++;
      }
      i++; // skip closing quote
      continue;
    }

    if (ch === '"') {
      // Double-quoted string — backslash escapes inside
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length) {
          current += command[i + 1];
          i += 2;
        } else {
          current += command[i];
          i++;
        }
      }
      i++; // skip closing quote
      continue;
    }

    current += ch;
    i++;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// ─── Binary resolution ────────────────────────────────────────────────────────

/**
 * Resolves a binary using a login shell so that user-level PATH entries
 * (npm global, nvm, etc.) are included — matches the pattern used in
 * api_server_service.dart.
 */
function resolveBinary(name: string): string | null {
  const result = spawnSync('/bin/zsh', ['-l', '-c', `which ${name}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

/**
 * Returns the compiled regex for a config's session_id_pattern.
 * Caches by config id to avoid recompiling on every PTY data chunk.
 */
function getTokenRegex(agentId: string, pattern: string): RegExp {
  const cached = regexCache.get(agentId);
  if (cached) return cached;
  const re = new RegExp(pattern, 'i');
  regexCache.set(agentId, re);
  return re;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SpawnOpts {
  session: AgentSession;
  cols?: number;
  rows?: number;
}

/**
 * Attaches onData / onExit handlers to an already-spawned PTY terminal.
 * Shared by `spawn` and `resume` so the lifecycle logic is not duplicated.
 */
function _attachSession(
  term: import('node-pty').IPty,
  sess: PtySession,
  cols: number,
  rows: number,
): void {
  // Store the PTY reference and register in the live-sessions map
  sess.pty = term;
  sessions.set(sess.id, sess);

  const repo = new AgentSessionsRepository();

  term.onData((data: string) => {
    sess.lastOutAt = Date.now();
    if (sess.burstStart === 0 || Date.now() - sess.lastOutAt > 2000) {
      sess.burstStart = Date.now();
    }

    // Maintain ring buffer
    sess.chunks.push(data);
    sess.chunksSize += data.length;
    while (sess.chunksSize > RING_LIMIT && sess.chunks.length > 0) {
      const oldest = sess.chunks.shift()!;
      sess.chunksSize -= oldest.length;
    }

    // Session token capture (scan until token is found, then stop)
    if (!sess.sessionToken) {
      // Look up config to get isAgent and sessionIdPattern
      const config = new AgentConfigsRepository().getById(sess.agentId);
      if (config?.isAgent && config.sessionIdPattern) {
        sess.preCaptureBuffer += data;
        // Keep pre-capture buffer from growing unbounded
        if (sess.preCaptureBuffer.length > 8192) {
          sess.preCaptureBuffer = sess.preCaptureBuffer.slice(-4096);
        }
        const re = getTokenRegex(sess.agentId, config.sessionIdPattern);
        const m = sess.preCaptureBuffer.match(re);
        if (m?.[1]) {
          sess.sessionToken = m[1];
          repo.updateToken(sess.id, m[1]);
          emitAppEvent({
            event: 'agent.session_token_captured',
            sessionId: sess.id,
            token: m[1],
          });
        }
      }
    }

    // Persist transcript — fire-and-forget so SQLite writes don't backpressure the PTY
    // transcript recording removed — Opencode SDK handles session history

    // Broadcast to all WebSocket clients
    broadcast({ v: 1, type: 'output', id: sess.id, data });
  });

  term.onExit(() => {
    const wasResumable = !!sess.sessionToken;
    repo.updateStatus(sess.id, wasResumable ? 'resumable' : 'closed');
    sessions.delete(sess.id);
    broadcast({
      v: 1,
      type: 'session.closed',
      id: sess.id,
      resumable: wasResumable,
    });
    emitAppEvent({
      event: 'agent.session_closed',
      sessionId: sess.id,
      resumable: wasResumable,
    });
  });

  // Suppress unused-variable warnings — cols/rows are consumed by the caller
  void cols;
  void rows;
}

/**
 * Spawns the agent binary for the given session.
 * Looks up the agent config by session.agentKind (treated as config id).
 * Throws if node-pty failed to load, the config is missing/disabled, or the
 * binary is not on PATH.
 */
export function spawn(opts: SpawnOpts): void {
  if (!pty) {
    throw new Error(
      `node-pty failed to load: ${ptyLoadError?.message ?? 'unknown error'}. ` +
        `Ensure native binaries were compiled for the current Node version (try: node-gyp rebuild).`,
    );
  }

  const agentId = opts.session.agentKind as string;
  const configRepo = new AgentConfigsRepository();
  const config = configRepo.getById(agentId);

  if (!config || !config.enabled) {
    throw new Error(
      config
        ? `Agent '${agentId}' is disabled`
        : `No agent config found for id '${agentId}'`,
    );
  }

  // Legacy CLI field. AgentConfig.command is now optional (issue #581);
  // this dead-code path keeps the runtime check that already existed.
  const parts = shlexSplit(config.command ?? '');
  if (parts.length === 0) {
    throw new Error(`Agent '${agentId}' has an empty command`);
  }

  const [binaryName, ...args] = parts;
  const binary = resolveBinary(binaryName);
  if (!binary) {
    throw new Error(`Agent '${agentId}' binary ('${binaryName}') not found in PATH`);
  }

  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 30;

  const term = pty.spawn(binary, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: opts.session.cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });

  const sess: PtySession = {
    id: opts.session.id,
    agentId,
    pty: term,
    cwd: opts.session.cwd,
    chunks: [],
    chunksSize: 0,
    sessionToken: null,
    preCaptureBuffer: '',
    lastOutAt: Date.now(),
    lastInAt: Date.now(),
    burstStart: 0,
    working: false,
  };

  _attachSession(term, sess, cols, rows);
}

/**
 * Re-spawns a previously closed session using its captured session token.
 * Looks up the agent config to determine resume support and command.
 * Throws for non-resumable agents, missing token, or if pty failed to load.
 */
export function resume(sessionId: string, dbSession: AgentSession): void {
  if (!pty) {
    throw new Error(
      `node-pty failed to load: ${ptyLoadError?.message ?? 'unknown error'}. ` +
        `Ensure native binaries were compiled for the current Node version (try: node-gyp rebuild).`,
    );
  }

  const agentId = dbSession.agentKind as string;
  const configRepo = new AgentConfigsRepository();
  const config = configRepo.getById(agentId);

  if (!config || !config.enabled) {
    throw new Error(
      config
        ? `Agent '${agentId}' is disabled`
        : `No agent config found for id '${agentId}'`,
    );
  }

  if (!config.canResume || !config.resumeCommand) {
    throw new Error(`resume not supported for this agent ('${agentId}')`);
  }

  if (!dbSession.sessionToken) {
    throw new Error('Session token missing — cannot resume');
  }

  const resumeCmd = config.resumeCommand.replace('{{sessionId}}', dbSession.sessionToken);
  const parts = shlexSplit(resumeCmd);
  if (parts.length === 0) {
    throw new Error(`Agent '${agentId}' has an empty resume_command`);
  }

  const [binaryName, ...args] = parts;
  const binary = resolveBinary(binaryName);
  if (!binary) {
    throw new Error(`Agent '${agentId}' binary ('${binaryName}') not found in PATH`);
  }

  const cols = 120;
  const rows = 30;

  const term = pty.spawn(binary, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: dbSession.cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });

  const sess: PtySession = {
    id: sessionId,
    agentId,
    pty: term,
    cwd: dbSession.cwd,
    chunks: [],
    chunksSize: 0,
    // Preserve the known token so it won't be re-captured from scratch
    sessionToken: dbSession.sessionToken,
    preCaptureBuffer: '',
    lastOutAt: Date.now(),
    lastInAt: Date.now(),
    burstStart: 0,
    working: false,
  };

  _attachSession(term, sess, cols, rows);
}

/** Forward keyboard input to the PTY. */
export function sendInput(id: string, data: string): void {
  const sess = sessions.get(id);
  if (!sess) return;
  sess.lastInAt = Date.now();
  sess.pty.write(data);
  // transcript recording removed — Opencode SDK handles session history
}

/** Resize the PTY terminal window. */
export function resize(id: string, cols: number, rows: number): void {
  const sess = sessions.get(id);
  if (!sess) return;
  sess.pty.resize(cols, rows);
}

/** Kill the PTY. The onExit handler will update the DB row and broadcast session.closed. */
export function kill(id: string): void {
  const sess = sessions.get(id);
  if (!sess) return;
  try {
    sess.pty.kill();
  } catch {
    // Already dead — safe to ignore
  }
}

/** Return the full ring-buffer contents for replay. */
export function getBuffer(id: string): string {
  const sess = sessions.get(id);
  if (!sess) return '';
  return sess.chunks.join('');
}

/** Returns true if a live PTY session exists for the given id. */
export function isAlive(id: string): boolean {
  return sessions.has(id);
}

/** Returns the ids of all currently-live PTY sessions. */
export function listAlive(): string[] {
  return Array.from(sessions.keys());
}

/**
 * Internal accessor for the activity tracker (issue #372).
 * Do NOT call from application business logic.
 */
export function _internal_getSessionsMap(): Map<string, PtySession> {
  return sessions;
}

/**
 * No-op stub called at server startup.
 * Reserved for a future watcher that checks whether sessions started before
 * a server restart are still alive (issue #372).
 */
export function startSessionTokenWatcher(): void {
  // Intentionally empty in v1
}
