import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { OrgAuditSnapshot } from '../services/org_audit_service';
import type { WorkflowFailureSignal } from '../services/workflow_failure_signal_extractor';

function signal(evidence: string, category: WorkflowFailureSignal['category'] = 'retry-loop'): WorkflowFailureSignal {
  return { category, evidence, sessionIds: ['s1', 's2'], agentConfigId: 'secretary', count: 2,
    confidence: 'high', dedupToken: `secretary:${category}` };
}

function snapshot(signals: WorkflowFailureSignal[]): OrgAuditSnapshot {
  return { auditRunId: 'issue-1481', generatedAt: new Date().toISOString(), engineAvailable: true,
    profiles: [], skills: [], skillOverlapCandidates: [], recipes: [], delegationEdges: [],
    webhookEndpoints: [], deniedToolAggregates: [], drift: [], gaps: [], workflowFailureSignals: signals };
}

beforeEach(() => {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); setDb(db);
  new AgentConfigsRepository().insert({ id: 'secretary', label: 'Secretary', icon: 'x' });
});

describe('#1481 evidence-grounded workflow diagnosis', () => {
  it.each([
    '$bunfs/root/chunk-123.js at SessionProcessor.cleanup',
    "The previous request exceeded the provider's size limit due to large media attachments",
    'Cannot connect to API at http://127.0.0.1:4001',
  ])('issue-1481-c1: infra evidence is excluded before diagnosis: %s', async (evidence) => {
    // Regression caught: infrastructure failures are presented to the skill-diagnosis LLM.
    const diagnose = vi.fn();
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal(evidence)]), { diagnose });
    expect(diagnose).not.toHaveBeenCalled();
    expect(result.created).toHaveLength(0);
  });

  it('issue-1481-c2: unverified no-recurring-error evidence cannot produce a skill replacement', async () => {
    // Regression caught: an unverified vacuum becomes a high-confidence full skill rewrite.
    const diagnose = vi.fn(async () => ({ diagnosis: 'Replace the skill', rootCause: 'skill' as const,
      fixType: 'skill-edit' as const, concreteFix: 'COMPLETE REPLACEMENT BODY', confidence: 'high' as const,
      evidenceQuotes: ['No single recurring error — likely a systemic profile/skill/config issue'] }));
    const evidence = 'No single recurring error — likely a systemic profile/skill/config issue';
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal(evidence, 'unverified-claim')]), { diagnose });
    expect(result.created.filter((p) => p.kind === 'workflow-prompt-fix')).toHaveLength(0);
  });

  it('issue-1481-c3: discards a skill diagnosis with no exact supporting evidence quote', async () => {
    // Regression caught: invented retry/over-delegation causes surface at confidence 0.8.
    const diagnose = vi.fn(async () => ({ diagnosis: 'Over-delegation causes retry loops', rootCause: 'skill' as const,
      fixType: 'skill-edit' as const, concreteFix: 'Replace the body', confidence: 'high' as const,
      evidenceQuotes: ['the agent delegated repeatedly'] }));
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal('provider returned an oversized attachment error')]), { diagnose });
    expect(result.created).toHaveLength(0);
  });
});
