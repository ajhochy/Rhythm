import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { AgentSkill } from '../models/agent_skill';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { OrgAuditGap, OrgAuditSnapshot } from '../services/org_audit_service';
import type { WorkflowFailureSignal } from '../services/workflow_failure_signal_extractor';
import { logger } from '../utils/logger';
import { useTempManagedSkillsRoot } from '../__tests__/_managed_skills_temp_root';

const { downloadSkillBody } = vi.hoisted(() => ({ downloadSkillBody: vi.fn() }));
vi.mock('../services/generators/external_discovery_search', () => ({
  downloadSkillBody,
  RHYTHM_SKILLS_DOWNLOAD_BASE: 'https://raw.githubusercontent.com',
}));

useTempManagedSkillsRoot('pr-1489-adversarial-review');

function signal(
  evidence: string,
  category: WorkflowFailureSignal['category'] = 'retry-loop',
): WorkflowFailureSignal {
  return {
    category,
    evidence,
    sessionIds: ['s1', 's2'],
    agentConfigId: 'secretary',
    count: 2,
    confidence: 'high',
    dedupToken: `secretary:${category}:${evidence}`,
  };
}

function snapshot(signals: WorkflowFailureSignal[]): OrgAuditSnapshot {
  return {
    auditRunId: 'pr-1489-review',
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

const provenance = {
  source: 'skills.sh',
  stars: 10,
  lastUpdated: '2026-08-01',
  maintainer: 'owner',
  license: 'MIT',
  installCommand: 'npx skills add owner/repo/candidate',
};

function gap(intentTitle = 'unrelated capability'): OrgAuditGap {
  return {
    gapId: `capability-gap:${intentTitle}`,
    kind: 'capability-gap',
    evidence: 'missing reusable capability',
    intentTitle,
  };
}

function installedSkill(title: string, body: string): AgentSkill {
  const now = new Date().toISOString();
  return {
    id: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    body,
    whenToUse: null,
    description: null,
    stepsJson: null,
    tagsJson: null,
    confidence: 1,
    status: 'active',
    source: 'local',
    uses: 1,
    version: 1,
    appliedForName: null,
    baseVersion: null,
    originLocation: null,
    isExternal: 0,
    baselineScore: null,
    postScore: null,
    measureReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  new AgentConfigsRepository().insert({ id: 'secretary', label: 'Secretary', icon: 'x' });
  downloadSkillBody.mockReset();
});

describe('PR #1489 adversarial review repair contract', () => {
  it('pr-1489-c1: config changes with invented evidence quotes are rejected', async () => {
    const diagnose = vi.fn(async () => ({
      diagnosis: 'Change the model', rootCause: 'config' as const, fixType: 'config-change' as const,
      concreteFix: 'Use model anthropic/claude-sonnet-5', confidence: 'high' as const,
      evidenceQuotes: ['string that appears nowhere'],
      configPatch: { agentConfigId: 'attacker-selected', field: 'model' as const, value: 'anthropic/claude-sonnet-5' },
    }));
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal('provider returned an oversized attachment error')]), { diagnose });
    expect(result.created).toHaveLength(0);
  });

  it('pr-1489-c2: config changes without evidence quotes are rejected', async () => {
    const diagnose = vi.fn(async () => ({
      diagnosis: 'Change the model', rootCause: 'config' as const, fixType: 'config-change' as const,
      concreteFix: 'Use model anthropic/claude-sonnet-5', confidence: 'high' as const,
      configPatch: { agentConfigId: 'secretary', field: 'model' as const, value: 'anthropic/claude-sonnet-5' },
    }));
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal('provider returned an oversized attachment error')]), { diagnose });
    expect(result.created).toHaveLength(0);
  });

  it('pr-1489-c3: install rejects arbitrary-origin plain-HTTP unpinned URLs even when the hash matches', async () => {
    const body = '# Reviewed body\n\nSafe instructions.';
    downloadSkillBody.mockResolvedValue(body);
    const { buildRealExternalAdoptionDeps } = await import('../services/org_proposal_appliers_wiring');
    await expect(buildRealExternalAdoptionDeps().installSkill({
      skillName: 'attacker-skill',
      downloadUrl: 'http://attacker.example.invalid/whatever/HEAD/SKILL.md',
      contentSha256: createHash('sha256').update(body).digest('hex'),
    })).rejects.toThrow(/commit-pinned|download URL|origin/i);
  });

  it('pr-1489-c4: routing omits denied engine builtins from the named roster', async () => {
    const { buildHubRoutingPreamble } = await import('../services/opencode_agent_writer');
    expect(buildHubRoutingPreamble(['plan', 'librarian'], 'manager')).not.toContain('`plan`');
  });

  it('pr-1489-c5: routing omits self from the named roster', async () => {
    const { buildHubRoutingPreamble } = await import('../services/opencode_agent_writer');
    expect(buildHubRoutingPreamble(['config-doctor', 'librarian'], 'config-doctor')).not.toContain('`config-doctor`');
  });

  it('pr-1489-c6: routing omits empty delegate names', async () => {
    const { buildHubRoutingPreamble } = await import('../services/opencode_agent_writer');
    expect(buildHubRoutingPreamble(['', 'librarian'], 'manager')).not.toContain('``');
  });

  it('pr-1489-c7: overlap veto compares the candidate rather than contaminating it with the gap title', async () => {
    const currentGap = gap('Fix CLI PATH for login shells');
    const { runExternalDiscoveryGenerator } = await import('../services/generators/external_discovery_generator');
    const result = await runExternalDiscoveryGenerator({
      auditRunId: 'review', gaps: [currentGap],
      installedSkills: [installedSkill('Fix CLI PATH for login shells', 'Repair shell paths.')],
      discoverCandidates: async () => [{
        kind: 'skill', name: 'Kubernetes manifest linter', gapId: currentGap.gapId, provenance,
        downloadUrl: `https://raw.githubusercontent.com/owner/repo/${'a'.repeat(40)}/SKILL.md`,
        contentSha256: 'b'.repeat(64), body: 'Lint Kubernetes deployment manifests.',
      }],
    });
    expect(result.emitted).toBe(1);
  });

  it('pr-1489-c8: title plus downloaded body similarity vetoes an installed equivalent', async () => {
    const currentGap = gap();
    const sharedBody = 'Repair zprofile PATH entries for login shell verification';
    const { runExternalDiscoveryGenerator } = await import('../services/generators/external_discovery_generator');
    const result = await runExternalDiscoveryGenerator({
      auditRunId: 'review', gaps: [currentGap],
      installedSkills: [installedSkill('Fix CLI PATH for login shells', sharedBody)],
      discoverCandidates: async () => [{
        kind: 'skill', name: 'zsh-path', gapId: currentGap.gapId, provenance,
        downloadUrl: `https://raw.githubusercontent.com/owner/repo/${'a'.repeat(40)}/SKILL.md`,
        contentSha256: 'b'.repeat(64), body: sharedBody,
      }],
    });
    expect(result.droppedInstalledOverlap).toBe(1);
    expect(result.emitted).toBe(0);
  });

  it('pr-1489-c9: non-retry signals do not receive retry-loop recipe boilerplate', async () => {
    const { generateWorkflowSignalProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateWorkflowSignalProposals(snapshot([
      signal('Agent claimed a commit existed without a git result', 'hallucinated-claim'),
    ]));
    expect(result.created.filter((proposal) => proposal.kind === 'create-recipe')).toHaveLength(0);
  });

  it('pr-1489-c10: too-short evidence quotes cannot ground a diagnosis', async () => {
    const diagnose = vi.fn(async () => ({
      diagnosis: 'Replace the skill', rootCause: 'skill' as const, fixType: 'skill-edit' as const,
      concreteFix: 'COMPLETE REPLACEMENT BODY', confidence: 'high' as const, evidenceQuotes: ['the'],
    }));
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal('the provider returned a large response')]), { diagnose });
    expect(result.created).toHaveLength(0);
  });

  it('pr-1489-c11: honest evidence quotes match after whitespace normalization', async () => {
    const diagnose = vi.fn(async () => ({
      diagnosis: 'Add a provider-size guard', rootCause: 'skill' as const, fixType: 'skill-edit' as const,
      concreteFix: 'Add a concrete attachment-size guard.', confidence: 'high' as const,
      evidenceQuotes: ['provider returned an oversized attachment error'],
    }));
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal('provider   returned an oversized\nattachment error')]), { diagnose });
    expect(result.created).toHaveLength(1);
  });

  it('pr-1489-c12: honest evidence quotes may use one ellipsis for omitted words', async () => {
    const diagnose = vi.fn(async () => ({
      diagnosis: 'Add a provider-size guard', rootCause: 'skill' as const, fixType: 'skill-edit' as const,
      concreteFix: 'Add a concrete attachment-size guard.', confidence: 'high' as const,
      evidenceQuotes: ['provider returned … attachment error'],
    }));
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal('provider returned a very large oversized attachment error')]), { diagnose });
    expect(result.created).toHaveLength(1);
  });

  it('pr-1489-c13: deterministic proposals also exclude infrastructure failures', async () => {
    const { generateWorkflowSignalProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateWorkflowSignalProposals(snapshot([
      signal('connect ECONNREFUSED 127.0.0.1:4001 while calling the API', 'hallucinated-claim'),
    ]));
    expect(result.created).toHaveLength(0);
  });

  it('pr-1489-c14: excluded infrastructure failures remain operator-visible in logs', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const diagnose = vi.fn();
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    await generateDiagnosisProposals(snapshot([signal('connect ECONNREFUSED 127.0.0.1:4001')]), { diagnose });
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/infra|infrastructure/i));
    info.mockRestore();
  });

  it('pr-1489-c15: unverified-claim evidence cannot authorize a full skill rewrite', async () => {
    const evidence = 'Claimed tests passed without any verification tool result';
    const diagnose = vi.fn(async () => ({
      diagnosis: 'Replace the skill', rootCause: 'skill' as const, fixType: 'skill-edit' as const,
      concreteFix: 'COMPLETE REPLACEMENT BODY', confidence: 'high' as const, evidenceQuotes: [evidence],
    }));
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');
    const result = await generateDiagnosisProposals(snapshot([signal(evidence, 'unverified-claim')]), { diagnose });
    expect(result.created).toHaveLength(0);
  });
});
