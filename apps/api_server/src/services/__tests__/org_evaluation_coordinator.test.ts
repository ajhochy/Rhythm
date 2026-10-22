import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { OrgEvaluationRepository } from '../../repositories/org_evaluation_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { OrgEvaluationCoordinator, parseEvaluationDiagnoses, type OrgEvaluationDiagnosis,
  type OrgEvaluationRuntimePort } from '../org_evaluation_coordinator';
import { evaluationCanonicalJson, evaluationDigest } from '../org_evaluation_integrity';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { captureOrgEvaluationTargetAsync } from '../org_evaluation_fixture';

// These tests exercise durable orchestration with a controlled executor.
// Packaged qualification separately has to prove real engine/tool execution.
let db: Database.Database;
let previous: Database.Database | null;
let repository: OrgEvaluationRepository;
const patch = (value: string) => ({ configPatch: { agentConfigId: 'evaluation-target', field: 'system_prompt', value } });
const diagnosis: OrgEvaluationDiagnosis = {
  kind: 'refine-config', targetRef: 'agent_config:evaluation-target', targetRevision: '0',
  title: '[smoke] use requested output headings', rationale: 'Two tasks omitted the requested headings.',
  evidence: [{ sessionId: 'evidence-one', messageId: 'm1', quote: 'missing heading' },
    { sessionId: 'evidence-two', messageId: 'm2', quote: 'still missing heading' }],
  change: patch('Use required headings'), cases: [
    { key: 'service-summary', prompt: 'Summarize service items.', outputIncludes: ['Actions'], outputExcludes: [] },
    { key: 'meeting-summary', prompt: 'Summarize meeting items.', outputIncludes: ['Actions'], outputExcludes: [] },
  ],
};

beforeEach(() => {
  db = new Database(':memory:'); runMigrations(db); previous = setDb(db);
  repository = new OrgEvaluationRepository(db);
  db.prepare(`INSERT INTO agent_configs (id,label,icon,command,system_prompt,allowed_skills_json)
    VALUES ('evaluation-target','[smoke] Evaluation target','test','opencode','Original instruction','[]')`).run();
  registerAllProposalAppliers();
});
afterEach(() => { setDb(previous); db.close(); });

function harness(options: { finalScore?: number; mutateDuring?: boolean; unknownUsage?: boolean;
  publishFailure?: boolean; singletonPublication?: boolean;
  fencedStage?: 'diagnosis' | 'alternatives' | 'composition' } = {}) {
  const modelReply = (stage: 'diagnosis' | 'alternatives' | 'composition', value: unknown) => {
    const json = JSON.stringify(value);
    return options.fencedStage === stage ? `\n\`\`\`${stage === 'composition' ? '' : 'json'}\n${json}\n\`\`\`\n` : json;
  };
  const calls: Array<{ type: string; phase?: string; role?: string; prompt?: string }> = [];
  const selectedDiagnosis: OrgEvaluationDiagnosis = options.singletonPublication ? {
    ...diagnosis, kind: 'publish-skill-to-org', targetRef: 'skill:reviewed-skill', targetRevision: '1',
    change: { skillName: 'Reviewed Skill', action: 'unpublish' },
  } : diagnosis;
  const publicationSnapshot = {
    schemaVersion: 1 as const, kind: 'publish-skill-to-org' as const,
    targetRef: selectedDiagnosis.targetRef, targetRevision: selectedDiagnosis.targetRevision,
    effectiveModel: { providerID: 'anthropic' as const, modelID: 'claude-sonnet-4-6',
      source: 'hardcoded-default' as const },
    profiles: [], schedules: [], recipes: [], managedSkillFiles: [],
    skills: [{ id: 'reviewed-skill', title: 'Reviewed Skill', body: 'Reviewed body',
      description: null, whenToUse: null, version: 1 }],
  };
  const runtime: OrgEvaluationRuntimePort = {
    async prepare(input) {
      const manifestJson = evaluationCanonicalJson({ snapshot: input.snapshot, change: JSON.parse(input.changeJson) });
      return { manifestJson, manifestHash: evaluationDigest(manifestJson) };
    },
    async execute(input) {
      calls.push({ type: 'execute', phase: input.phase, role: input.candidate.role, prompt: input.task.prompt });
      if (options.mutateDuring && input.phase === 'validation') db.prepare("UPDATE agent_configs SET system_prompt='Human edit'").run();
      const usage = { totalTokens: 5, inputTokens: 3, outputTokens: 2, cacheReadTokens: null, reasoningTokens: null };
      await repository.reserveTokensAsync({ jobId: input.jobId, stage: input.stage, reservationKey: `${input.candidate.id}:${input.task.key}`, maxTokens: 10 });
      await repository.settleTokensAsync({ jobId: input.jobId, reservationKey: `${input.candidate.id}:${input.task.key}`,
        usage: options.unknownUsage ? null : usage });
      return { status: 'pass', score: input.candidate.role === 'original' ? .25 : options.finalScore ?? 1,
        tokenUsage: usage, failureReason: null, receiptJson: evaluationCanonicalJson({
          sessionId: `controlled-${input.candidate.id}-${input.task.key}`, engineVersion: 'controlled-test-executor',
          taskFixtureHash: evaluationDigest(evaluationCanonicalJson(input.task)), effectiveConfigHash: input.candidate.configHash,
          toolEvents: [], effectProof: { manifestHash: input.candidate.configHash, negativeGuardsPassed: true,
            workerId: 'controlled-worker', workerRootHash: 'a'.repeat(64), engineBootId: 'controlled-engine',
            events: [{ kind: 'profile-projected', source: 'worker-file', subject: input.candidate.targetRef,
              evidenceHash: 'b'.repeat(64), observedAt: new Date().toISOString() },
            { kind: 'agent-output', source: 'engine-session', subject: 'controlled-output',
              evidenceHash: 'c'.repeat(64), observedAt: new Date().toISOString() },
            ...(options.singletonPublication ? ['loopback-org-unpublish-received', 'org-skill-unavailable', 'skill-unavailable']
              .map(kind => ({ kind, source: 'loopback-receiver', subject: 'reviewed-skill',
                evidenceHash: 'd'.repeat(64), observedAt: new Date().toISOString() })) : [])] },
        }) };
    },
  };
  let generated = false;
  const coordinator = new OrgEvaluationCoordinator({ repository, runtime,
    capture: (item, ownerUserId) => options.singletonPublication ? Promise.resolve(publicationSnapshot)
      : captureOrgEvaluationTargetAsync({
        kind: item.kind, targetRef: item.targetRef, expectedRevision: item.targetRevision, ownerUserId,
      }),
    // Evidence authorization has its own real-session route tests. This
    // controlled fixture supplies two known evidence references above.
    verifyEvidence: async () => {},
    async model(input) {
      calls.push({ type: input.stage, prompt: input.prompt });
      await repository.reserveTokensAsync({ jobId: input.jobId, stage: input.stage, reservationKey: `model-${calls.length}`, maxTokens: 20 });
      await repository.settleTokensAsync({ jobId: input.jobId, reservationKey: `model-${calls.length}`,
        usage: { totalTokens: 8, inputTokens: 5, outputTokens: 3, cacheReadTokens: null, reasoningTokens: null } });
      if (!generated) { generated = true; return modelReply('diagnosis', { diagnoses: [selectedDiagnosis] }); }
      if (input.stage === 'generator') return modelReply('alternatives', { candidates: [patch('Use Actions heading'), patch('Always show Actions heading')] });
      const data = JSON.parse(input.prompt.split('Untrusted frozen data: ')[1]);
      return modelReply('composition', { change: patch('Use Actions heading; preserve facts'), parts: data.variants.map((candidate: { id: string }, index: number) => ({
        sourceCandidateId: candidate.id, changePath: '/configPatch/value', sourceFragment: index === 0 ? 'Use Actions heading' : 'Always show Actions heading', retained: index === 0,
        reason: index === 0 ? 'Passed the task case' : 'No additional supported benefit',
        evidenceResultIds: data.observations.filter((result: { candidateId: string }) => result.candidateId === candidate.id)
          .map((result: { id: string }) => result.id),
      })) });
    },
    async publish(input) {
      calls.push({ type: 'publish' });
      expect((await repository.getJobAsync(input.auditRunId!))?.status).toBe('qualified');
      if (options.publishFailure) throw Error('Controlled proposal insert failure');
      return new AgentOrgProposalsRepository().createAsync(input);
    },
  });
  return { coordinator, calls };
}

describe('pre-review coordinator sequencing and queue boundary', () => {
  it.each(['diagnosis', 'alternatives', 'composition'] as const)(
    'accepts one whole fenced JSON response at the %s model stage', async (fencedStage) => {
      const { coordinator } = harness({ fencedStage });
      const result = await coordinator.run({ ownerUserId: null,
        settings: { tokenLimit: 10000, candidateCount: 2, lookbackDays: 7 }, context: { trusted: 'fixture' } });
      expect(result.cycle.status, result.cycle.failureReason ?? '').toBe('qualified');
      expect(result.proposals).toHaveLength(1);
      expect((await repository.listCandidatesAsync(result.evaluations[0].id)).map(candidate => candidate.role))
        .toEqual(['original', 'variant', 'variant', 'composition', 'final']);
    },
  );
  it('tests one code-owned publication action without fabricating variants or composition', async () => {
    const { coordinator, calls } = harness({ singletonPublication: true });
    const result = await coordinator.run({ ownerUserId: null,
      settings: { tokenLimit: 10000, candidateCount: 2, lookbackDays: 7 }, context: { trusted: 'fixture' } });
    expect(result.cycle.status, result.cycle.failureReason ?? '').toBe('qualified');
    expect(result.proposals, JSON.stringify(result.evaluations.map(job => ({ status: job.status,
      reason: job.failureReason })))).toHaveLength(1);
    expect(result.proposals[0].changeJson).toBe(evaluationCanonicalJson({
      skillName: 'Reviewed Skill', action: 'unpublish',
    }));
    const job = result.evaluations[0];
    expect(JSON.parse(job.inputJson).candidateStrategy).toBe('singleton-action');
    const candidates = await repository.listCandidatesAsync(job.id);
    expect(candidates.map(candidate => candidate.role)).toEqual(['original', 'variant', 'final']);
    expect(candidates[2].parentCandidateIds).toEqual([candidates[1].id]);
    expect(candidates[2].changeJson).toBe(candidates[1].changeJson);
    expect(calls.filter(call => call.type === 'generator')).toHaveLength(1); // diagnosis only
    expect(calls.some(call => call.type === 'composition')).toBe(false);
    expect((await repository.listResultsAsync(job.id)).filter(result => result.phase === 'validation')).toHaveLength(2);
  });

  it('keeps a singleton publication out of the queue when its final output is partial', async () => {
    const { coordinator } = harness({ singletonPublication: true, finalScore: .75 });
    const result = await coordinator.run({ ownerUserId: null,
      settings: { tokenLimit: 10000, candidateCount: 2, lookbackDays: 7 }, context: {} });
    expect(result.proposals).toEqual([]);
  });

  it('stores two tested alternatives and composition, withholds a case, then queues exactly the qualified final', async () => {
    const { coordinator, calls } = harness();
    const result = await coordinator.run({ ownerUserId: null, settings: { tokenLimit: 10000, candidateCount: 2, lookbackDays: 7 }, context: { trusted: 'fixture' } });
    expect(result.cycle.status, result.cycle.failureReason ?? '').toBe('qualified');
    expect(result.proposals, JSON.stringify(result.evaluations.map(job => ({ status: job.status, reason: job.failureReason })))).toHaveLength(1);
    const job = result.evaluations[0];
    const candidates = await repository.listCandidatesAsync(job.id);
    expect(candidates.map(candidate => candidate.role)).toEqual(['original', 'variant', 'variant', 'composition', 'final']);
    const results = await repository.listResultsAsync(job.id);
    expect(results.filter(row => row.phase === 'validation').map(row => row.taskKey)).toHaveLength(2);
    const held = JSON.parse(job.inputJson).validation[0];
    const diagnosisPrompt = calls[0].prompt!;
    expect(diagnosisPrompt).toContain('targetRevision:string');
    expect(diagnosisPrompt).toContain('sessionId:string,messageId:string,quote:string');
    expect(diagnosisPrompt).toContain('outputIncludes:string[],outputExcludes:string[]');
    expect(diagnosisPrompt).toContain('2 to 6 distinct realistic task cases');
    const generation = calls.find((call, index) => call.type === 'generator' && index > 0)!;
    expect(generation.prompt).not.toContain(held.prompt);
    expect(calls.at(-1)?.type).toBe('publish');
    expect(db.prepare('SELECT system_prompt FROM agent_configs WHERE id=?').get('evaluation-target'))
      .toEqual({ system_prompt: 'Original instruction' });
    expect(JSON.parse(result.proposals[0].provenanceJson!).evaluation.finalCandidateHash)
      .toBe(candidates.find(candidate => candidate.role === 'final')?.configHash);
  });

  it.each([{ finalScore: .25 }, { finalScore: .75 }, { mutateDuring: true }, { unknownUsage: true }])('does not queue an unproved or stale result: %j', async options => {
    const { coordinator, calls } = harness(options);
    const result = await coordinator.run({ ownerUserId: null, settings: { tokenLimit: 10000, candidateCount: 2, lookbackDays: 7 }, context: {} });
    expect(result.proposals).toEqual([]);
    expect(calls.some(call => call.type === 'publish')).toBe(false);
    expect(await new AgentOrgProposalsRepository().listByStatusAsync('proposed')).toEqual([]);
  });

  it('accepts every supported kind for diagnosis but rejects evidence-free and instruction-only tests', () => {
    expect(parseEvaluationDiagnoses(JSON.stringify({ diagnoses: [diagnosis] }))).toHaveLength(1);
    expect(() => parseEvaluationDiagnoses(JSON.stringify({ diagnoses: [{ ...diagnosis, evidence: [] }] }))).toThrow();
    expect(() => parseEvaluationDiagnoses(JSON.stringify({ diagnoses: [{ ...diagnosis, cases: [{ ...diagnosis.cases[0], outputIncludes: [] }] }] }))).toThrow();
  });
  it.each([
    { path: 'diagnoses[0].targetRevision', value: { ...diagnosis, targetRevision: 2 } },
    { path: 'diagnoses[0].evidence[0].sessionId', value: { ...diagnosis,
      evidence: [{ ...diagnosis.evidence[0], sessionId: 12 }, diagnosis.evidence[1]] } },
    { path: 'diagnoses[0].evidence[1].sessionId', value: { ...diagnosis,
      evidence: [diagnosis.evidence[0], { ...diagnosis.evidence[1], sessionId: diagnosis.evidence[0].sessionId }] } },
    { path: 'diagnoses[0].cases[0].outputExcludes', value: { ...diagnosis,
      cases: [{ key: 'secret-marker', prompt: 'private marker', outputIncludes: ['Actions'] }, diagnosis.cases[1]] } },
    { path: 'diagnoses[0].cases[0].outputIncludes', value: { ...diagnosis,
      cases: [{ ...diagnosis.cases[0], outputIncludes: [], outputExcludes: [] }, diagnosis.cases[1]] } },
    { path: 'diagnoses[0].cases[1].key', value: { ...diagnosis,
      cases: [diagnosis.cases[0], { ...diagnosis.cases[1], key: diagnosis.cases[0].key }] } },
    { path: 'diagnoses[0]', value: { ...diagnosis, secretMarker: 'private marker' } },
  ])('returns only the invalid field path $path', ({ path, value }) => {
    let message = '';
    try { parseEvaluationDiagnoses(JSON.stringify({ diagnoses: [value] })); }
    catch (error) { message = (error as Error).message; }
    expect(message).toMatch(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `));
    expect(message).not.toContain('private marker');
    expect(message).not.toContain('secret-marker');
    expect(message).not.toContain('secretMarker');
  });
  it('reports publication failure after tests as inconclusive instead of a successful review', async () => {
    const { coordinator } = harness({ publishFailure: true });
    const result = await coordinator.run({ ownerUserId: null, settings: { tokenLimit: 10000, candidateCount: 2, lookbackDays: 7 }, context: {} });
    expect(result.cycle.status).toBe('inconclusive');
    expect(result.cycle.failureReason).toContain('proposal insert failure');
    expect(result.proposals).toEqual([]);
    expect((await repository.getBudgetAsync(result.cycle.id)).outstandingTokens).toBe(0);
  });
});
