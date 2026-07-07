/**
 * Tests for issue #935 — workflow failure signals feed the EXISTING
 * refine-recipe / delegation proposal lanes (no new proposal kind, no
 * separate workflow-optimizer pipeline).
 *
 * Covers:
 *  - a session-errored signal on a session bound to an inadequate cookbook
 *    recipe produces exactly one LOW-risk refine-recipe proposal citing the
 *    session's evidence.
 *  - a session-errored signal with no bound recipe (or an adequate one)
 *    produces nothing.
 *  - a single delegated-failure signal (low confidence) produces NO
 *    delegation proposal.
 *  - a repeated delegated-failure pattern for the same manager/specialist
 *    pair produces exactly one HIGH-risk grant-delegation proposal that
 *    stays 'proposed' (never auto-applied).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../../database/migrations';
import { setDb } from '../../../database/db';
import { AgentOrgProposalsRepository } from '../../../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../../../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../../../repositories/agent_sessions_repository';
import { AgentCookbookRepository } from '../../../repositories/agent_cookbook_repository';
import type { OrgAuditSnapshot } from '../../org_audit_service';
import type { ScoreCall } from '../../skill_refiner';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function baseSnapshot(overrides: Partial<OrgAuditSnapshot> = {}): OrgAuditSnapshot {
  return {
    auditRunId: 'run-1',
    generatedAt: new Date().toISOString(),
    engineAvailable: true,
    profiles: [],
    skills: [],
    skillOverlapCandidates: [],
    recipes: [],
    delegationEdges: [],
    webhookEndpoints: [],
    deniedToolAggregates: [],
    drift: [],
    gaps: [],
    workflowFailureSignals: [],
    ...overrides,
  };
}

const lowScorer: ScoreCall = async () => ({ score: 20, reason: 'too vague' });

beforeEach(() => {
  setDb(makeDb());
});

describe('issue-935: session-errored -> refine-recipe', () => {
  it('proposes a refine-recipe for a session bound to an inadequate recipe', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });

    const cookbookRepo = new AgentCookbookRepository();
    const recipe = await cookbookRepo.createAsync({
      title: 'Weekly Report',
      description: 'Send the weekly report',
      stepsJson: JSON.stringify(['do the thing']),
      boundConfigId: 'secretary',
    });

    const sessionsRepo = new AgentSessionsRepository();
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: 'Weekly report run',
      cwd: '/tmp',
      name: 'session-1',
      mcpRole: 'secretary',
    } as Parameters<typeof sessionsRepo.insert>[0]);
    sessionsRepo.setErrorStatus(session.id, 'hallucinated commit sha; verification skipped');

    const snapshot = baseSnapshot({
      recipes: [recipe],
      workflowFailureSignals: [
        {
          sessionId: session.id,
          kind: 'session-errored',
          evidence: 'hallucinated commit sha; verification skipped',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const result = await generateWorkflowSignalProposals(snapshot, { scorer: lowScorer });

    expect(result.refineRecipeCreated.length).toBe(1);
    const proposal = result.refineRecipeCreated[0];
    expect(proposal.kind).toBe('refine-recipe');
    expect(proposal.risk).toBe('low');
    expect(proposal.rationale).toContain('hallucinated commit sha');

    const proposalsRepo = new AgentOrgProposalsRepository();
    const all = await proposalsRepo.listByStatusAsync('proposed');
    // refine-recipe is low-risk; this generator itself never auto-applies —
    // that lane lives in org_optimizer_run_service, exercised separately.
    expect(all.some((p) => p.id === proposal.id)).toBe(true);
  });

  it('produces nothing when the errored session has no bound recipe', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'session-2',
    } as Parameters<typeof sessionsRepo.insert>[0]);
    sessionsRepo.setErrorStatus(session.id, 'some error');

    const snapshot = baseSnapshot({
      recipes: [],
      workflowFailureSignals: [
        { sessionId: session.id, kind: 'session-errored', evidence: 'some error', createdAt: new Date().toISOString() },
      ],
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const result = await generateWorkflowSignalProposals(snapshot, { scorer: lowScorer });
    expect(result.refineRecipeCreated.length).toBe(0);
  });
});

describe('issue-935: delegated-failure -> delegation proposal only on a repeated pattern', () => {
  it('a single delegated-failure signal is low-confidence and creates no proposal', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'manager', label: 'Manager', icon: 'x', isManager: true });
    configsRepo.insert({ id: 'specialist', label: 'Specialist', icon: 'x', isAgent: true, enabled: true });

    const sessionsRepo = new AgentSessionsRepository();
    const managerSession = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'manager-session',
      mcpRole: 'manager',
    } as Parameters<typeof sessionsRepo.insert>[0]);
    const childSession = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'child-session',
      mcpRole: 'specialist',
    } as Parameters<typeof sessionsRepo.insert>[0]);
    sessionsRepo.setErrorStatus(childSession.id, 'transport-empty result');

    const snapshot = baseSnapshot({
      workflowFailureSignals: [
        {
          sessionId: managerSession.id,
          kind: 'delegated-failure',
          evidence: `Child session ${childSession.id} failed: transport-empty result`,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const result = await generateWorkflowSignalProposals(snapshot);
    expect(result.delegationCreated.length).toBe(0);
  });

  it('a repeated delegated-failure pattern for the same manager/specialist pair proposes a queued, high-risk grant-delegation', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'manager', label: 'Manager', icon: 'x', isManager: true });
    configsRepo.insert({ id: 'specialist', label: 'Specialist', icon: 'x', isAgent: true, enabled: true });

    const sessionsRepo = new AgentSessionsRepository();
    const managerSession = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'manager-session',
      mcpRole: 'manager',
    } as Parameters<typeof sessionsRepo.insert>[0]);

    const signals = [];
    for (let i = 0; i < 3; i++) {
      const childSession = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `child-session-${i}`,
        mcpRole: 'specialist',
      } as Parameters<typeof sessionsRepo.insert>[0]);
      sessionsRepo.setErrorStatus(childSession.id, 'transport-empty result');
      signals.push({
        sessionId: managerSession.id,
        kind: 'delegated-failure' as const,
        evidence: `Child session ${childSession.id} failed: transport-empty result`,
        createdAt: new Date().toISOString(),
      });
    }

    const snapshot = baseSnapshot({ workflowFailureSignals: signals });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const result = await generateWorkflowSignalProposals(snapshot);

    expect(result.delegationCreated.length).toBe(1);
    const proposal = result.delegationCreated[0];
    expect(proposal.kind).toBe('grant-delegation');
    expect(proposal.risk).toBe('high');
    expect(proposal.status).toBe('proposed');
  });

  it('issue-936: re-running over the SAME repeated pattern after the edge is granted does not duplicate', async () => {
    // Regression for #936: delegation_generator.ts's own dedupKey is
    // `${kind}:manager:target`, and `kind` flips grant-delegation ->
    // expand-delegation the instant the edge exists. Since the extractor
    // re-reads the same historical sessions every run (no expiry), a
    // second optimizer run over identical stale evidence must NOT produce
    // a second (expand-delegation) proposal for the same pair.
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'manager', label: 'Manager', icon: 'x', isManager: true });
    configsRepo.insert({ id: 'specialist', label: 'Specialist', icon: 'x', isAgent: true, enabled: true });

    const sessionsRepo = new AgentSessionsRepository();
    const managerSession = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'manager-session',
      mcpRole: 'manager',
    } as Parameters<typeof sessionsRepo.insert>[0]);

    const signals = [];
    for (let i = 0; i < 3; i++) {
      const childSession = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `child-session-${i}`,
        mcpRole: 'specialist',
      } as Parameters<typeof sessionsRepo.insert>[0]);
      sessionsRepo.setErrorStatus(childSession.id, 'transport-empty result');
      signals.push({
        sessionId: managerSession.id,
        kind: 'delegated-failure' as const,
        evidence: `Child session ${childSession.id} failed: transport-empty result`,
        createdAt: new Date().toISOString(),
      });
    }

    const snapshot = baseSnapshot({ workflowFailureSignals: signals });
    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');

    // Run 1: grant-delegation proposal created, then simulate approval+apply
    // (the manager now actually has the delegate edge).
    const run1 = await generateWorkflowSignalProposals(snapshot);
    expect(run1.delegationCreated.length).toBe(1);
    expect(run1.delegationCreated[0].kind).toBe('grant-delegation');
    configsRepo.update('manager', { allowedDelegatesJson: JSON.stringify(['specialist']) });

    // Run 2: identical stale signals (nothing new happened) — with the edge
    // now granted, delegation_generator.ts would compute kind='expand-delegation'
    // for the same pair. Must be deduped, not created as a second proposal.
    const run2 = await generateWorkflowSignalProposals(snapshot);
    expect(run2.delegationCreated.length).toBe(0);

    const proposalsRepo = new AgentOrgProposalsRepository();
    const all = await proposalsRepo.listByStatusAsync('proposed');
    const forThisPair = all.filter((p) => p.targetRef === 'agent_config:manager');
    expect(forThisPair.length).toBe(1);
  });
});

describe('workflow-retro prompt evolution lane', () => {
  it('turns workflow-adherence signals into queued prompt-fix proposals for the affected skill', async () => {
    const snapshot = baseSnapshot({
      workflowFailureSignals: [
        {
          sessionId: 'workflow_ses',
          kind: 'workflow-adherence',
          workflowCategory: 'W5',
          affectedSkill: 'verification-gate',
          evidence:
            'W5: Premature completion claim - coding-agent said fixed before verification-gate evidence was captured.',
          createdAt: '2026-07-07T12:01:00Z',
        },
      ],
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const result = await generateWorkflowSignalProposals(snapshot);

    expect(result.promptFixCreated.length).toBe(1);
    const proposal = result.promptFixCreated[0];
    expect(proposal.kind).toBe('workflow-prompt-fix');
    expect(proposal.risk).toBe('high');
    expect(proposal.status).toBe('proposed');
    expect(proposal.title).toBe('Prompt evolution: fix W5 in verification-gate');
    expect(proposal.targetRef).toBe('skill:verification-gate');
    expect(proposal.signalRef).toBe('workflow-adherence:workflow_ses:W5');

    const change = JSON.parse(proposal.changeJson ?? '{}') as Record<string, unknown>;
    expect(change.source).toBe('org-optimizer-workflow-retro');
    expect(change.workflowCategory).toBe('W5');
    expect(change.affectedSkill).toBe('verification-gate');
    expect(change.proposedPromptChange).toContain('W5');
    expect(change.proposedPromptChange).toContain('verification-gate');
  });
});
