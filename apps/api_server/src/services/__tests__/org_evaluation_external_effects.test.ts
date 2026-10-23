import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrations';
import { getDb, setDb } from '../../database/db';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../../repositories/tool_safety_reports_repository';
import { promoteQualifiedToolVettingAsync } from '../org_evaluation_external_effects';
import { vetToolInstallCandidateAsync } from '../org_evaluation_external_effects';
import { buildProfileRevisionFingerprint } from '../org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const timestamp = '2026-10-21T00:00:00.000Z';
let previousDb: ReturnType<typeof setDb>;
let db: Database.Database;

afterEach(() => {
  setDb(previousDb ?? null);
  db?.close();
});

describe('qualified tool-install safety receipt promotion', () => {
  it('validates against the frozen private profile without initializing the parent global DB', async () => {
    const scratch = mkdtempSync('/private/tmp/rhythm-eval-vetting-');
    const profile = { id: 'owned-profile', label: 'Owned', revision: 2, systemPrompt: 'Frozen',
      allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{}',
      allowedDelegatesJson: '[]', isManager: false, modelProvider: null, modelId: null };
    const snapshot = { schemaVersion: 1 as const, kind: 'tool-install' as const,
      targetRef: 'agent_config:owned-profile', targetRevision: 'absent',
      effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5', source: 'profile' as const },
      profiles: [{ ...profile, id: 'delegate-dependency', revision: 99 }, profile],
      skills: [], schedules: [], recipes: [], managedSkillFiles: [],
      creationControl: { targetName: 'fixture-tool', absenceKind: 'managed-tool',
        baselineProfileId: profile.id, catalogFingerprint: 'owned', evidenceSessionIds: ['s1', 's2'],
        dependencyFingerprints: {} } };
    const change = { toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${'a'.repeat(64)}`,
      installMethod: 'local-tarball', agentConfigId: profile.id,
      testPrompts: ['version-check', 'help-check', 'stdin-noop'],
      evidenceBundle: { version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
        sourceEvidence: { sessionIds: ['s1', 's2'], eventIds: [] },
        counterEvidenceSearch: { query: 'owned absence', searchedAt: timestamp, contradictingCount: 0 },
        target: { ref: snapshot.targetRef, hash: buildProfileRevisionFingerprint(profile) },
        expectedOutcome: 'Tool becomes available', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
        guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count', rollbackRule: 'remove',
        generatorVersion: 'owned', confidenceCalibrationVersion: 'owned' } };
    const prior = setDb(null);
    try {
      mkdirSync(join(scratch, 'artifacts'));
      await expect(vetToolInstallCandidateAsync({ changeJson: JSON.stringify(change), workerRoot: scratch,
        artifactRoot: join(scratch, 'artifacts'), validationSnapshot: snapshot }))
        .rejects.toThrow(/available immutable local tarball/);
      const stale = { ...snapshot, profiles: snapshot.profiles.map((item) => item.id === profile.id
        ? { ...item, revision: 3 } : item) };
      await expect(vetToolInstallCandidateAsync({ changeJson: JSON.stringify(change), workerRoot: scratch,
        artifactRoot: join(scratch, 'artifacts'), validationSnapshot: stale }))
        .rejects.toThrow(/fabricated/);
    } finally { setDb(prior); rmSync(scratch, { recursive: true, force: true }); }
  });
  it('keeps a qualified-looking proposal unapprovable when the final validation has no Docker proof', async () => {
    db = new Database(':memory:');
    runMigrations(db);
    previousDb = setDb(db);
    const proposals = new AgentOrgProposalsRepository(db);
    const changeJson = JSON.stringify({
      toolName: 'test-tool', packageSource: 'test-tool', installMethod: 'npm install',
      testPrompts: ['basic-invocation', 'forbidden-path'],
    });
    const proposal = await proposals.createAsync({ kind: 'tool-install', status: 'proposed',
      title: 'Private tool receipt check', risk: 'high', targetRef: 'agent_config:test', changeJson });
    db.prepare(`INSERT INTO org_evaluation_jobs
      (id,source_audit_run_id,owner_user_id,status,max_tokens,validation_reserve_tokens,
       original_hash,target_ref,target_revision,input_json,final_candidate_id,qualified_proposal_id,created_at,updated_at)
      VALUES ('tool-eval',NULL,NULL,'qualified',100000,20000,?,'agent_config:test','0','{}','final',?,?,?)`)
      .run('a'.repeat(64), proposal.id, timestamp, timestamp);
    db.prepare(`INSERT INTO org_evaluation_candidates
      (id,job_id,role,ordinal,kind,target_ref,config_hash,effective_config_json,
       change_json,parent_candidate_ids_json,created_at)
      VALUES ('final','tool-eval','final',0,'tool-install','agent_config:test',?,'{}',?,'[]',?)`)
      .run('b'.repeat(64), changeJson, timestamp);

    await expect(promoteQualifiedToolVettingAsync({ proposalId: proposal.id, evaluationId: 'tool-eval' }))
      .rejects.toThrow('no immutable Docker vetting receipt');
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('pending');
    expect(await new ToolSafetyReportsRepository(getDb()).findByProposalIdAsync(proposal.id)).toBeNull();
  });
});
