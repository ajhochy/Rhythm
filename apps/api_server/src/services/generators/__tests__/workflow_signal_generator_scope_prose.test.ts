import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../../../database/db';
import { runMigrations } from '../../../database/migrations';
import { AgentConfigsRepository } from '../../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../../repositories/agent_org_proposals_repository';
import type { OrgAuditSnapshot } from '../../org_audit_service';

function snapshot(agentConfigId: string): OrgAuditSnapshot {
  return {
    auditRunId: 'scope-prose', generatedAt: new Date().toISOString(), engineAvailable: true,
    profiles: [], skills: [], skillOverlapCandidates: [], recipes: [], delegationEdges: [],
    webhookEndpoints: [], deniedToolAggregates: [], drift: [], gaps: [],
    workflowFailureSignals: [{
      category: 'retry-loop', agentConfigId, count: 1, confidence: 'high',
      sessionIds: ['scope-prose-session'], evidence: 'scope prose regression', dedupToken: `scope-prose:${agentConfigId}`,
    }],
  };
}

async function patchFromProse(concreteFix: string) {
  const configs = new AgentConfigsRepository();
  const config = configs.insert({ id: 'scope-prose-agent', label: 'Scope prose agent', icon: 'verified' });
  const { generateDiagnosisProposals } = await import('../workflow_signal_generator');
  const result = await generateDiagnosisProposals(snapshot(config.id), {
    configsRepo: configs,
    proposalsRepo: new AgentOrgProposalsRepository(),
    diagnose: async () => ({
      diagnosis: 'Scope needs adjustment.', rootCause: 'scope', fixType: 'scope-change', concreteFix, confidence: 'high',
    }),
  });
  return JSON.parse(result.created[0].changeJson!) as { scopePatch?: unknown };
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

describe('deriveScopePatchFromProse core-permission guard', () => {
  it('derives an allow patch only from explicitly quoted core permission targets', async () => {
    await expect(patchFromProse('Add `read`, `glob`, and `bash` to the permission scope')).resolves.toMatchObject({
      scopePatch: {
        agentConfigId: 'scope-prose-agent', field: 'corePermissionsJson',
        set: { read: 'allow', glob: 'allow', bash: 'allow' },
      },
    });
  });

  it('keeps an MCP patch when prose merely mentions reading email', async () => {
    await expect(patchFromProse('Add `gmail-work` MCP so the agent can read email')).resolves.toMatchObject({
      scopePatch: { agentConfigId: 'scope-prose-agent', field: 'allowedMcpsJson', add: ['gmail-work'] },
    });
  });

  it('derives an unset patch for explicitly quoted core permissions removed from permission scope', async () => {
    await expect(patchFromProse('Remove `read` and `bash` from core permissions')).resolves.toMatchObject({
      scopePatch: { agentConfigId: 'scope-prose-agent', field: 'corePermissionsJson', unset: ['read', 'bash'] },
    });
  });
});
