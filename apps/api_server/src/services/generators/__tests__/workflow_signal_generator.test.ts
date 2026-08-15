/**
 * CONTRACT TEST for issue #935 — feed workflow failure signals into existing
 * optimizer proposal lanes.
 *
 * Covers:
 *  - issue-935-c1: missing-scope -> exactly one broaden-scope proposal
 *    (high-risk, change_json adds the denied tool to the profile's allowlist).
 *  - issue-935-c2: behavioral categories (retry-loop, stale-redo,
 *    delegate-result) -> create-recipe proposals (high-risk).
 *  - issue-935-c3: delegateOutcome='unknown' NEVER produces a proposal.
 *  - issue-935-c4: re-running over the same signal set does not duplicate
 *    proposals (dedup_key idempotency).
 *  - issue-935-c5: every proposal created is one of the PRE-EXISTING kinds
 *    (broaden-scope / create-recipe) — no new lane is invented.
 *  - issue-935-c6: proposal rationale cites the concise workflow evidence.
 *  - issue-935-c7: end-to-end via runOrgOptimizer — a seeded workflow
 *    failure produces a proposal that stays 'proposed' (both kinds are
 *    high-risk and therefore never auto-applied).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../../database/migrations';
import { setDb } from '../../../database/db';
import { AgentOrgProposalsRepository } from '../../../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../../../repositories/agent_configs_repository';
import { DeniedToolEventsRepository } from '../../../repositories/denied_tool_events_repository';
import { resetProposalPluginsForTests } from '../../org_proposal_apply_service';
import type { OrgAuditSnapshot } from '../../org_audit_service';
import type { WorkflowFailureSignal } from '../../workflow_failure_signal_extractor';

// ── opencode_engine mock — mirrors org_audit_service.test.ts / issue_850_contract.test.ts ──
const listMcp = vi.fn();
const listSkills = vi.fn();
let mockIsReady = true;

vi.mock('../../opencode_engine', () => ({
  get opencodeClient() {
    return {
      get isReady() {
        return mockIsReady;
      },
      listMcp: (...a: unknown[]) => listMcp(...a),
      listSkills: (...a: unknown[]) => listSkills(...a),
    };
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(async () => {
  setDb(makeDb());
  resetProposalPluginsForTests();
  mockIsReady = true;
  listMcp.mockReset().mockResolvedValue({
    rhythm: { name: 'rhythm' },
    gitnexus: { name: 'gitnexus' },
    nfl_mcp: { name: 'nfl_mcp' },
  });
  listSkills.mockReset().mockResolvedValue([]);
  const { _resetEngineReadyForTests } = await import('../../skill_extractor');
  _resetEngineReadyForTests();
});

function baseSnapshot(signals: WorkflowFailureSignal[]): OrgAuditSnapshot {
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
    workflowFailureSignals: signals,
  };
}

function makeSignal(overrides: Partial<WorkflowFailureSignal> = {}): WorkflowFailureSignal {
  return {
    category: 'retry-loop',
    sessionIds: ['s1', 's2'],
    agentConfigId: 'secretary',
    count: 2,
    confidence: 'medium',
    evidence: 'retry-loop phrases across 2 sessions agentConfigId=secretary sessionIds=s1,s2',
    dedupToken: 'secretary', // profile-grouped default; override per test for identity-specific dedup
    ...overrides,
  };
}

describe('issue-935-c1: missing-scope maps to a single broaden-scope proposal', () => {
  it('issue-1223-c1: normalizes a model-facing denied tool to its MCP server name', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x', allowedMcpsJson: JSON.stringify(['rhythm']) });

    const signal = makeSignal({
      category: 'missing-scope',
      agentConfigId: 'secretary',
      confidence: 'high',
      evidence: 'profile=secretary deniedTool=gitnexus_query count=3 sessionIds=s1,s2,s3',
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot([signal]));

    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('broaden-scope');
    expect(created[0].risk).toBe('high');
    const change = JSON.parse(created[0].changeJson!);
    expect(change).toEqual({ agentConfigId: 'secretary', field: 'allowedMcpsJson', add: ['gitnexus'] });
    expect(created[0].dedupKey).toBe('broaden-scope:secretary:mcp:gitnexus');
  });

  it.each([
    ['an empty catalog', {}],
    ['an unavailable catalog', new Error('engine unavailable')],
  ])('preserves a plausible server name with %s', async (_label, catalog) => {
    if (catalog instanceof Error) {
      listMcp.mockRejectedValueOnce(catalog);
    } else {
      listMcp.mockResolvedValueOnce(catalog);
    }
    const signal = makeSignal({
      category: 'missing-scope',
      agentConfigId: 'secretary',
      confidence: 'high',
      evidence: 'profile=secretary deniedTool=nfl_mcp count=3 sessionIds=s1,s2,s3',
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot([signal]));

    expect(created).toHaveLength(1);
    expect(JSON.parse(created[0].changeJson!)).toEqual({
      agentConfigId: 'secretary',
      field: 'allowedMcpsJson',
      add: ['nfl_mcp'],
    });
  });

  it('does not pass through a model-facing tool id when the catalog cannot resolve it', async () => {
    listMcp.mockResolvedValueOnce({});
    const signal = makeSignal({
      category: 'missing-scope',
      agentConfigId: 'secretary',
      confidence: 'high',
      evidence: 'profile=secretary deniedTool=gitnexus_query count=3 sessionIds=s1,s2,s3',
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot([signal]));

    expect(created).toHaveLength(0);
  });
});

describe('issue-935-c2: behavioral categories map to create-recipe', () => {
  it.each([
    ['retry-loop', makeSignal({ category: 'retry-loop' })],
    ['stale-redo', makeSignal({ category: 'stale-redo', confidence: 'high' })],
    [
      'delegate-result',
      makeSignal({ category: 'delegate-result', delegateOutcome: 'transport-empty', confidence: 'medium' }),
    ],
  ] as const)('%s produces a high-risk create-recipe proposal', async (_label, signal) => {
    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot([signal]));

    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe('create-recipe');
    expect(created[0].risk).toBe('high');
    const change = JSON.parse(created[0].changeJson!);
    expect(typeof change.title).toBe('string');
    expect(typeof change.steps_json).toBe('string');
  });
});

describe("issue-935-c3: delegateOutcome='unknown' never produces a proposal", () => {
  it('skips low-confidence/unknown delegate evidence entirely', async () => {
    const signal = makeSignal({ category: 'delegate-result', delegateOutcome: 'unknown', confidence: 'low' });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot([signal]));

    expect(created).toHaveLength(0);
  });
});

describe('issue-935-c4: re-running over the same signal set does not duplicate proposals', () => {
  it('dedup_key idempotency collapses a second identical run to zero new proposals', async () => {
    const signal = makeSignal({ category: 'retry-loop', agentConfigId: 'secretary' });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const first = await generateWorkflowSignalProposals(baseSnapshot([signal]));
    expect(first.created).toHaveLength(1);

    const proposalsRepo = new AgentOrgProposalsRepository();
    const second = await generateWorkflowSignalProposals(baseSnapshot([signal]));
    expect(second.created).toHaveLength(0);

    const all = await proposalsRepo.listByStatusAsync('proposed');
    expect(all.filter((p) => p.kind === 'create-recipe')).toHaveLength(1);
  });
});

describe('issue-935-c5: every created proposal uses a pre-existing kind', () => {
  it('only ever emits broaden-scope or create-recipe, never a new lane', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });

    const signals: WorkflowFailureSignal[] = [
      makeSignal({ category: 'missing-scope', agentConfigId: 'secretary', evidence: 'profile=secretary deniedTool=x count=1 sessionIds=s1' }),
      makeSignal({ category: 'retry-loop' }),
      makeSignal({ category: 'hallucinated-claim' }),
      makeSignal({ category: 'unverified-claim' }),
      makeSignal({ category: 'stale-redo' }),
      makeSignal({ category: 'repeated-correction' }),
      makeSignal({ category: 'tool-unavailable-attempted' }),
      makeSignal({ category: 'delegate-result', delegateOutcome: 'failed', confidence: 'high' }),
    ];

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot(signals));

    expect(created.length).toBeGreaterThan(0);
    for (const proposal of created) {
      expect(['broaden-scope', 'create-recipe']).toContain(proposal.kind);
    }
  });
});

describe('issue-935-c6: proposal rationale cites the concise workflow evidence', () => {
  it('rationale includes the signal evidence string', async () => {
    const signal = makeSignal({
      category: 'retry-loop',
      evidence: 'retry-loop phrases across 2 sessions agentConfigId=secretary sessionIds=s1,s2',
    });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot([signal]));

    expect(created[0].rationale).toContain(signal.evidence);
  });
});

describe('issue-935-c7: end-to-end via runOrgOptimizer — proposal stays proposed (never auto-applied)', () => {
  it('a seeded missing-scope workflow failure produces a queued broaden-scope proposal', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x', allowedMcpsJson: JSON.stringify(['rhythm']) });

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: 'sess-1', agentConfigId: 'secretary', toolName: 'nfl_mcp' });

    const { runOrgOptimizer } = await import('../../org_optimizer_run_service');
    await runOrgOptimizer();

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    const broadenScope = proposed.find((p) => p.kind === 'broaden-scope');
    expect(broadenScope).toBeDefined();
    expect(broadenScope?.risk).toBe('high');

    for (const status of ['applied', 'measuring', 'active', 'reverted']) {
      const rows = await proposalsRepo.listByStatusAsync(status);
      expect(rows.some((p) => p.kind === 'broaden-scope')).toBe(false);
    }
  });
});

/**
 * Run attribution. Found by the FIRST live execution of the W7 gate: the
 * deterministic lanes wrote `audit_run_id = NULL`, so their proposals were
 * invisible to every per-run query — the optimizer's own reporting, the live
 * gate's positive control, and `deleteRunProposals` cleanup alike. Orphan rows
 * accumulated across sandbox runs because nothing could find them.
 *
 * The LLM-diagnosis path in the same file always stamped it
 * (workflow_signal_generator.ts:1278), which is what makes this an oversight
 * rather than a design choice.
 */
describe('workflow-signal proposals are attributable to the run that created them', () => {
  it.each([
    ['create-recipe', makeSignal()],
    [
      'broaden-scope',
      makeSignal({
        category: 'missing-scope',
        confidence: 'high',
        evidence: 'profile=secretary deniedTool=gitnexus_query count=3 sessionIds=s1,s2,s3',
      }),
    ],
  ])('stamps the audit run id on a %s proposal', async (kind, signal) => {
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify([]),
    });
    listMcp.mockResolvedValue({ gitnexus: { status: 'connected' } });

    const { generateWorkflowSignalProposals } = await import('../workflow_signal_generator');
    const { created } = await generateWorkflowSignalProposals(baseSnapshot([signal]));

    expect(created.map((p) => p.kind)).toContain(kind);
    // The behaviour: every row this run produced is findable BY that run.
    expect(created.length).toBeGreaterThan(0);
    for (const proposal of created) {
      expect(proposal.auditRunId, `${proposal.kind} proposal is unattributed`).toBe('run-1');
    }
  });
});
