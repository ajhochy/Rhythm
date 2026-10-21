import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLITE_ORG_EVALUATION_SCHEMA } from '../../database/org_evaluation_schema';
import { ORG_EVALUATION_PROPOSAL_KINDS } from '../../models/org_evaluation';
import { requiredEffectEvidence } from '../../models/org_evaluation_effect_evidence';
import { OrgEvaluationRepository } from '../../repositories/org_evaluation_repository';
import { evaluationCanonicalJson } from '../org_evaluation_integrity';

const JOB_ID = 'evaluation-contract-1';
const HASH = 'a'.repeat(64);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

let db: Database.Database;
let repo: OrgEvaluationRepository;

function seedJob(maxTokens = 100, validationReserveTokens = 30) {
  db.prepare(`INSERT INTO org_evaluation_jobs
    (id, source_audit_run_id, owner_user_id, status, max_tokens, validation_reserve_tokens,
     original_hash, target_ref, target_revision, input_json, created_at, updated_at)
    VALUES (?, NULL, 7, 'planning', ?, ?, ?, 'agent_config:target', 'revision-1', ?, ?, ?)`).run(
    JOB_ID, maxTokens, validationReserveTokens, HASH,
    JSON.stringify({ tasks: ['known', 'held-out'], candidateCount: 2 }),
    '2026-10-21T00:00:00.000Z', '2026-10-21T00:00:00.000Z',
  );
}

function reserve(key: string, maxTokens: number, stage: 'candidate-probe' | 'final-validation' = 'candidate-probe') {
  return repo.reserveTokensAsync({ jobId: JOB_ID, reservationKey: key, stage, maxTokens });
}

const usage = (totalTokens: number) => ({
  totalTokens, inputTokens: totalTokens - 2, outputTokens: 2,
  cacheReadTokens: null, reasoningTokens: null,
});

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SQLITE_ORG_EVALUATION_SCHEMA);
  repo = new OrgEvaluationRepository(db);
  seedJob();
});

afterEach(() => db.close());

describe('pre-review durable evaluation contract', () => {
  it('binds a singleton publication final to exactly one frozen tested action', async () => {
    const action = { skillName: 'Reviewed Skill', action: 'publish' };
    db.prepare('UPDATE org_evaluation_jobs SET target_ref=?, input_json=? WHERE id=?').run(
      'skill:reviewed-skill', JSON.stringify({ candidateStrategy: 'singleton-action',
        snapshot: { kind: 'publish-skill-to-org', targetRef: 'skill:reviewed-skill',
          skills: [{ id: 'reviewed-skill', title: 'Reviewed Skill' }] },
        problem: { change: action } }), JOB_ID);
    const manifest = '{"published":true}';
    const candidate = (id: string, role: 'original' | 'variant' | 'composition' | 'final',
      changeJson: string, parents: string[] = [], effectiveConfigJson = manifest) => repo.addCandidateAsync({
        id, jobId: JOB_ID, role, ordinal: role === 'original' ? 0 : role === 'variant' ? 1 : 11,
        kind: 'publish-skill-to-org', targetRef: 'skill:reviewed-skill',
        configHash: digest(effectiveConfigJson), effectiveConfigJson,
        changeJson, parentCandidateIds: parents,
      });
    await candidate('original', 'original', '{}');
    await expect(candidate('invented', 'variant', JSON.stringify({ ...action, note: 'fake' })))
      .rejects.toThrow(/frozen action/);
    const variant = await candidate('variant', 'variant', evaluationCanonicalJson(action));
    await expect(candidate('duplicate', 'variant', evaluationCanonicalJson(action))).rejects.toThrow(/frozen action/);
    await expect(candidate('composition', 'composition', evaluationCanonicalJson(action), [variant.id]))
      .rejects.toThrow(/frozen action/);
    await expect(candidate('different-final', 'final', evaluationCanonicalJson(action), [variant.id], '{"published":false}'))
      .rejects.toThrow(/tested parent/);
    const final = await candidate('final', 'final', evaluationCanonicalJson(action), [variant.id]);
    expect(final.parentCandidateIds).toEqual([variant.id]);
  });

  it('org-evaluation-c1: the closed evaluation catalog includes every existing proposal kind including tool installation', () => {
    expect(ORG_EVALUATION_PROPOSAL_KINDS).toEqual([
      'create-agent', 'grant-delegation', 'expand-delegation', 'broaden-scope',
      'tighten-scope', 'prune-scope', 'create-recipe', 'refine-recipe',
      'refine-skill', 'consolidate-skill', 'external-adoption', 'webhook-wiring',
      'refine-config', 'refine-scope', 'workflow-prompt-fix', 'refine-task',
      'publish-skill-to-org', 'tool-install',
    ]);
  });

  it('org-evaluation-c17: a workflow prompt fix needs observed managed skill execution', () => {
    expect(requiredEffectEvidence('workflow-prompt-fix')).toEqual([
      'managed-skill-bytes-written', 'skill-loaded', 'agent-output',
    ]);
  });

  it('requires different actual effects for publishing and unpublishing a frozen skill', () => {
    expect(requiredEffectEvidence('publish-skill-to-org', '{"action":"publish"}')).toEqual([
      'loopback-org-publish-received', 'org-skill-fetch', 'skill-loaded',
    ]);
    expect(requiredEffectEvidence('publish-skill-to-org', '{"action":"unpublish"}')).toEqual([
      'loopback-org-unpublish-received', 'org-skill-unavailable', 'skill-unavailable',
    ]);
    expect(requiredEffectEvidence('publish-skill-to-org', '{"action":"unknown"}')).toEqual([
      'invalid-publication-action',
    ]);
  });

  it('org-evaluation-c2: exploration admission preserves the final-validation allocation', async () => {
    expect(await reserve('probe-a', 50)).toMatchObject({ status: 'reserved', maxTokens: 50 });
    expect(await reserve('probe-b', 21)).toBeNull();
    expect(await reserve('validation-a', 30, 'final-validation')).toMatchObject({ status: 'reserved' });
    expect((await repo.getBudgetAsync(JOB_ID)).totalAvailableTokens).toBe(20);
  });

  it('org-evaluation-c3: concurrent children cannot reserve beyond the whole-run cap', async () => {
    const attempts = await Promise.all([reserve('child-a', 45), reserve('child-b', 45)]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect((await repo.getBudgetAsync(JOB_ID)).outstandingTokens).toBe(45);
    expect(db.prepare('SELECT COUNT(*) AS n FROM org_evaluation_token_reservations').get()).toMatchObject({ n: 1 });
  });

  it('org-evaluation-c4: retrying a reservation or settlement after restart is idempotent', async () => {
    const first = await reserve('call-1', 25);
    const secondRepo = new OrgEvaluationRepository(db);
    expect(await secondRepo.reserveTokensAsync({
      jobId: JOB_ID, reservationKey: 'call-1', stage: 'candidate-probe', maxTokens: 25,
    })).toEqual(first);
    await expect(secondRepo.reserveTokensAsync({
      jobId: JOB_ID, reservationKey: 'call-1', stage: 'candidate-probe', maxTokens: 24,
    })).rejects.toThrow();
    const settled = await repo.settleTokensAsync({ jobId: JOB_ID, reservationKey: 'call-1', usage: usage(17) });
    expect(await secondRepo.settleTokensAsync({ jobId: JOB_ID, reservationKey: 'call-1', usage: usage(17) })).toEqual(settled);
    expect((await repo.getBudgetAsync(JOB_ID)).settledTokens).toBe(17);
    expect((await repo.getBudgetAsync(JOB_ID)).outstandingTokens).toBe(0);
  });

  it('org-evaluation-c5: missing provider usage fails closed and retains the original', async () => {
    await reserve('unreported', 25);
    await repo.settleTokensAsync({ jobId: JOB_ID, reservationKey: 'unreported', usage: null });
    expect(await repo.getBudgetAsync(JOB_ID)).toMatchObject({ hasUnknownUsage: true });
    expect(await repo.getJobAsync(JOB_ID)).toMatchObject({
      status: 'inconclusive', qualifiedProposalId: null, originalHash: HASH,
    });
    expect(await reserve('later-probe', 1)).toBeNull();
  });

  it('org-evaluation-c6: actual usage settles once; an overrun cannot qualify', async () => {
    await reserve('bounded', 20);
    await repo.settleTokensAsync({ jobId: JOB_ID, reservationKey: 'bounded', usage: usage(12) });
    expect(await repo.getBudgetAsync(JOB_ID)).toMatchObject({ settledTokens: 12, outstandingTokens: 0 });
    await reserve('overrun', 20);
    await repo.settleTokensAsync({ jobId: JOB_ID, reservationKey: 'overrun', usage: usage(21) });
    expect(await repo.getJobAsync(JOB_ID)).toMatchObject({ status: 'inconclusive', qualifiedProposalId: null });
  });

  it('org-evaluation-c7: candidate versions and execution receipts remain immutable and recoverable', async () => {
    const effectiveConfigJson = JSON.stringify({ prompt: 'test candidate', permissions: { search: 'deny' } });
    const candidate = await repo.addCandidateAsync({
      id: 'candidate-1', jobId: JOB_ID, role: 'variant', ordinal: 1,
      kind: 'refine-config', targetRef: 'agent_config:target', configHash: digest(effectiveConfigJson),
      effectiveConfigJson,
      changeJson: JSON.stringify({ prompt: 'test candidate' }), parentCandidateIds: [],
    });
    await expect(repo.addCandidateAsync({
      ...candidate, effectiveConfigJson: JSON.stringify({ prompt: 'silently changed' }),
    })).rejects.toThrow();
    const receiptJson = JSON.stringify({
      sessionId: 'ses-owned', engineVersion: 'exact', taskFixtureHash: HASH,
      effectiveConfigHash: candidate.configHash, toolEvents: [],
      effectProof: {
        manifestHash: candidate.configHash, negativeGuardsPassed: true,
        workerId: 'owned-worker', workerRootHash: HASH, engineBootId: 'owned-engine',
        events: ['profile-projected', 'agent-output'].map((kind) => ({ kind, source: 'worker-file', subject: candidate.targetRef,
          observedAt: '2026-10-21T00:00:00.000Z', evidenceHash: HASH })),
      },
    });
    const receipt = await repo.addResultAsync({
      id: 'result-1', jobId: JOB_ID, candidateId: candidate.id, phase: 'probe', taskKey: 'known',
      receiptHash: digest(receiptJson), receiptJson,
      status: 'pass', score: 0.8, tokenUsage: usage(8), failureReason: null,
    });
    expect(await repo.listCandidatesAsync(JOB_ID)).toEqual([candidate]);
    expect(await repo.listResultsAsync(JOB_ID)).toEqual([receipt]);
    await expect(repo.addResultAsync({ ...receipt, score: 0.1 })).rejects.toThrow();
  });

  it('org-evaluation-c8: CAS prevents concurrent qualification or queue identity overwrite', async () => {
    const original = await repo.getJobAsync(JOB_ID);
    expect(original?.revision).toBe(0);
    const first = await repo.updateJobAsync(JOB_ID, 0, { status: 'exploring' });
    expect(first?.revision).toBe(1);
    expect(await repo.updateJobAsync(JOB_ID, 0, { status: 'qualified', qualifiedProposalId: 'proposal-1' })).toBeNull();
    await expect(repo.updateJobAsync(JOB_ID, 1, { status: 'qualified', qualifiedProposalId: 'proposal-1' }))
      .rejects.toThrow('Evaluation is not qualified');
    expect(await repo.getJobAsync(JOB_ID)).toMatchObject({ status: 'exploring', qualifiedProposalId: null });
  });

  it('org-evaluation-c15: a tool install cannot pass on profile projection evidence alone', async () => {
    const effectiveConfigJson = JSON.stringify({ tool: 'owned' });
    const candidate = await repo.addCandidateAsync({ id:'tool-variant', jobId:JOB_ID, role:'variant', ordinal:1,
      kind:'tool-install', targetRef:'agent_config:target', effectiveConfigJson,
      configHash:digest(effectiveConfigJson), changeJson:'{}', parentCandidateIds:[] });
    const receiptJson = JSON.stringify({ sessionId:'session-real', engineVersion:'exact', taskFixtureHash:HASH,
      effectiveConfigHash:candidate.configHash, toolEvents:[], effectProof:{ manifestHash:candidate.configHash,
        negativeGuardsPassed:true, workerId:'worker-1', workerRootHash:HASH, engineBootId:'engine-1',
        events:[{kind:'profile-projected',source:'worker-file',subject:candidate.targetRef,
          observedAt:'2026-10-21T00:00:00.000Z',evidenceHash:HASH}] } });
    await expect(repo.addResultAsync({id:'result-tool',jobId:JOB_ID,candidateId:candidate.id,
      phase:'probe',taskKey:'tool-case',receiptJson,receiptHash:digest(receiptJson),status:'pass',
      score:0.9,tokenUsage:usage(8),failureReason:null})).rejects.toThrow(/required effect evidence/);
  });

  it('org-evaluation-c16: a partial final output cannot qualify even when it improves the original', async () => {
    const manifest = JSON.stringify({ profile: 'frozen' });
    const makeCandidate = async (id: string, role: 'original' | 'variant' | 'composition' | 'final',
      parents: string[] = [], parts: Array<{ sourceCandidateId: string; changePath: string;
        retained: boolean; reason: string; evidenceResultIds: string[] }> = []) => repo.addCandidateAsync({
      id, jobId: JOB_ID, role, ordinal: role === 'original' ? 0 : role === 'variant' ? Number(id.slice(-1)) : role === 'composition' ? 10 : 11,
      kind: 'refine-config', targetRef: 'agent_config:target', effectiveConfigJson: manifest,
      configHash: digest(manifest), changeJson: '{"prompt":"frozen"}', parentCandidateIds: parents, compositionParts: parts,
    });
    const result = async (candidateId: string, phase: 'probe' | 'validation', score: number) => {
      const receiptJson = JSON.stringify({ sessionId: `${candidateId}-${phase}`, engineVersion: 'exact',
        taskFixtureHash: HASH, effectiveConfigHash: digest(manifest), toolEvents: [], effectProof: {
          manifestHash: digest(manifest), negativeGuardsPassed: true, workerId: 'worker',
          workerRootHash: HASH, engineBootId: 'engine', events: ['profile-projected', 'agent-output']
            .map((kind) => ({ kind, source: 'worker-file', subject: 'agent_config:target', evidenceHash: HASH })),
        } });
      return repo.addResultAsync({ id: `${candidateId}-${phase}`, jobId: JOB_ID, candidateId, phase,
        taskKey: 'same-task', receiptJson, receiptHash: digest(receiptJson), status: 'pass',
        score, tokenUsage: usage(8), failureReason: null });
    };
    await makeCandidate('original', 'original');
    await makeCandidate('variant-1', 'variant');
    await makeCandidate('variant-2', 'variant');
    await result('original', 'probe', 0.25);
    const first = await result('variant-1', 'probe', 0.75);
    await result('variant-2', 'probe', 0.75);
    const parts = [{ sourceCandidateId: 'variant-1', changePath: '/prompt', retained: true,
      reason: 'Improved observed behavior', evidenceResultIds: [first.id] }];
    await makeCandidate('composition', 'composition', ['variant-1', 'variant-2'], parts);
    await result('composition', 'probe', 0.75);
    await makeCandidate('final', 'final', ['composition'], parts);
    await result('original', 'validation', 0.25);
    await result('final', 'validation', 0.75);
    await expect(repo.updateJobAsync(JOB_ID, 0, { status: 'qualified', finalCandidateId: 'final' }))
      .rejects.toThrow('Independent final validation');
    expect(await repo.getJobAsync(JOB_ID)).toMatchObject({ status: 'planning', qualifiedProposalId: null });
  });

  it('org-evaluation-c18: composition cannot claim copied portions absent from source bytes', async () => {
    const manifest = '{"policy":"bounded"}';
    await repo.addCandidateAsync({ id: 'baseline', jobId: JOB_ID, role: 'original', ordinal: 0,
      kind: 'refine-config', targetRef: 'agent_config:target', effectiveConfigJson: manifest,
      configHash: digest(manifest), changeJson: '{}', parentCandidateIds: [] });
    await repo.addCandidateAsync({ id: 'source', jobId: JOB_ID, role: 'variant', ordinal: 1,
      kind: 'refine-config', targetRef: 'agent_config:target', effectiveConfigJson: manifest,
      configHash: digest(manifest), changeJson: '{"prompt":"keep alpha, reject beta"}', parentCandidateIds: [] });
    const receiptJson = JSON.stringify({ sessionId: 'source-session', engineVersion: 'exact', taskFixtureHash: HASH,
      effectiveConfigHash: digest(manifest), toolEvents: [], effectProof: { manifestHash: digest(manifest),
        negativeGuardsPassed: true, workerId: 'worker', workerRootHash: HASH, engineBootId: 'engine',
        events: ['profile-projected', 'agent-output'].map((kind) => ({ kind, source: 'worker-file',
          subject: 'agent_config:target', evidenceHash: HASH })) } });
    await repo.addResultAsync({ id: 'source-result', jobId: JOB_ID, candidateId: 'source', phase: 'probe',
      taskKey: 'task', receiptJson, receiptHash: digest(receiptJson), status: 'pass', score: 1,
      tokenUsage: usage(8), failureReason: null });
    await repo.addResultAsync({ id: 'baseline-result', jobId: JOB_ID, candidateId: 'baseline', phase: 'probe',
      taskKey: 'task', receiptJson, receiptHash: digest(receiptJson), status: 'pass', score: 0.25,
      tokenUsage: usage(8), failureReason: null });
    await repo.addResultAsync({ id: 'baseline-no-gain', jobId: JOB_ID, candidateId: 'baseline', phase: 'probe',
      taskKey: 'task-no-gain', receiptJson, receiptHash: digest(receiptJson), status: 'pass', score: 0.25,
      tokenUsage: usage(8), failureReason: null });
    await repo.addResultAsync({ id: 'source-no-gain', jobId: JOB_ID, candidateId: 'source', phase: 'probe',
      taskKey: 'task-no-gain', receiptJson, receiptHash: digest(receiptJson), status: 'pass', score: 0.25,
      tokenUsage: usage(8), failureReason: null });
    const compose = (changeJson: string, part: { changePath: string; retained: boolean; sourceFragment?: string },
      evidenceId = 'source-result') =>
      repo.addCandidateAsync({ id: `composition-${Math.random()}`, jobId: JOB_ID, role: 'composition', ordinal: 10,
        kind: 'refine-config', targetRef: 'agent_config:target', effectiveConfigJson: manifest,
        configHash: digest(manifest), changeJson, parentCandidateIds: ['source'], compositionParts: [{
          sourceCandidateId: 'source', reason: 'Execution-backed composition', evidenceResultIds: [evidenceId], ...part,
        }] });
    await expect(compose('{"prompt":"unrelated"}', { changePath: '/prompt', retained: true }))
      .rejects.toThrow(/does not match source change bytes/);
    await expect(compose('{"prompt":"keep alpha"}', { changePath: 'prompt', retained: true }))
      .rejects.toThrow(/does not match source change bytes/);
    await expect(compose('{"prompt":"keep alpha"}', { changePath: '/prompt', retained: true,
      sourceFragment: 'missing text' })).rejects.toThrow(/does not match source change bytes/);
    await expect(compose('{"prompt":"keep alpha"}', { changePath: '/prompt', retained: false,
      sourceFragment: 'keep alpha' })).rejects.toThrow(/does not match source change bytes/);
    await expect(compose('{"prompt":"keep alpha"}', { changePath: '/prompt', retained: true,
      sourceFragment: 'keep alpha' }, 'source-no-gain')).rejects.toThrow(/no improved probe evidence/);
    await expect(compose('{"prompt":"keep alpha"}', { changePath: '/prompt', retained: true,
      sourceFragment: 'keep alpha' })).resolves.toMatchObject({ role: 'composition' });
  });

  it('org-evaluation-c12: reviewer diagnosis and concurrent target children spend one root budget', async () => {
    const child = async (id: string) => repo.createJobAsync({
      id, budgetRootId: JOB_ID, sourceAuditRunId: null, ownerUserId: 7,
      maxTokens: 100, validationReserveTokens: 30, originalHash: HASH,
      targetRef: `agent_config:${id}`, targetRevision: 'revision-1', inputJson: '{}',
    });
    await child('target-one');
    await child('target-two');
    await reserve('reviewer-diagnosis', 20, 'candidate-probe');
    await repo.settleTokensAsync({ jobId: JOB_ID, reservationKey: 'reviewer-diagnosis', usage: usage(18) });
    const results = await Promise.all([
      repo.admitProviderCallAsync({ jobId: 'target-one', reservationKey: 'probe', stage: 'candidate-probe', maxTokens: 30 }),
      repo.admitProviderCallAsync({ jobId: 'target-two', reservationKey: 'probe', stage: 'candidate-probe', maxTokens: 30 }),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await repo.getBudgetAsync(JOB_ID)).toMatchObject({ settledTokens: 18, outstandingTokens: 30 });
    expect(await repo.getBudgetAsync('target-two')).toEqual(await repo.getBudgetAsync(JOB_ID));
  });

  it('org-evaluation-c13: unknown child usage poisons the shared root and sibling admissions', async () => {
    for (const id of ['target-one', 'target-two']) await repo.createJobAsync({
      id, budgetRootId: JOB_ID, sourceAuditRunId: null, ownerUserId: 7,
      maxTokens: 100, validationReserveTokens: 30, originalHash: HASH,
      targetRef: `agent_config:${id}`, targetRevision: 'revision-1', inputJson: '{}',
    });
    await repo.admitProviderCallAsync({ jobId: 'target-one', reservationKey: 'lost', stage: 'candidate-probe', maxTokens: 20 });
    await repo.settleTokensAsync({ jobId: 'target-one', reservationKey: 'lost', usage: null });
    expect(await repo.getBudgetAsync(JOB_ID)).toMatchObject({ hasUnknownUsage: true, outstandingTokens: 20 });
    expect(await repo.getJobAsync(JOB_ID)).toMatchObject({ status: 'inconclusive' });
    expect((await repo.admitProviderCallAsync({ jobId: 'target-two', reservationKey: 'new',
      stage: 'candidate-probe', maxTokens: 1 })).reservation).toBeNull();
  });

  it('org-evaluation-c14: a review cycle closes only after every child and provider call finishes', async () => {
    db.prepare('UPDATE org_evaluation_jobs SET target_ref = ? WHERE id = ?')
      .run('org-review-cycle:cycle-1', JOB_ID);
    await repo.createJobAsync({
      id: 'target-one', budgetRootId: JOB_ID, sourceAuditRunId: null, ownerUserId: 7,
      maxTokens: 100, validationReserveTokens: 30, originalHash: HASH,
      targetRef: 'agent_config:target-one', targetRevision: 'revision-1', inputJson: '{}',
    });
    await expect(repo.finishReviewCycleAsync(JOB_ID)).rejects.toThrow('Review cycle has active children');
    await repo.updateJobAsync('target-one', 0, { status: 'inconclusive', failureReason: 'No safe candidate' });
    await reserve('reviewer-diagnosis', 20);
    await expect(repo.finishReviewCycleAsync(JOB_ID)).rejects.toThrow('Review cycle has unsettled provider calls');
    await repo.settleTokensAsync({ jobId: JOB_ID, reservationKey: 'reviewer-diagnosis', usage: usage(18) });
    expect(await repo.finishReviewCycleAsync(JOB_ID)).toMatchObject({ status: 'qualified' });
    expect((await reserve('late', 1))).toBeNull();
    await expect(repo.createJobAsync({
      id: 'late-target', budgetRootId: JOB_ID, sourceAuditRunId: null, ownerUserId: 7,
      maxTokens: 100, validationReserveTokens: 30, originalHash: HASH,
      targetRef: 'agent_config:late', targetRevision: 'revision-1', inputJson: '{}',
    })).rejects.toThrow('Invalid shared evaluation budget root');
  });
});
