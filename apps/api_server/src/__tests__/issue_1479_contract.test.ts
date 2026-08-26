/** Acceptance contract for #1479: phantom per-tool MCP grants. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

const listMcp = vi.fn();
const listMcpToolIds = vi.fn();
const listSkills = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: (...args: unknown[]) => listMcp(...args),
    listMcpToolIds: (...args: unknown[]) => listMcpToolIds(...args),
    listSkills: (...args: unknown[]) => listSkills(...args),
    reloadConfig: vi.fn().mockResolvedValue(true),
  },
  opencodeSessionMap: new Map(),
}));

vi.mock('../services/agent_profile_projection_service', () => ({
  projectAgentProfileAfterWrite: vi.fn(() => ({ kind: 'written' })),
}));
vi.mock('../services/ws_gateway', () => ({
  broadcastAgentConfigsChanged: vi.fn(),
}));

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  listMcp.mockReset().mockResolvedValue({
    obsidian: { status: 'connected' },
    rhythm: { status: 'connected' },
  });
  listMcpToolIds.mockReset().mockResolvedValue([
    'obsidian_obsidian_simple_search',
    'rhythm_rhythm_list_tasks',
  ]);
  listSkills.mockReset().mockResolvedValue([]);
});

describe('issue-1479-c1: writes validate explicit MCP tools against the live catalog', () => {
  it('rejects phantom tools on PATCH and proposal apply without mutating the profile', async () => {
    // Regression caught: plausible strings were persisted because only JSON shape was validated.
    const repo = new AgentConfigsRepository();
    const config = repo.insert({
      id: 'theologian',
      label: 'Theologian',
      icon: 'book',
      allowedMcpsJson: JSON.stringify({ obsidian: ['obsidian_simple_search'], rhythm: null }),
    });

    const { AgentConfigsController } = await import('../controllers/agent_configs_controller');
    const next = vi.fn();
    await new AgentConfigsController().patch(
      {
        params: { id: config.id },
        body: { allowedMcpsJson: JSON.stringify({ obsidian: ['obsidian_get_file'] }) },
      } as never,
      { json: vi.fn(), status: vi.fn().mockReturnThis() } as never,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(repo.getById(config.id)?.allowedMcpsJson).toBe(
      JSON.stringify({ obsidian: ['obsidian_simple_search'], rhythm: null }),
    );

    repo.update(config.id, {
      allowedMcpsJson: JSON.stringify({ obsidian: ['obsidian_get_file'], rhythm: null }),
    });
    const proposals = new (await import('../repositories/agent_org_proposals_repository')).AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'Remove rhythm',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['rhythm'],
      }),
      dedupKey: 'issue-1479-proposal-apply',
    });
    const wiring = await import('../services/org_proposal_appliers_wiring');
    wiring.registerAllProposalAppliers();
    const apply = await import('../services/org_proposal_apply_service');
    await expect(apply.applyProposal(proposal)).rejects.toThrow(/obsidian_get_file|unknown.*tool/i);
  });
});

describe('issue-1479-c2: drift detection reaches per-tool granularity', () => {
  it('emits a prune-scope gap for a phantom tool under a live server', async () => {
    // Regression caught: server-only drift reported obsidian as healthy and hid its phantom grant.
    new AgentConfigsRepository().insert({
      id: 'theologian',
      label: 'Theologian',
      icon: 'book',
      allowedMcpsJson: JSON.stringify({
        obsidian: ['obsidian_simple_search', 'obsidian_get_file'],
      }),
    });

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();
    expect(snapshot.drift).toContainEqual({
      profileId: 'theologian',
      scopeKind: 'mcp-tool',
      serverName: 'obsidian',
      name: 'obsidian_get_file',
      matched: false,
    });
    expect(snapshot.gaps.map((gap) => gap.evidence)).toContain(
      'profile=theologian scopeKind=mcp-tool serverName=obsidian deadName=obsidian_get_file',
    );
  });
});

describe('issue-1479-c3: existing rows have a one-time report pass', () => {
  it('reports every phantom grant without changing stored agent_configs bytes', async () => {
    // Regression caught: existing bad rows remained invisible unless a user happened to edit them.
    const repo = new AgentConfigsRepository();
    const theologian = repo.insert({
      id: 'theologian',
      label: 'Theologian',
      icon: 'book',
      allowedMcpsJson: JSON.stringify({
        obsidian: ['obsidian_simple_search', 'obsidian_get_file'],
      }),
    });
    const before = theologian.allowedMcpsJson;

    const audit = await import('../services/org_audit_service');
    const reportFn = (audit as unknown as {
      reportMcpToolGrantDrift?: () => Promise<Array<{
        profileId: string;
        serverName: string;
        toolName: string;
      }>>;
    }).reportMcpToolGrantDrift;
    expect(reportFn).toBeTypeOf('function');
    if (!reportFn) return;
    await expect(reportFn()).resolves.toEqual([
      { profileId: 'theologian', serverName: 'obsidian', toolName: 'obsidian_get_file' },
    ]);
    expect(repo.getById('theologian')?.allowedMcpsJson).toBe(before);
    expect(
      getDb().prepare(`SELECT COUNT(*) AS count FROM agent_configs`).get(),
    ).toEqual(expect.objectContaining({ count: expect.any(Number) }));
  });
});
