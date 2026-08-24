import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import {
  registerProposalApplier,
  registerProposalValidator,
  resetProposalPluginsForTests,
  validateProposalChange,
} from '../services/org_proposal_apply_service';
import { registerAllProposalAppliers } from '../services/org_proposal_appliers_wiring';

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: vi.fn().mockResolvedValue({
      gitnexus: { status: 'connected' },
      rhythm: { status: 'connected' },
      obsidian: { status: 'connected' },
    }),
  },
  opencodeSessionMap: new Map(),
}));

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  resetProposalPluginsForTests();
  registerAllProposalAppliers({ registerProposalApplier, registerProposalValidator });
});

describe('issue-1223-c3: broaden-scope validation rejects a tool id', () => {
  it('names the malformed entry and tells the reviewer to use the server name', async () => {
    // W1: a null allowlist means UNRESTRICTED, and add/remove on it is refused
    // before any entry-shape check — so give this profile a real restricted
    // allowlist, which is the state in which the tool-id-vs-server-name
    // distinction this contract is about actually matters.
    new AgentConfigsRepository().insert({
      id: 'workflow-orchestrator',
      label: 'Workflow Orchestrator',
      icon: 'flow',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'bad grant',
      changeJson: JSON.stringify({
        agentConfigId: 'workflow-orchestrator',
        field: 'allowedMcpsJson',
        add: ['gitnexus_query'],
      }),
      dedupKey: 'issue-1223-c3',
    });

    const result = await validateProposalChange(proposal);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('gitnexus_query');
    expect(result.reason).toContain('gitnexus');
  });
});

describe('issue-1223-c4: removal proposals reject non-server MCP entries', () => {
  it.each(['tighten-scope', 'prune-scope'])('%s rejects a model-facing tool id', async (kind) => {
    new AgentConfigsRepository().insert({
      id: 'workflow-orchestrator',
      label: 'Workflow Orchestrator',
      icon: 'flow',
      allowedMcpsJson: JSON.stringify(['gitnexus_query']),
    });
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind,
      risk: 'low',
      title: 'bad removal',
      changeJson: JSON.stringify({
        agentConfigId: 'workflow-orchestrator',
        field: 'allowedMcpsJson',
        remove: ['gitnexus_query'],
      }),
      dedupKey: `issue-1223-c4:${kind}`,
    });

    const result = await validateProposalChange(proposal);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('gitnexus_query');
  });
});

