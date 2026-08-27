import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { OrgAuditSnapshot } from '../services/org_audit_service';
import type { WorkflowFailureSignal } from '../services/workflow_failure_signal_extractor';

function snapshot(signals: WorkflowFailureSignal[] = []): OrgAuditSnapshot {
  return {
    auditRunId: 'issue-1480', generatedAt: new Date().toISOString(), engineAvailable: true,
    profiles: [], skills: [], skillOverlapCandidates: [], recipes: [], delegationEdges: [],
    webhookEndpoints: [], deniedToolAggregates: [], drift: [], gaps: [], workflowFailureSignals: signals,
  };
}

function retrySignal(sessionIds: string[]): WorkflowFailureSignal {
  return {
    category: 'retry-loop', sessionIds, agentConfigId: 'workflow-orchestrator', count: 3,
    confidence: 'high', dedupToken: 'workflow-orchestrator:gitnexus_query:input-hash',
    retryTool: 'gitnexus_query', retryInputHash: 'input-hash',
    evidence: `tool=gitnexus_query inputHash=input-hash attempts=3 failedOrTimeout=3 sessionIds=${sessionIds.join(',')}`,
  };
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

describe('#1480 optimizer recipe signal quality', () => {
  it('issue-1480-c1: never emits a create-recipe whose only step equals its title', async () => {
    // Regression caught: the exact title-only shell reaches the human review queue.
    const { generateWorkflowSignalProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(snapshot([retrySignal(['s1', 's2'])]));

    for (const proposal of created.filter((p) => p.kind === 'create-recipe')) {
      const change = JSON.parse(proposal.changeJson!);
      const steps = JSON.parse(change.steps_json);
      expect(steps).not.toEqual([{ action: 'prompt', text: change.title }]);
    }
  });

  it('issue-1480-c2: requires retry-loop evidence from multiple sessions', async () => {
    // Regression caught: one transient session consumes proposal budget as recurring friction.
    const { generateWorkflowSignalProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(snapshot([retrySignal(['only-session'])]));
    expect(created.filter((p) => p.kind === 'create-recipe')).toHaveLength(0);
  });

  it('issue-1480-c4: aggregates the same retry operation across two distinct sessions into one recipe', async () => {
    // Regression caught: per-session retry signals are each suppressed before recurrence can be established.
    const { generateWorkflowSignalProposals } = await import('../services/generators/workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(snapshot([
      retrySignal(['session-one']),
      retrySignal(['session-two']),
    ]));
    const recipes = created.filter((p) => p.kind === 'create-recipe');

    expect(recipes).toHaveLength(1);
    const change = JSON.parse(recipes[0].changeJson!);
    expect(JSON.parse(change.steps_json)).not.toEqual([{ action: 'prompt', text: change.title }]);
  });

  it('issue-1480-c3: refine-recipe skips a title-only shell without calling the critic', async () => {
    // Regression caught: the critic scores a generator-created shell 0/100 and proposes padding.
    const scorer = vi.fn(async () => ({ score: 0, reason: 'empty procedure' }));
    const input = snapshot();
    input.recipes = [{
      id: 'shell', title: 'Recipe: reduce retry loops (workflow-orchestrator)', description: 'shell',
      stepsJson: JSON.stringify([{ action: 'prompt', text: 'Recipe: reduce retry loops (workflow-orchestrator)' }]),
      boundConfigId: null, ownerUserId: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
    const { generateRecipeProposals } = await import('../services/generators/recipe_generator');
    const { created } = await generateRecipeProposals(input, { scorer });

    expect(scorer).not.toHaveBeenCalled();
    expect(created.filter((p) => p.kind === 'refine-recipe')).toHaveLength(0);
  });
});
