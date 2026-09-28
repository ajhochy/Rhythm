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
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { asRhythmProfileId, asOpenCodeAgentId } from '../models/agent_session';
import { createTrustedMcpTestSigner } from './helpers/trusted_mcp_test_proof';
import {
  clearTrustedMcpVerifier,
  pinTrustedMcpPublicKey,
} from '../security/trusted_mcp_call';

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
    clearTrustedMcpVerifier();
  });

  it('issue-1577-c1: plain authenticated HTTP ignores forged caller claims and audits its authenticated user', async () => {
    // Regression: a model can forge body callerSdkSessionId/source and make an
    // ordinary HTTP write look like a trusted MCP invocation.
    const res = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'Review the finished work and open a PR.',
        callerSdkSessionId: 'sdk-caller',
        callerSessionId: caller.id,
        source: 'mcp',
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

    // HTTP is never allowed to self-attribute as a trusted MCP call.
    const log = new AgentPromptInjectionsRepository().listForSession(target.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      targetSessionId: target.id,
      callerSessionId: null,
      callerSdkSessionId: null,
      callerUserId: 1,
      source: 'http',
      prompt: 'Review the finished work and open a PR.',
      accepted: true,
    });
  });

  it('accepts an ordinary authenticated HTTP prompt without MCP proof', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST', headers, body: JSON.stringify({ prompt: 'ordinary HTTP' }),
    });
    expect(res.status).toBe(202);
    expect(new AgentPromptInjectionsRepository().listForSession(target.id)[0]).toMatchObject({
      prompt: 'ordinary HTTP', source: 'http', callerSessionId: null, callerSdkSessionId: null,
    });
  });

  it('issue-1577-c3: accepts a signed MCP envelope and derives attribution only from it', async () => {
    // Regression: a valid proof with a mismatched route/body prompt must never
    // be accepted, and an accepted proof must resolve the engine caller itself.
    const signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    const trustedCall = signer.signCall({
      sdkSessionId: 'sdk-caller',
      turnId: 'turn-1',
      agentName: 'orchestrator',
      toolCallId: 'call-1',
    }, 'rhythm_prompt_session', {
      sessionId: target.id,
      prompt: 'signed prompt',
    });
    const res = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ trustedCall }),
    });
    expect(res.status).toBe(202);
    expect(new AgentPromptInjectionsRepository().listForSession(target.id)[0]).toMatchObject({
       source: 'mcp', callerSdkSessionId: 'sdk-caller', callerSessionId: caller.id,
       prompt: 'signed prompt',
    });
    expect(promptAsync.mock.calls[0][4]).not.toMatchObject({ agent: 'build' });
  });

  it('issue-1577-c9: refuses agent override on signed MCP and HTTP before audit or dispatch, then accepts the stored profile', async () => {
    // Regression: an override, even in a signed call, can escape the target's restricted profile.
    const engineAgentId = 'claude-code';
    const config = new AgentConfigsRepository().insert({ label: 'Restricted target', icon: 'shield',
      ocAgent: 'build', modelProvider: 'anthropic', modelId: 'fixture-profile-model', allowedMcpsJson: '[]', allowedSkillsJson: '[]' });
    new AgentSessionsRepository().updateFields(target.id, {
      profileId: asRhythmProfileId(config.id),
      opencodeAgentId: asOpenCodeAgentId(engineAgentId),
    });
    const before = new AgentSessionsRepository().findById(target.id);
    expect(before?.profileId).toBe(config.id);
    expect(before?.opencodeAgentId).toBe(engineAgentId);
    expect(before?.profileId).not.toBe(before?.opencodeAgentId);
    expect(config.allowedMcpsJson).toBe('[]');
    expect(config.allowedSkillsJson).toBe('[]');
    const signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    const signed = signer.signCall({ sdkSessionId: 'sdk-caller', turnId: 'turn-override', agentName: 'orchestrator', toolCallId: 'call-override' },
      'rhythm_prompt_session', { sessionId: target.id, prompt: 'escape', agent: 'build' });
    for (const body of [{ trustedCall: signed }, { prompt: 'escape', agent: 'build' }, { prompt: 'escape', agent: null }]) {
      const response = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, { method: 'POST', headers, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(new AgentPromptInjectionsRepository().listForSession(target.id)).toHaveLength(0);
      expect(promptAsync).not.toHaveBeenCalled();
      expect(new AgentSessionsRepository().findById(target.id)?.profileId).toBe(config.id);
    }
    const accepted = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, { method: 'POST', headers, body: JSON.stringify({ prompt: 'safe' }) });
    expect(accepted.status).toBe(202);
    expect(new AgentPromptInjectionsRepository().listForSession(target.id)[0]).toMatchObject({ prompt: 'safe', accepted: true });
    expect(new AgentSessionsRepository().findById(target.id)?.profileId).toBe(config.id);
    const engine = await import('../services/opencode_engine');
    expect(engine.opencodeSessionMap.get(target.id)).toBe('sdk-target');
    expect(engine.opencodeClient.updateSessionAllowlist).toHaveBeenCalledWith(
      'sdk-target',
      expect.objectContaining({ role: config.id, mcpServers: {} }),
      'anthropic',
    );
    expect(engine.opencodeClient.updateSessionSkillAllowlist).toHaveBeenCalledWith('sdk-target', []);
    expect(promptAsync.mock.calls[0][2]).toEqual({ providerID: 'anthropic', modelID: 'fixture-profile-model' });
    // Provider kind is not an engine mode; use the stored profile's valid mode.
    expect((promptAsync.mock.calls[0][4] as { agent?: unknown }).agent).toBe(config.ocAgent);
  });

  it('issue-1577-c10: false enqueue retains matching skill uses at 0; successful control increments to 1', async () => {
    // Regression: counting a retrieved skill before the engine accepts the prompt inflates use metrics.
    const skill = new AgentSkillsRepository().create({ title: 'Reservation helper', whenToUse: 'When booking a facility reservation',
      description: 'Books facilities', tags: ['facility', 'reservation'], status: 'published', confidence: 0.9 });
    const request = () => fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, { method: 'POST', headers,
      body: JSON.stringify({ prompt: 'book a facility reservation' }) });
    expect(new AgentSkillsRepository().getById(skill.id)?.uses).toBe(0);
    promptAsync.mockResolvedValueOnce(false);
    expect((await request()).status).toBe(502);
    expect(new AgentSkillsRepository().getById(skill.id)?.uses).toBe(0);
    expect((await request()).status).toBe(202);
    expect(new AgentSkillsRepository().getById(skill.id)?.uses).toBe(1);
  });

  it('issue-1577-c4: rejects missing, tampered, and replayed MCP proofs', async () => {
    // Regression: accepting an unsigned/replayed call lets untrusted tool data
    // impersonate an engine call.
    const signer = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(signer.publicDocument);
    const trustedCall = signer.signCall({
      sdkSessionId: 'sdk-caller', turnId: 'turn-2', agentName: 'orchestrator', toolCallId: 'call-2',
    }, 'rhythm_prompt_session', { sessionId: target.id, prompt: 'signed prompt' });
    const request = (body: unknown) => fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    expect((await request({ trustedCall: null })).status).toBe(403);
    expect((await request({ trustedCall: { ...trustedCall, arguments: { sessionId: target.id, prompt: 'tampered' } } })).status).toBe(403);
    const other = new AgentSessionsRepository().insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'Other', ownerUserId: 1 });
    const mismatch = await fetch(`${baseUrl}/agent-sessions/${other.id}/prompt`, {
      method: 'POST', headers, body: JSON.stringify({ trustedCall: signer.signCall({
        sdkSessionId: 'sdk-caller', turnId: 'turn-route', agentName: 'orchestrator', toolCallId: 'call-route',
      }, 'rhythm_prompt_session', { sessionId: target.id, prompt: 'signed prompt' }) }),
    });
    expect(mismatch.status).toBe(403);
    expect(new AgentPromptInjectionsRepository().listForSession(other.id)).toHaveLength(0);
    expect((await request({ trustedCall })).status).toBe(202);
    expect((await request({ trustedCall })).status).toBe(403);
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

  it('issue-1577-c5: keeps the injection attempt immutable and settles exactly once', () => {
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
    expect(() =>
      getDb().prepare('UPDATE agent_prompt_injections SET prompt = ? WHERE id = ?').run('forged', id),
    ).toThrow(/append-only/);
    const audit = new AgentPromptInjectionsRepository();
    audit.settle(id, false, 'engine refused');
    expect(() => audit.settle(id, true)).toThrow(/settled|unique/i);
    expect(audit.listForSession(target.id)[0]).toMatchObject({ accepted: false, error: 'engine refused' });
    expect(() => getDb().prepare('UPDATE agent_prompt_injection_outcomes SET accepted = 1 WHERE injection_id = ?').run(id)).toThrow(/append-only/);
    expect(() => getDb().prepare('DELETE FROM agent_prompt_injection_outcomes WHERE injection_id = ?').run(id)).toThrow(/append-only/);
    expect(new AgentPromptInjectionsRepository().listForSession(target.id)[0].error).toBe('engine refused');
  });

  it('upgrades candidate-era rows without rewriting them and repeats schema initialization safely', () => {
    const db = getDb();
    db.prepare(`INSERT INTO agent_prompt_injections
      (target_session_id, source, prompt, accepted, error) VALUES (?, 'http', 'candidate', 1, 'legacy')`).run(target.id);
    const repo = new AgentPromptInjectionsRepository();
    const legacy = repo.listForSession(target.id)[0];
    expect(legacy).toMatchObject({ prompt: 'candidate', accepted: true, error: 'legacy' });
    expect(new AgentPromptInjectionsRepository(db).listForSession(target.id)[0]).toEqual(legacy);
    const fresh = repo.record({ targetSessionId: target.id, callerSessionId: null,
      callerSdkSessionId: null, callerUserId: 1, source: 'http', prompt: 'new' });
    repo.settle(fresh, true);
    expect(new AgentPromptInjectionsRepository(db).listForSession(target.id)[0]).toMatchObject({
      prompt: 'new', accepted: true, error: null,
    });
  });

  it('issue-1577-c6: a false engine enqueue settles a rejected immutable outcome and returns 502', async () => {
    // Regression: promptAsync=false previously fell through as accepted, hiding
    // the engine refusal from both HTTP callers and the durable audit trail.
    promptAsync.mockResolvedValueOnce(false);
    const res = await fetch(`${baseUrl}/agent-sessions/${target.id}/prompt`, {
      method: 'POST', headers, body: JSON.stringify({ prompt: 'engine refusal' }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { message: 'Could not enqueue prompt in Opencode engine.' } });
    expect(new AgentPromptInjectionsRepository().listForSession(target.id)[0]).toMatchObject({
      accepted: false,
    });
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
     expect(body.injections[0].callerSessionId).toBeNull();
     expect(body.injections[0]).toMatchObject({ source: 'http', callerSdkSessionId: null });
  });
});
