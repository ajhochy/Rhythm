/**
 * #1577 — POST /agent-sessions/:id/prompt.
 *
 * The three things worth a check:
 *  1. The prompt actually reaches the engine (i.e. the endpoint really is the
 *     programmatic twin of a composer message, not a stub that 202s and drops
 *     the text on the floor).
 *  2. Every attempt lands in the append-only audit trail, with the caller
 *     identity resolved from the ENGINE session id rather than anything the
 *     model supplied — the log is the ONLY control on this path, since auth is
 *     deliberately flat (no parentage gate).
 *  3. A caller with no relationship to the target can prompt it. That is the
 *     main use case, so a regression toward parentage-gating must fail here.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentPromptInjectionsRepository } from '../repositories/agent_prompt_injections_repository';

const promptAsync = vi.fn().mockResolvedValue(true);

vi.mock('../services/opencode_engine', () => {
  const sessionMap = new Map<string, string>();
  return {
    opencodeClient: {
      get isReady() {
        return true;
      },
      statusMessage: 'Opencode SDK ready',
      listAuthedProviders: vi.fn().mockResolvedValue(['anthropic']),
      createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
      getSession: vi.fn(async (id: string) => ({ id })),
      promptAsync: (...args: unknown[]) => promptAsync(...args),
      updateSessionAllowlist: vi.fn().mockResolvedValue(undefined),
      updateSessionSkillAllowlist: vi.fn().mockResolvedValue(undefined),
      ensureReady: vi.fn().mockResolvedValue(true),
    },
    opencodeSessionMap: sessionMap,
  };
});

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    setPendingRunEpisodeId: vi.fn(),
    dispose: vi.fn(),
  },
}));

describe('#1577 prompt an existing agent session', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let headers: Record<string, string>;
  let target: { id: string };
  let caller: { id: string };

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const user = new UsersRepository().create({
      name: 'Test User',
      email: 'test@example.com',
    });
    const authSession = await new SessionsRepository().createAsync(user.id);
    headers = {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    };

    const sessions = new AgentSessionsRepository();
    target = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Orchestrator',
      ownerUserId: user.id,
    });
    sessions.setSdkSessionId(target.id, 'sdk-target');
    // Deliberately NOT a child of `target` — unrelated peer.
    caller = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Unrelated caller',
      ownerUserId: user.id,
    });
    sessions.setSdkSessionId(caller.id, 'sdk-caller');

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    promptAsync.mockClear();
  });

  it('delivers the prompt to the engine and audits an unrelated caller', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'Review the finished work and open a PR.',
        callerSdkSessionId: 'sdk-caller',
      }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: boolean; auditId: number };
    expect(body.accepted).toBe(true);

    // 1. The text really reached the engine.
    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(promptAsync.mock.calls[0][1]).toBe(
      'Review the finished work and open a PR.',
    );

    // 2. + 3. Audited, attributed to the caller's Rhythm session resolved from
    // its ENGINE session id — and not refused despite having no parentage.
    const log = new AgentPromptInjectionsRepository().listForSession(target.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      targetSessionId: target.id,
      callerSessionId: caller.id,
      callerSdkSessionId: 'sdk-caller',
      source: 'mcp',
      prompt: 'Review the finished work and open a PR.',
      accepted: true,
    });
  });

  it('rejects an empty prompt and does not dispatch', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(promptAsync).not.toHaveBeenCalled();
    expect(
      new AgentPromptInjectionsRepository().listForSession(target.id),
    ).toHaveLength(0);
  });

  it('keeps the audit trail append-only', () => {
    const id = new AgentPromptInjectionsRepository().record({
      targetSessionId: target.id,
      callerSessionId: null,
      callerSdkSessionId: null,
      callerUserId: null,
      source: 'http',
      prompt: 'anything',
    });
    expect(() =>
      getDb().prepare('DELETE FROM agent_prompt_injections WHERE id = ?').run(id),
    ).toThrow(/append-only/);
  });

  it('serves the audit trail over GET /:id/prompt-log', async () => {
    await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'hello', callerSdkSessionId: 'sdk-caller' }),
    });
    const res = await fetch(
      `${baseUrl}/agent-sessions/${target.id}/prompt-log`,
      { headers },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      injections: Array<{ prompt: string; callerSessionId: string }>;
    };
    expect(body.injections[0].prompt).toBe('hello');
    expect(body.injections[0].callerSessionId).toBe(caller.id);
  });
});
