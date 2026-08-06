/**
 * The diagnosis LLM must be told the TRUTH about a profile's scope.
 *
 * Both false 2026-08-04 `refine-scope` proposals were reasonable readings of a
 * wrong prompt: the context said `allowedMcps: []` for a profile whose
 * allowedMcpsJson was `{"gitnexus":null,...}`, and said nothing at all about
 * image generation for a profile with `imageGenerationEnabled = true`. This
 * suite asserts the assembled prompt states what is actually granted.
 *
 * SIBLING FILE (mirrors workflow_signal_generator_diagnose.test.ts): the
 * `../../agent_runner` mock must not leak into the injected-diagnose suites.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../../database/migrations';
import { setDb } from '../../../database/db';
import { AgentConfigsRepository } from '../../../repositories/agent_configs_repository';
import type { OrgAuditSnapshot } from '../../org_audit_service';

const run = vi.fn();
vi.mock('../../agent_runner', () => ({
  run: (...a: unknown[]) => run(...a),
  resolveRunModel: () => ({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' }),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
  run.mockReset().mockResolvedValue({
    sessionId: 'diagnosis',
    status: 'done',
    result: JSON.stringify({
      diagnosis: 'Infrastructure timeout; scope is fine.',
      rootCause: 'external',
      fixType: 'external-noop',
      concreteFix: 'None.',
      confidence: 'high',
    }),
  });
});

function snapshotFor(agentConfigId: string, deniedTool?: string): OrgAuditSnapshot {
  return {
    auditRunId: 'audit-run-1',
    generatedAt: new Date().toISOString(),
    engineAvailable: true,
    profiles: [],
    skills: [],
    skillOverlapCandidates: [],
    recipes: [],
    delegationEdges: [],
    webhookEndpoints: [],
    deniedToolAggregates: deniedTool ? [{ agentConfigId, toolName: deniedTool, count: 3 }] : [],
    drift: [],
    gaps: [],
    workflowFailureSignals: [
      {
        category: 'retry-loop',
        agentConfigId,
        count: 17,
        confidence: 'high',
        sessionIds: ['f2b6c2e1-99ed-4a7f-b4d3-ac3f5ce6cdef'],
        evidence: `retryPhraseCount=17 agentConfigId=${agentConfigId}`,
        dedupToken: agentConfigId,
      },
    ],
  };
}

/** The prompt text the (mocked) AgentRunner was handed. */
function capturedPrompt(): string {
  expect(run).toHaveBeenCalled();
  return (run.mock.calls[0][0] as { prompt: string }).prompt;
}

describe('the diagnosis prompt states the resolved MCP scope, not an ambiguous []', () => {
  it('spells out each granted server and whether it grants all tools', async () => {
    new AgentConfigsRepository().insert({
      id: 'planning-agent',
      label: 'Planning Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: null, memory: null, rhythm: ['rhythm_ping'] }),
    });

    const { generateDiagnosisProposals } = await import('../workflow_signal_generator');
    await generateDiagnosisProposals(snapshotFor('planning-agent', 'gitnexus_query'));

    const prompt = capturedPrompt();
    expect(prompt).toContain('gitnexus: ALL tools');
    expect(prompt).toContain('memory: ALL tools');
    expect(prompt).toContain('rhythm: 1 explicit tool(s)');
    expect(prompt).not.toContain('allowedMcps: []');
  });

  it('marks a denied tool that is already in scope as IN SCOPE', async () => {
    new AgentConfigsRepository().insert({
      id: 'planning-agent',
      label: 'Planning Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ gitnexus: null, rhythm: ['rhythm_ping'] }),
    });

    const { generateDiagnosisProposals } = await import('../workflow_signal_generator');
    await generateDiagnosisProposals(snapshotFor('planning-agent', 'gitnexus_query'));

    const prompt = capturedPrompt();
    expect(prompt).toMatch(/gitnexus_query \(count=3\) — IN SCOPE/);
    expect(prompt).toContain('A denial is NOT proof of a missing grant.');
  });

  it('marks a denied tool that is genuinely out of scope as NOT-IN-SCOPE', async () => {
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_ping'] }),
    });

    const { generateDiagnosisProposals } = await import('../workflow_signal_generator');
    await generateDiagnosisProposals(snapshotFor('secretary', 'gitnexus_query'));

    expect(capturedPrompt()).toMatch(/gitnexus_query \(count=3\) — NOT-IN-SCOPE/);
  });

  it('says UNRESTRICTED for a profile with no MCP allowlist at all', async () => {
    new AgentConfigsRepository().insert({ id: 'unscoped-agent', label: 'Unscoped', icon: 'x' });

    const { generateDiagnosisProposals } = await import('../workflow_signal_generator');
    await generateDiagnosisProposals(snapshotFor('unscoped-agent'));

    expect(capturedPrompt()).toContain('allowedMcps: (UNRESTRICTED');
  });
});

describe('the diagnosis prompt states the provider-executed capability surface', () => {
  it('reports image_generation as granted when imageGenerationEnabled is true', async () => {
    new AgentConfigsRepository().insert({
      id: 'creative-media',
      label: 'Creative Media Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['canva', 'openmontage']),
      imageGenerationEnabled: true,
    });

    const { generateDiagnosisProposals } = await import('../workflow_signal_generator');
    await generateDiagnosisProposals(snapshotFor('creative-media'));

    const prompt = capturedPrompt();
    expect(prompt).toMatch(/provider-executed \+ core capabilities GRANTED:.*image_generation/);
    expect(prompt).toContain('NOT through the MCP allowlist');
  });

  it('does not claim image_generation is granted when the flag is off', async () => {
    new AgentConfigsRepository().insert({
      id: 'creative-media',
      label: 'Creative Media Agent',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['canva']),
      imageGenerationEnabled: false,
    });

    const { generateDiagnosisProposals } = await import('../workflow_signal_generator');
    await generateDiagnosisProposals(snapshotFor('creative-media'));

    expect(capturedPrompt()).toContain('provider-executed + core capabilities GRANTED: (none)');
  });
});
