import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type WebSocket from 'ws';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { asOpenCodeAgentId, asRhythmProfileId, type AgentKind } from '../models/agent_session';

const { sessionMap, promptAsync, updateSessionAllowlist } = vi.hoisted(() => ({
  sessionMap: new Map<string, string>(),
  promptAsync: vi.fn().mockResolvedValue(true),
  updateSessionAllowlist: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeSessionMap: sessionMap,
  opencodeClient: {
    isReady: true,
    promptAsync,
    updateSessionAllowlist,
    updateSessionSkillAllowlist: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../services/agent_model_resolver', () => ({
  resolveModelForSessionTurnWithProvenance: vi.fn().mockResolvedValue({
    route: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
    requestedSource: 'session_fixed', requestedTier: null, routeAuthed: true,
  }),
}));
vi.mock('../services/decision/turn_routing', () => ({
  routeTurnForSession: vi.fn().mockResolvedValue({ applied: false }),
}));

import { handleInputFrame } from '../services/ws_gateway';

describe('installed chat WebSocket profile identity', () => {
  let sessionId: string;
  let sent: Array<Record<string, unknown>>;

  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    promptAsync.mockClear();
    updateSessionAllowlist.mockClear();
    sent = [];

    const configs = new AgentConfigsRepository();
    configs.insert({ id: 'build', label: 'Disabled built-in', icon: 'robot', enabled: false, ocAgent: 'build' });
    configs.insert({ id: 'bound-profile', label: 'Bound', icon: 'robot', enabled: true, ocAgent: 'build', systemPrompt: 'BOUND PROFILE', allowedMcpsJson: '[]' });
    configs.insert({ id: 'selected-profile', label: 'Selected', icon: 'robot', enabled: true, ocAgent: 'build', systemPrompt: 'SELECTED PROFILE', allowedMcpsJson: '[]' });
    configs.insert({ id: 'selected-plan', label: 'Selected plan', icon: 'robot', enabled: true, ocAgent: 'plan', systemPrompt: 'SELECTED PLAN', allowedMcpsJson: '[]' });
    configs.insert({ id: 'blocked-profile', label: 'Blocked', icon: 'robot', enabled: false, ocAgent: 'build' });
    configs.insert({ id: 'locked-profile', label: 'Locked', icon: 'robot', enabled: true, ocAgent: 'build' });
    db.prepare("UPDATE agent_configs SET locked = 1 WHERE id = 'locked-profile'").run();

    const session = new AgentSessionsRepository().insert({
      agentKind: 'build' as AgentKind,
      profileId: asRhythmProfileId('bound-profile'),
      opencodeAgentId: asOpenCodeAgentId('build'),
      taskId: null, taskTitle: null, cwd: '/tmp/rhythm-ws-profile-identity', name: 'Installed fixture',
    });
    sessionId = session.id;
    sessionMap.set(sessionId, 'sdk-installed-profile');
  });

  async function send(extra: Record<string, unknown> = {}) {
    const ws = { send: (raw: string) => sent.push(JSON.parse(raw) as Record<string, unknown>), readyState: 1 } as unknown as WebSocket;
    await handleInputFrame(ws, { v: 1, type: 'session.input', id: sessionId, data: 'Reply briefly', ...extra });
  }

  it('uses the persisted enabled profile even when its engine alias names a disabled config', async () => {
    await send();
    expect(sent.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(promptAsync).toHaveBeenCalledOnce();
    expect(promptAsync.mock.calls[0]?.[4]).toMatchObject({ agent: 'build', system: 'BOUND PROFILE' });
    expect(updateSessionAllowlist.mock.calls[0]?.[1]).toMatchObject({ role: 'bound-profile' });
  });

  it('uses an explicitly selected enabled profile, not its shared engine alias', async () => {
    await send({ profileId: 'selected-profile', agent: 'build' });
    expect(sent.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(promptAsync).toHaveBeenCalledOnce();
    expect(promptAsync.mock.calls[0]?.[4]).toMatchObject({ agent: 'build', system: 'SELECTED PROFILE' });
    expect(updateSessionAllowlist.mock.calls[0]?.[1]).toMatchObject({ role: 'selected-profile' });
  });

  it('preserves an explicit engine mode change when the matching profile ID is supplied', async () => {
    await send({ profileId: 'selected-plan', agent: 'plan' });
    expect(sent.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(promptAsync).toHaveBeenCalledOnce();
    expect(promptAsync.mock.calls[0]?.[4]).toMatchObject({ agent: 'plan', system: 'SELECTED PLAN' });
  });

  it('accepts an unambiguous legacy profile ID in the agent field and sends its engine name', async () => {
    await send({ agent: 'selected-plan' });
    expect(sent.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(promptAsync).toHaveBeenCalledOnce();
    expect(promptAsync.mock.calls[0]?.[4]).toMatchObject({ agent: 'plan', system: 'SELECTED PLAN' });
  });

  it('accepts an unambiguous legacy profile ID on an agent-less session', async () => {
    const agentless = new AgentSessionsRepository().insert({
      agentKind: '' as AgentKind, taskId: null, taskTitle: null,
      cwd: '/tmp/rhythm-ws-profile-identity', name: 'Agent-less fixture',
    });
    sessionId = agentless.id;
    sessionMap.set(sessionId, 'sdk-agentless-profile');
    await send({ agent: 'selected-plan' });
    expect(sent.filter((frame) => frame.type === 'error')).toEqual([]);
    expect(promptAsync).toHaveBeenCalledOnce();
    expect(promptAsync.mock.calls[0]?.[4]).toMatchObject({ agent: 'plan', system: 'SELECTED PLAN' });
  });

  it('rejects a disabled explicitly selected profile before dispatch', async () => {
    await send({ profileId: 'blocked-profile', agent: 'build' });
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', id: sessionId, message: expect.stringContaining('disabled') }));
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('rejects a security-locked explicitly selected profile before dispatch', async () => {
    await send({ profileId: 'locked-profile', agent: 'build' });
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', id: sessionId, message: expect.stringContaining('locked') }));
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('rejects an unknown explicitly selected profile before dispatch', async () => {
    await send({ profileId: 'missing-profile', agent: 'build' });
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', id: sessionId }));
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('rejects a canonical profile paired with a mismatched engine mode', async () => {
    await send({ profileId: 'selected-plan', agent: 'build' });
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error', id: sessionId, message: expect.stringContaining('does not match') }));
    expect(promptAsync).not.toHaveBeenCalled();
  });
});
