// The engine's built-in `plan` agent must not be offered as a Rhythm agent.
//
// Reported 2026-08-06: "plan mode is a built in opencode agent that we do not
// use. it should not show up in our agent list and our agents should not be
// able to delegate to it."
//
// Measured live before the fix: `GET /agent-sessions/agents` returned 43 entries
// and ALL SEVEN engine built-ins were among them — `build`, `plan`, `explore`,
// `general`, `compaction`, `summary`, `title` — in both the raw and `view=picker`
// shapes. The engine does not set `builtIn` on them (it came back undefined), so
// they were indistinguishable from Rhythm's own projected profiles.
//
// Delegation was already safe and these tests pin that so it cannot regress:
//   - `task` projects `{"*": "deny", explore: allow, general: allow}`, so `plan`
//     was never an allowed target.
//   - `rhythm_delegate` / `rhythm_delegate_async` resolve the target through
//     `requireExecutableProfile`, which needs an `agent_configs` row; `plan` has
//     none because BUILTIN_OPENCODE_AGENT_IDS excludes it from the writer.
// The one real hole was that the delegate roster is spread AFTER the natives, so
// a roster entry naming `plan` would have overridden the deny.
import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

const { engineState, listAgentsMock, syncProfilesMock } = vi.hoisted(() => ({
  engineState: { isReady: true },
  listAgentsMock: vi.fn(),
  syncProfilesMock: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return engineState.isReady;
    },
    listAgents: listAgentsMock,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/agent_profile_sync', () => ({
  syncOpencodeAgentProfiles: syncProfilesMock,
}));

import { AgentSessionsController } from '../controllers/agent_sessions_controller';
import {
  buildTaskDelegatePermissions,
  isSelectableEngineAgent,
} from '../services/opencode_agent_writer';

function responseRecorder(): { res: Response; body: () => unknown } {
  let captured: unknown = null;
  const res = {
    status() {
      return this;
    },
    json(body: unknown) {
      captured = body;
      return this;
    },
    end() {
      return this;
    },
  } as unknown as Response;
  return { res, body: () => captured };
}

const next = ((error?: unknown) => {
  if (error) throw error;
}) as NextFunction;

/** The engine's real reply shape: seven built-ins, `builtIn` NOT set. */
const ENGINE_BUILTINS = [
  { name: 'build', mode: 'primary' },
  { name: 'plan', mode: 'primary' },
  { name: 'explore', mode: 'subagent' },
  { name: 'general', mode: 'subagent' },
  { name: 'compaction', mode: 'primary' },
  { name: 'summary', mode: 'primary' },
  { name: 'title', mode: 'primary' },
];

function agentNames(body: unknown): string[] {
  const agents = (body as { agents: Array<Record<string, unknown>> }).agents;
  return agents.map((a) => (a.name ?? a.opencodeAgentId) as string);
}

describe('engine built-ins are not offered as Rhythm agents', () => {
  let controller: AgentSessionsController;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    controller = new AgentSessionsController();
    engineState.isReady = true;
    listAgentsMock.mockReset();
    syncProfilesMock.mockReset().mockResolvedValue({ synced: 0 });
  });

  it('plan is absent from the raw agent list', async () => {
    listAgentsMock.mockResolvedValue(ENGINE_BUILTINS);
    const { res, body } = responseRecorder();
    await controller.listAgents({ query: {} } as unknown as Request, res, next);
    expect(agentNames(body())).not.toContain('plan');
  });

  it('plan is absent from the picker list', async () => {
    listAgentsMock.mockResolvedValue(ENGINE_BUILTINS);
    const { res, body } = responseRecorder();
    await controller.listAgents(
      { query: { view: 'picker' } } as unknown as Request,
      res,
      next,
    );
    expect(agentNames(body())).not.toContain('plan');
  });

  it('the internal pipeline agents and task-only subagents are hidden too', async () => {
    // Same defect, same root cause — filtering only `plan` would leave five
    // siblings leaking into the picker.
    listAgentsMock.mockResolvedValue(ENGINE_BUILTINS);
    const { res, body } = responseRecorder();
    await controller.listAgents({ query: {} } as unknown as Request, res, next);
    const names = agentNames(body());
    for (const hidden of [
      'plan',
      'explore',
      'general',
      'compaction',
      'summary',
      'title',
    ]) {
      expect(names).not.toContain(hidden);
    }
  });

  it('build SURVIVES — it is the engine default Rhythm falls back to', async () => {
    listAgentsMock.mockResolvedValue(ENGINE_BUILTINS);
    const { res, body } = responseRecorder();
    await controller.listAgents({ query: {} } as unknown as Request, res, next);
    expect(agentNames(body())).toEqual(['build']);
  });

  it("Rhythm's own profiles are never filtered", async () => {
    new AgentConfigsRepository().insert({
      id: 'coding-agent',
      label: 'Coding Workflow',
      icon: 'terminal',
      enabled: true,
      isAgent: true,
      sessionSelectable: true,
      ocAgent: 'coding-agent',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      reasoningEffort: 'high',
    });
    listAgentsMock.mockResolvedValue([
      ...ENGINE_BUILTINS,
      { name: 'coding-agent', mode: 'primary' },
    ]);
    const { res, body } = responseRecorder();
    await controller.listAgents({ query: {} } as unknown as Request, res, next);
    const names = agentNames(body());
    expect(names).toContain('coding-agent');
    expect(names).not.toContain('plan');
  });

  it('refreshAgents still reconciles against the UNFILTERED engine list', async () => {
    // Hiding an agent from the picker must not change what profile sync sees,
    // or the filter would silently deactivate profiles as a side effect.
    listAgentsMock.mockResolvedValue(ENGINE_BUILTINS);
    const { res } = responseRecorder();
    await controller.refreshAgents(
      { query: {} } as unknown as Request,
      res,
      next,
    );
    const syncedWith = syncProfilesMock.mock.calls[0][0] as Array<{
      name: string;
    }>;
    expect(syncedWith.map((a) => a.name)).toContain('plan');
  });
});

describe('isSelectableEngineAgent', () => {
  it('allows only build among the engine built-ins', () => {
    expect(isSelectableEngineAgent('build')).toBe(true);
    for (const hidden of [
      'plan',
      'explore',
      'general',
      'compaction',
      'summary',
      'title',
    ]) {
      expect(isSelectableEngineAgent(hidden)).toBe(false);
    }
  });

  it('passes through any non-built-in name', () => {
    expect(isSelectableEngineAgent('coding-agent')).toBe(true);
    expect(isSelectableEngineAgent('ui-ux-designer')).toBe(true);
  });
});

describe('buildTaskDelegatePermissions cannot be tricked into granting plan', () => {
  it('denies plan by default', () => {
    const perms = buildTaskDelegatePermissions(['coding-agent'], 'manager');
    expect(perms['*']).toBe('deny');
    expect(perms.plan).toBeUndefined();
  });

  it('drops a roster entry naming plan instead of granting it', () => {
    // The hole: the roster is spread AFTER the natives, so this entry used to
    // land as `plan: allow` and override the wildcard deny.
    const perms = buildTaskDelegatePermissions(
      ['coding-agent', 'plan'],
      'manager',
    );
    expect(perms.plan).toBeUndefined();
    expect(perms['coding-agent']).toBe('allow');
    expect(perms['*']).toBe('deny');
  });

  it('drops every built-in from a roster, not just plan', () => {
    const perms = buildTaskDelegatePermissions(
      ['build', 'plan', 'compaction', 'summary', 'title', 'real-agent'],
      'manager',
    );
    expect(perms.build).toBeUndefined();
    expect(perms.compaction).toBeUndefined();
    expect(perms.summary).toBeUndefined();
    expect(perms.title).toBeUndefined();
    expect(perms['real-agent']).toBe('allow');
  });

  it('still grants the two native subagents', () => {
    // explore/general come from TASK_NATIVE_SUBAGENTS, not the roster, so the
    // built-in filter must not strip them.
    const perms = buildTaskDelegatePermissions([], null);
    expect(perms.explore).toBe('allow');
    expect(perms.general).toBe('allow');
  });

  it('a roster naming explore/general does not downgrade them', () => {
    const perms = buildTaskDelegatePermissions(['explore', 'general'], null);
    expect(perms.explore).toBe('allow');
    expect(perms.general).toBe('allow');
  });

  it('planning-agent is NOT confused with the built-in plan', () => {
    // A real Rhythm profile whose id merely starts with "plan". The live DB has
    // `planning-agent` and `worship-planning` in rosters; a substring match
    // would have silently revoked both.
    const perms = buildTaskDelegatePermissions(
      ['planning-agent', 'worship-planning'],
      null,
    );
    expect(perms['planning-agent']).toBe('allow');
    expect(perms['worship-planning']).toBe('allow');
  });
});
