// C2: a real SQLite runner read must retain profile identity, not infer it from agentKind.
// Only the external engine transport is fake; runner, scope, configs and session persistence are real.
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { ORG_REVIEWER_PROFILE_ID } from '../services/org_reviewer_seed';

const transport = vi.hoisted(() => ({ prompt: vi.fn() }));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-c2' }),
    prompt: transport.prompt,
    listMcp: vi.fn().mockResolvedValue({}),
    abortSession: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue({ stream: { async *[Symbol.asyncIterator]() {} } }),
  },
  opencodeSessionMap: new Map<string, string>(),
}));
import { run, type AgentRunOptions } from '../services/agent_runner';

const profileId = 'abfcbfa1-90bf-4eaf-b1de-001cb4e4fb27';
describe('C2 authoritative runner profile identity', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    db.prepare("INSERT INTO users (id, name, email, role) VALUES (2, 'Synthetic owner', 'c2@example.invalid', 'member')").run();
    new AgentConfigsRepository().insert({ id: profileId, label: 'C2 UUID profile', icon: 'flask', enabled: true,
      isAgent: true, schedulable: true, ocAgent: 'plan', modelProvider: 'synthetic-c2', modelId: 'text',
      allowedMcpsJson: '[]', allowedSkillsJson: '[]', allowedDelegatesJson: '[]' });
    transport.prompt.mockReset().mockResolvedValue({ info: { sessionID: 'sdk-c2' }, parts: [{ type: 'text', text: 'C2 answer' }] });
  });
  afterEach(() => { getDb().close(); });

  it.each(['ordinary', 'scheduled', 'explicit-config', 'model-override'] as const)(
    'C2-c1 %s: persists UUID profile separately from plan engine name with owner/lineage/model', async mode => {
      const repo = new AgentSessionsRepository();
      const parent = repo.insert({ taskId: null, name: 'Synthetic C2 parent', agentKind: 'claude-code', cwd: '/synthetic/c2', ownerUserId: 2 });
      const opts: AgentRunOptions = { prompt: 'C2 answer', cwd: '/synthetic/c2', agentKind: profileId,
        ownerUserId: 2, parentSessionId: parent.id, delegationDepth: 1 };
      if (mode === 'scheduled') {
        opts.scheduledTaskId = (await new AgentScheduledTasksRepository().createAsync({ name: 'C2 schedule', prompt: 'C2 answer',
          scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', agentConfigId: profileId })).id;
        opts.parentSessionId = undefined;
        opts.delegationDepth = 0;
      }
      if (mode === 'explicit-config') { opts.agentConfigId = profileId; opts.agentKind = 'claude-code'; }
      if (mode === 'model-override') opts.modelOverride = { providerID: 'synthetic-override', modelID: 'override-text' };
      expect(new AgentConfigsRepository().getById(profileId)?.ocAgent).toBe('plan');
      expect(profileId).not.toBe('plan');
      const result = await run(opts);
      expect(result.status).toBe('done');
      // Fresh repository consumption, not a spy on insert or an in-memory optimistic payload.
      expect(new AgentSessionsRepository().findById(result.sessionId)).toMatchObject({
        profileId, opencodeAgentId: 'plan', ownerUserId: 2, parentSessionId: opts.parentSessionId ?? null,
        delegationDepth: opts.delegationDepth, scheduledTaskId: opts.scheduledTaskId ?? null,
        sdkSessionId: 'sdk-c2', providerId: null, modelId: null,
        category: mode === 'scheduled' ? 'scheduled' : 'chat',
      });
      expect(transport.prompt.mock.calls[0][4].agent).toBe('plan');
      expect(transport.prompt.mock.calls[0][2]).toEqual(opts.modelOverride ?? { providerID: 'synthetic-c2', modelID: 'text' });
    });

  it('C2-c2 preserves configured default engine omission without inventing build identity', async () => {
    new AgentConfigsRepository().update(profileId, { ocAgent: null });
    const result = await run({ prompt: 'C2 default engine', agentConfigId: profileId });
    expect(result.status).toBe('done');
    const session = new AgentSessionsRepository().findById(result.sessionId);
    expect(session?.profileId).toBe(profileId);
    expect(getDb().prepare('SELECT agent_mode FROM agent_sessions WHERE id=?').get(result.sessionId)).toEqual({ agent_mode: null });
    expect(transport.prompt.mock.calls[0][4].agent).toBeUndefined();
  });

  it.each([undefined, 'legacy-unconfigured-engine'])('C2-c3 unconfigured legacy %s does not invent a profile', async agentKind => {
    const result = await run({ prompt: 'C2 legacy', agentKind });
    expect(result.status).toBe('done');
    expect(new AgentSessionsRepository().findById(result.sessionId)?.profileId).toBeNull();
    expect(getDb().prepare('SELECT profile_id, agent_mode FROM agent_sessions WHERE id=?').get(result.sessionId)).toEqual({ profile_id: null, agent_mode: null });
    expect(transport.prompt.mock.calls[0][4].agent).toBeUndefined();
  });

  it('C2-c4 preserves Org Reviewer identity and default permissions without running optimizer', async () => {
    new AgentConfigsRepository().insert({ id: ORG_REVIEWER_PROFILE_ID, label: 'Reviewer', icon: 'flask',
      enabled: true, schedulable: true, ocAgent: 'plan', modelProvider: 'synthetic-c2', modelId: 'text',
      allowedMcpsJson: '[]', allowedSkillsJson: '[]', allowedDelegatesJson: '[]' });
    const result = await run({ prompt: 'Synthetic identity only', agentConfigId: ORG_REVIEWER_PROFILE_ID });
    expect(result.status).toBe('done');
    expect(new AgentSessionsRepository().findById(result.sessionId)).toMatchObject({
      profileId: ORG_REVIEWER_PROFILE_ID, opencodeAgentId: ORG_REVIEWER_PROFILE_ID, permissionMode: 'default',
    });
    expect(transport.prompt.mock.calls[0][4]).toMatchObject({ agent: ORG_REVIEWER_PROFILE_ID, permissionMode: 'default' });
  });
});
