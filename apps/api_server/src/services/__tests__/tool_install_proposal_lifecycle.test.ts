import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../../repositories/tool_safety_reports_repository';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../org_proposal_experiment_service';
import {
  approveVettedToolInstallProposalAsync,
  createAndVetToolInstallProposalAsync,
  denyToolInstallProposalAsync,
  type ToolInstallProposalLifecycleDeps,
} from '../tool_install_proposal_lifecycle';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function vetOutcome(verdict: 'safe' | 'conditional' | 'unsafe' | 'unknown') {
  return {
    verdict,
    reason: verdict === 'unknown' ? 'sandbox_unavailable' : null,
    sandboxDurationMs: 1,
    testPromptsRunCount: 2,
    forbiddenPathViolationsJson: '[]',
    networkCallsObservedJson: '[]',
    fileSystemWritesObservedJson: '[]',
    credentialAccessAttemptsCount: 0,
    evidenceJson: '{}',
  };
}

describe('D1.4 tool-install creation → vet → human decision lifecycle', () => {
  let db: Database.Database;
  let proposals: AgentOrgProposalsRepository;
  let reports: ToolSafetyReportsRepository;
  let input: { title: string; change: Record<string, unknown> };

  beforeEach(() => {
    db = makeDb();
    setDb(db);
    proposals = new AgentOrgProposalsRepository(db);
    reports = new ToolSafetyReportsRepository(db);
    const config = new AgentConfigsRepository().insert({ label: 'D1 lifecycle', icon: 'shield' });
    input = {
      title: 'Install example-tool',
      change: {
        toolName: 'example-tool', packageSource: 'npm:example-tool', installMethod: 'npm install',
        agentConfigId: config.id, testPrompts: ['version-check', 'help-check'],
        evidenceBundle: {
          version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
          sourceEvidence: { sessionIds: ['session-1'], eventIds: [] },
          counterEvidenceSearch: { query: 'tool install', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
          target: { ref: toProfileTargetRef(config.id), hash: buildProfileRevisionFingerprint(config) },
          expectedOutcome: 'improve scheduling', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
          guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count', rollbackRule: 'revoke',
          generatorVersion: 'd1-lifecycle-test', confidenceCalibrationVersion: 'uncalibrated',
        },
      },
    };
  });

  function deps(vet: ToolInstallProposalLifecycleDeps['vet'], installer?: ToolInstallProposalLifecycleDeps['installer']): ToolInstallProposalLifecycleDeps {
    return { proposals, reports, vet, installer };
  }

  it('automatically vets on creation and leaves safe/conditional proposals reviewable only after sandbox-running', async () => {
    const observedStatuses: string[] = [];
    const safe = await createAndVetToolInstallProposalAsync(input, deps(async () => {
      observedStatuses.push((await proposals.listByStatusAsync('sandbox-running')).length > 0 ? 'sandbox-running' : 'other');
      return vetOutcome('safe');
    }));
    expect(observedStatuses).toEqual(['sandbox-running']);
    expect(safe.status).toBe('sandbox-vetted');
    expect((await reports.findByProposalIdAsync(safe.id))?.verdict).toBe('safe');

    const conditional = await createAndVetToolInstallProposalAsync(
      { ...input, title: 'Install conditional example-tool' },
      deps(async () => vetOutcome('conditional')),
    );
    expect(conditional.status).toBe('sandbox-vetted');
    expect((await reports.findByProposalIdAsync(conditional.id))?.verdict).toBe('conditional');
  });

  it('auto-rejects an unsafe report after persisting it, with no human approval', async () => {
    const proposal = await createAndVetToolInstallProposalAsync(input, deps(async () => vetOutcome('unsafe')));
    expect(proposal.status).toBe('rejected');
    expect((await reports.findByProposalIdAsync(proposal.id))?.verdict).toBe('unsafe');
  });

  it('persists a sanitized unknown report and leaves sandbox failure pending for a user', async () => {
    const proposal = await createAndVetToolInstallProposalAsync(input, deps(async () => {
      throw new Error('candidate output sk-abcdefghijklmnopqrstuvwx must never persist');
    }));
    const report = await reports.findByProposalIdAsync(proposal.id);
    expect(proposal.status).toBe('pending');
    expect(report).toMatchObject({ verdict: 'unknown', reason: 'sandbox_error' });
    expect(JSON.stringify(report)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('persists redacted title and dedup key values through the production lifecycle seam', async () => {
    const titleSecret = ['sk', 'd1lifecycletitlefixtureabcdefghijklmnop'].join('-');
    const dedupSecret = ['sk', 'd1lifecyclededupfixtureqrstuvwxyzabcdef'].join('-');
    const secretInput = {
      ...input,
      title: `Install ${titleSecret}`,
      dedupKey: `d1-tool-install:${dedupSecret}`,
    };
    let vets = 0;
    const lifecycleDeps = deps(async () => {
      vets += 1;
      return vetOutcome('safe');
    });

    const proposal = await createAndVetToolInstallProposalAsync(secretInput, lifecycleDeps);
    const duplicate = await createAndVetToolInstallProposalAsync(secretInput, lifecycleDeps);
    const stored = db.prepare('SELECT title, dedup_key FROM agent_org_proposals WHERE id = ?').get(proposal.id) as {
      title: string;
      dedup_key: string | null;
    };

    expect(proposal.id).toBe(duplicate.id);
    expect(vets).toBe(1);
    expect(stored.title).toBe('Install [redacted]');
    expect(stored.dedup_key).toBe('d1-tool-install:[redacted]');
    expect(JSON.stringify(stored)).not.toContain(titleSecret);
    expect(JSON.stringify(stored)).not.toContain(dedupSecret);
  });

  it('human denial rejects a vetted proposal and never invokes the installer', async () => {
    let installs = 0;
    const proposal = await createAndVetToolInstallProposalAsync(input, deps(async () => vetOutcome('safe')));
    const denied = await denyToolInstallProposalAsync(proposal.id, 7, deps(async () => vetOutcome('safe'), async () => {
      installs += 1;
      return { applied: true, reason: null };
    }));
    expect(denied.status).toBe('rejected');
    expect(installs).toBe(0);
  });

  it('approves only after durable safety and invokes the injected installer exactly once', async () => {
    let installs = 0;
    const proposal = await createAndVetToolInstallProposalAsync(input, deps(async () => vetOutcome('safe')));
    const applied = await approveVettedToolInstallProposalAsync(proposal.id, 7, false, deps(async () => vetOutcome('safe'), async () => {
      installs += 1;
      return { applied: true, reason: null };
    }));
    expect(applied.status).toBe('applied');
    expect(installs).toBe(1);
  });

  it('CAS-claims approval before installation so concurrent approvals invoke the installer once', async () => {
    let installs = 0;
    const proposal = await createAndVetToolInstallProposalAsync(input, deps(async () => vetOutcome('safe')));
    const lifecycleDeps = deps(async () => vetOutcome('safe'), async () => {
      installs += 1;
      return { applied: true, reason: null };
    });
    const results = await Promise.allSettled([
      approveVettedToolInstallProposalAsync(proposal.id, 7, false, lifecycleDeps),
      approveVettedToolInstallProposalAsync(proposal.id, 7, false, lifecycleDeps),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(installs).toBe(1);
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('applied');
  });

  it('deduplicates concurrent creation so the same proposal is vetted once', async () => {
    let vets = 0;
    const shared = { ...input, dedupKey: 'd1-tool-install-single-vet' };
    const lifecycleDeps = deps(async () => {
      vets += 1;
      return vetOutcome('safe');
    });
    const [first, second] = await Promise.all([
      createAndVetToolInstallProposalAsync(shared, lifecycleDeps),
      createAndVetToolInstallProposalAsync(shared, lifecycleDeps),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe('sandbox-vetted');
    expect(vets).toBe(1);
  });
});
