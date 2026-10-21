import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluationCanonicalJson, evaluationDigest } from '../services/org_evaluation_integrity';
import { startTestServer } from './helpers/real_server';

// This is a human-approval HTTP/SQLite boundary test. Qualified evaluation
// rows are fixture input; this test does not prove their model execution.
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const timestamp = '2026-10-21T00:00:00.000Z';
let db: Database.Database;
let baseUrl: string;
let close: () => Promise<void>;
let previousDb: ReturnType<typeof import('../database/db')['setDb']>;
let profileId: string;
let proposalId: string;
let originalHash: string;
let finalCandidateHash: string;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('AGENT_LOCAL', 'true');
  const { runMigrations } = await import('../database/migrations');
  const { setDb } = await import('../database/db');
  const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
  const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
  const { captureOrgEvaluationTargetAsync } = await import('../services/org_evaluation_fixture');
  const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
  const { createApp } = await import('../app');
  db = new Database(':memory:');
  runMigrations(db);
  previousDb = setDb(db);
  registerAllProposalAppliers();
  const profile = new AgentConfigsRepository().insert({ label: 'Evaluation approval fixture', icon: 'shield', modelProvider: 'anthropic', modelId: 'before' });
  profileId = profile.id;
  const targetRef = `agent_config:${profileId}`;
  const snapshot = await captureOrgEvaluationTargetAsync({ kind: 'refine-config', targetRef, expectedRevision: String(profile.revision ?? 0), ownerUserId: null });
  originalHash = evaluationDigest(evaluationCanonicalJson(snapshot));
  const changeJson = JSON.stringify({ configPatch: { agentConfigId: profileId, field: 'model', value: 'anthropic/after' } });
  const effectiveConfigJson = JSON.stringify({ test: 'exact final candidate' });
  finalCandidateHash = digest(effectiveConfigJson);
  const proposal = await new AgentOrgProposalsRepository(db).createAsync({
    kind: 'refine-config', risk: 'high', status: 'proposed', title: 'Evaluated config repair',
    targetRef, changeJson,
    provenanceJson: JSON.stringify({ source: 'org-reviewer-evaluated', humanReviewRequired: true,
      evaluation: { evaluationId: 'qualified-job', originalHash, finalCandidateHash } }),
  });
  proposalId = proposal.id;
  db.prepare(`INSERT INTO org_evaluation_jobs
    (id,source_audit_run_id,owner_user_id,status,max_tokens,validation_reserve_tokens,
     original_hash,target_ref,target_revision,input_json,final_candidate_id,qualified_proposal_id,
     created_at,updated_at)
    VALUES ('qualified-job',NULL,NULL,'qualified',100000,20000,?,?,?,?,?, ?,?,?)`).run(
    originalHash, targetRef, String(profile.revision ?? 0),
    JSON.stringify({ snapshot, problem: { change: JSON.parse(changeJson), evidence: [] } }),
    'final-1', proposalId, timestamp, timestamp,
  );
  db.prepare(`INSERT INTO org_evaluation_candidates
    (id,job_id,role,ordinal,kind,target_ref,config_hash,effective_config_json,
     change_json,parent_candidate_ids_json,created_at)
    VALUES ('final-1','qualified-job','final',0,'refine-config',?,?,?,?, '[]',?)`).run(
    targetRef, finalCandidateHash, effectiveConfigJson, changeJson, timestamp,
  );
  ({ baseUrl, close } = await startTestServer(createApp()));
});

afterEach(async () => {
  await close?.();
  const { setDb } = await import('../database/db');
  setDb(previousDb ?? null);
  db?.close();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const proof = () => ({ expectedEvaluationId: 'qualified-job', originalHash, finalCandidateHash });
const approve = (body: unknown) => fetch(`${baseUrl}/agent-org-proposals/${proposalId}/approve`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('qualified evaluation binding at the human approval route', () => {
  it('projects the exact tested version into the queue card', async () => {
    const response = await fetch(`${baseUrl}/agent-org-proposals?status=proposed`);
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<Record<string, unknown>>;
    expect(rows.find(row => row.id === proposalId)).toMatchObject({
      source: 'org-reviewer-evaluated', preReviewEvaluation: {
        evaluationId: 'qualified-job', originalHash, finalCandidateHash, status: 'qualified',
      },
    });
  });

  it('refuses missing or mismatched evaluated proof before changing the target', async () => {
    expect((await approve({})).status).toBe(400);
    expect((await approve({ ...proof(), finalCandidateHash: 'f'.repeat(64) })).status).toBe(409);
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    expect(new AgentConfigsRepository().getById(profileId)?.modelId).toBe('before');
  });

  it('refuses a stale target revision even with an exact qualified evaluation', async () => {
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const configs = new AgentConfigsRepository();
    configs.update(profileId, { systemPrompt: 'Human changed this target after evaluation.' });
    const response = await approve(proof());
    expect(response.status).toBe(409);
    expect(configs.getById(profileId)).toMatchObject({ modelId: 'before', systemPrompt: 'Human changed this target after evaluation.' });
  });

  it('refuses a demoted job or a proposal payload that differs from the immutable final candidate', async () => {
    db.prepare("UPDATE org_evaluation_jobs SET status='inconclusive' WHERE id='qualified-job'").run();
    expect((await approve(proof())).status).toBe(409);
    db.prepare("UPDATE org_evaluation_jobs SET status='qualified' WHERE id='qualified-job'").run();
    db.prepare('UPDATE agent_org_proposals SET change_json=? WHERE id=?').run(
      JSON.stringify({ configPatch: { agentConfigId: profileId, field: 'model', value: 'anthropic/untested' } }), proposalId,
    );
    expect((await approve(proof())).status).toBe(409);
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    expect(new AgentConfigsRepository().getById(profileId)?.modelId).toBe('before');
  });

  it('refuses a child result until its shared budget root is closed and all siblings finish', async () => {
    db.prepare(`INSERT INTO org_evaluation_jobs
      (id,source_audit_run_id,owner_user_id,status,max_tokens,validation_reserve_tokens,
       original_hash,target_ref,target_revision,input_json,created_at,updated_at)
      VALUES ('budget-root',NULL,NULL,'exploring',100000,20000,?,?,?, '{}',?,?)`).run(
      originalHash, 'org-review-cycle:fixture', '1', timestamp, timestamp,
    );
    db.prepare("UPDATE org_evaluation_jobs SET budget_root_id='budget-root' WHERE id='qualified-job'").run();
    expect((await approve(proof())).status).toBe(409);
    db.prepare("UPDATE org_evaluation_jobs SET status='qualified' WHERE id='budget-root'").run();
    db.prepare(`INSERT INTO org_evaluation_jobs
      (id,budget_root_id,source_audit_run_id,owner_user_id,status,max_tokens,validation_reserve_tokens,
       original_hash,target_ref,target_revision,input_json,created_at,updated_at)
      VALUES ('active-sibling','budget-root',NULL,NULL,'validating',100000,20000,?,?,?, '{}',?,?)`).run(
      originalHash, 'agent_config:other', '1', timestamp, timestamp,
    );
    expect((await approve(proof())).status).toBe(409);
    db.prepare("UPDATE org_evaluation_jobs SET status='inconclusive' WHERE id='active-sibling'").run();
    expect((await approve(proof())).status).toBe(200);
  });

  it('lets the exact human-approved qualified version reach the existing applier', async () => {
    const response = await approve(proof());
    expect(response.status).toBe(200);
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    expect(new AgentConfigsRepository().getById(profileId)?.modelId).toBe('after');
  });
});
