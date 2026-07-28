/**
 * #1135 — GET /agent-sessions/agents must exclude any engine agent whose
 * matching agent_configs row is DISABLED (gap B in the issue: the registry
 * response was returned verbatim, so a disabled profile's stale .md still
 * appeared in the picker with mode=subagent). Built-ins and engine-only
 * agents with no matching DB row must still pass through unfiltered
 * (fail-open — this is a leak-closing filter, not a new allowlist).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { runMigrations } from '../../database/migrations';
import { getDb, setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';

const { mockListAgents, mockSync, engineState } = vi.hoisted(() => ({
  mockListAgents: vi.fn(),
  mockSync: vi.fn(),
  engineState: { isReady: true },
}));

vi.mock('../../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return engineState.isReady;
    },
    listAgents: mockListAgents,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// Fire-and-forget mirror sync — irrelevant to this filter test; stub it out so
// the test only exercises the registry-filter logic, not the sync pipeline.
vi.mock('../../services/agent_profile_sync', () => ({
  syncOpencodeAgentProfiles: mockSync,
}));

import { AgentSessionsController } from '../agent_sessions_controller';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

function makeResponse() {
  const state: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, state };
}

function agentNames(body: unknown): string[] {
  return (body as { agents: Array<{ name: string }> }).agents.map((a) => a.name);
}

describe('AgentSessionsController.listAgents — #1135 disabled-profile registry filter', () => {
  let repo: AgentConfigsRepository;
  let controller: AgentSessionsController;
  let next: NextFunction;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
    controller = new AgentSessionsController();
    engineState.isReady = true;
    mockListAgents.mockReset();
    mockSync.mockReset().mockResolvedValue({ synced: 0 });
    next = ((err?: unknown) => {
      if (err) throw err;
    }) as NextFunction;
  });

  it('drops a disabled slug-keyed profile, keeps a built-in, an enabled profile, and an unknown engine agent', async () => {
    repo.insert({
      id: 'disabled-researcher',
      label: 'Disabled Researcher',
      icon: '',
      isAgent: true,
      enabled: false,
      ocAgent: 'disabled-researcher',
      sessionSelectable: true,
      sortOrder: 100,
    });
    repo.insert({
      id: 'enabled-researcher',
      label: 'Enabled Researcher',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'enabled-researcher',
      sessionSelectable: true,
      sortOrder: 100,
    });

    mockListAgents.mockResolvedValue([
      { name: 'disabled-researcher', builtIn: false, mode: 'subagent' },
      { name: 'enabled-researcher', builtIn: false, mode: 'subagent' },
      { name: 'build', builtIn: true, mode: 'primary' },
      { name: 'unknown-engine-agent', builtIn: false, mode: 'subagent' },
    ]);

    const req = { query: {} } as unknown as Request;
    const { res, state } = makeResponse();
    await controller.listAgents(req, res, next);

    const names = agentNames(state.body);
    expect(names).not.toContain('disabled-researcher');
    expect(names).toContain('enabled-researcher');
    expect(names).toContain('build');
    expect(names).toContain('unknown-engine-agent');
  });

  it('drops a disabled UUID-keyed profile matched via its ocAgent handle', async () => {
    repo.insert({
      id: '77777777-7777-4777-8777-777777777777',
      label: 'UUID Profile',
      icon: '',
      isAgent: true,
      enabled: false,
      ocAgent: 'uuid-engine-name',
      sessionSelectable: true,
      sortOrder: 100,
    });

    mockListAgents.mockResolvedValue([{ name: 'uuid-engine-name', builtIn: false, mode: 'subagent' }]);

    const req = { query: {} } as unknown as Request;
    const { res, state } = makeResponse();
    await controller.listAgents(req, res, next);

    expect(agentNames(state.body)).not.toContain('uuid-engine-name');
  });

  it('re-enabling the profile makes it reappear', async () => {
    repo.insert({
      id: 'toggle-agent',
      label: 'Toggle Agent',
      icon: '',
      isAgent: true,
      enabled: false,
      ocAgent: 'toggle-agent',
      sessionSelectable: true,
      sortOrder: 100,
    });
    mockListAgents.mockResolvedValue([{ name: 'toggle-agent', builtIn: false, mode: 'subagent' }]);

    const req = { query: {} } as unknown as Request;
    const disabledPass = makeResponse();
    await controller.listAgents(req, disabledPass.res, next);
    expect(agentNames(disabledPass.state.body)).not.toContain('toggle-agent');

    repo.update('toggle-agent', { enabled: true });
    const enabledPass = makeResponse();
    await controller.listAgents(req, enabledPass.res, next);
    expect(agentNames(enabledPass.state.body)).toContain('toggle-agent');
  });

  it('keeps a security-locked profile hidden after enabled-column drift, including reserved ids', async () => {
    repo.insert({
      id: 'locked-researcher',
      label: 'Locked Researcher',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'locked-researcher',
    });
    repo.lockForSecurity('locked-researcher', 'audit finding', 'reviewer');
    repo.lockForSecurity('claude-code', 'preset audit finding', 'reviewer');
    getDb()
      .prepare(`UPDATE agent_configs SET enabled = 1 WHERE id IN ('locked-researcher', 'claude-code')`)
      .run();
    mockListAgents.mockResolvedValue([
      { name: 'locked-researcher', builtIn: false, mode: 'subagent' },
      { name: 'claude-code', builtIn: true, mode: 'primary' },
      { name: 'build', builtIn: true, mode: 'primary' },
    ]);

    const { res, state } = makeResponse();
    await controller.listAgents({ query: {} } as unknown as Request, res, next);

    expect(agentNames(state.body)).not.toContain('locked-researcher');
    expect(agentNames(state.body)).not.toContain('claude-code');
    expect(agentNames(state.body)).toContain('build');
  });

  it('returns an empty list (unchanged) when the engine is not ready', async () => {
    engineState.isReady = false;
    const req = { query: {} } as unknown as Request;
    const { res, state } = makeResponse();
    await controller.listAgents(req, res, next);
    expect(state.body).toEqual({ agents: [] });
    expect(mockListAgents).not.toHaveBeenCalled();
  });
});
