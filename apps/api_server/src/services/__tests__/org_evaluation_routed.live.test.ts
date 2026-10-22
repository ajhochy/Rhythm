/** Draft for apps/api_server/src/services/__tests__/org_evaluation_routed.live.test.ts.
 * Requires compiled API service, pinned fork binary, selected provider fixture
 * authority and RHYTHM_ORG_EVALUATION_ROUTED_LIVE=1. Never runs by default.
 */
import Database from 'better-sqlite3';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OrgEvaluationTargetSnapshot, FrozenEvaluationRecipe, FrozenEvaluationSchedule } from '../org_evaluation_fixture';
import type { OrgEvaluationCandidate, OrgEvaluationProposalKind } from '../../models/org_evaluation';
import { loadPackagedOrgEvaluationAuthorityAsync } from './org_evaluation_packaged_live_authority';

const enabled = process.env.RHYTHM_ORG_EVALUATION_ROUTED_LIVE === '1';
const model = { providerID: 'anthropic' as const, modelID: 'claude-sonnet-4-5' };
const proposal = { title: 'Owned routed evaluation', rationale: 'Private engine route proof', securityNote: 'Synthetic loopback only' };
const profile = { id: 'routed-profile', label: 'Owned routed profile', systemPrompt: 'Follow the selected task instructions exactly.',
  revision: 1, allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{}',
  allowedDelegatesJson: '[]', isManager: false, modelProvider: model.providerID, modelId: model.modelID };
const recipe = (stepsJson: string): FrozenEvaluationRecipe => ({ id: 'owned-recipe', title: 'Owned recipe',
  description: null, stepsJson, boundConfigId: profile.id, schemaVersion: 1, definitionJson: null });
const schedule = (prompt: string): FrozenEvaluationSchedule => ({ id: 'owned-task', name: 'Owned task',
  description: null, prompt, agentKind: 'opencode', agentConfigId: profile.id, modelProvider: null, modelId: null,
  enabled: true, scheduleType: 'once', scheduledTime: null, scheduledDay: null,
  timezone: 'America/Los_Angeles', cronExpression: null,
  // This test proves prompt routing only. It does not claim timing semantics.
  runAt: '2099-01-01T00:00:00.000Z', allowedMcpsJson: '[]', allowedSkillsJson: '[]' });
const snapshot = (kind: OrgEvaluationProposalKind, targetRef: string, recipes: FrozenEvaluationRecipe[] = [],
  schedules: FrozenEvaluationSchedule[] = []): OrgEvaluationTargetSnapshot => ({ schemaVersion: 1,
  kind, targetRef, targetRevision: kind === 'create-recipe' || kind === 'webhook-wiring' ? 'absent' : '1',
  effectiveModel: { ...model, source: 'profile' }, profiles: [profile], skills: [],
  recipes, schedules, managedSkillFiles: [] });

type Runtime = import('../org_evaluation_coordinator').OrgEvaluationRuntimePort;
type Scenario = { kind: OrgEvaluationProposalKind; targetRef: string; original: OrgEvaluationTargetSnapshot;
  change: Record<string, unknown>; requiredEffects: string[]; baselineAbsent: boolean };

async function runScenario(input: Scenario): Promise<void> {
  const authority = await loadPackagedOrgEvaluationAuthorityAsync();
  const apiRoot = join(dirname(authority.engineBinary), '../api_server');
  const { SQLITE_ORG_EVALUATION_SCHEMA } = require(join(apiRoot,
    'dist/database/org_evaluation_schema.js')) as typeof import('../../database/org_evaluation_schema');
  const { OrgEvaluationRepository } = require(join(apiRoot,
    'dist/repositories/org_evaluation_repository.js')) as typeof import('../../repositories/org_evaluation_repository');
  const ownedRoot = mkdtempSync('/private/tmp/rhythm-routed-live-');
  const db = new Database(':memory:');
  db.exec(SQLITE_ORG_EVALUATION_SCHEMA);
  const repository = new OrgEvaluationRepository(db);
  const jobId = 'routed-root';
  await repository.createJobAsync({ id: jobId, sourceAuditRunId: null, ownerUserId: null,
    maxTokens: 20_000, validationReserveTokens: 0, originalHash: 'synthetic-original',
    targetRef: input.targetRef, targetRevision: input.original.targetRevision, inputJson: '{}' });
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  const server = createServer(app);
  try {
    await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Private relay did not bind');
    const relay = new authority.OrgEvaluationProviderRelay({ repository,
      baseURL: `http://127.0.0.1:${address.port}/agent-org-proposals/evaluations/provider`,
      resolveUpstream: async (modelId) => {
        authority.assertCurrentLoan();
        return authority.resolveConfiguredEvaluationUpstream(modelId);
      } });
    app.post('/agent-org-proposals/evaluations/provider/:leaseId/v1/messages',
      (request, response, next) => { void relay.handle(request, response, next); });
    const runtime: Runtime = authority.createOrgEvaluationRuntimeAdapter({
      engineBinary: authority.engineBinary,
      workerBaseRoot: ownedRoot, model,
      createLease: (request) => relay.createLease(request),
      finishLease: (leaseId) => relay.finishLease(leaseId),
      getObservedToolCatalog: (leaseId) => relay.getObservedToolCatalog(leaseId),
      enginePort: () => randomInt(50000, 59000), wallMs: 120_000,
    });
    const task = { key: 'routed-output', prompt: 'Execute the selected recipe, task, or webhook route and report its result.',
      outputIncludes: ['ROUTED_OK'], outputExcludes: ['BEFORE'] };
    const runArm = async (role: 'original' | 'variant', changeJson: string, stage: 'original-probe' | 'candidate-probe') => {
      const prepared = await runtime.prepare({ snapshot: input.original, kind: input.kind,
        targetRef: input.targetRef, changeJson, role, proposal });
      const candidate: OrgEvaluationCandidate = { id: `${role}-routed`, jobId, role,
        ordinal: role === 'original' ? 0 : 1, kind: input.kind, targetRef: input.targetRef,
        configHash: prepared.manifestHash, effectiveConfigJson: prepared.manifestJson,
        changeJson, parentCandidateIds: [], createdAt: new Date().toISOString() };
      const result = await runtime.execute({ jobId, candidate, snapshot: input.original, task,
        phase: 'probe', stage, proposal });
      const receipt = JSON.parse(result.receiptJson) as { sessionId: string; outputText: string; outputHash: string;
        effectProof: { events: Array<{ kind: string; source: string; subject: string; evidenceHash: string }>;
          negativeGuardsPassed: boolean } };
      expect(result.status, result.failureReason ?? '').toBe('pass');
      expect(result.tokenUsage?.totalTokens).toBeGreaterThan(0);
      expect(receipt.effectProof.negativeGuardsPassed).toBe(true);
      expect(receipt.sessionId).toBeTruthy();
      expect(receipt.outputHash).toBe(createHash('sha256').update(receipt.outputText).digest('hex'));
      return { result, receipt, manifest: prepared.manifestHash };
    };
    const original = await runArm('original', '{}', 'original-probe');
    const variant = await runArm('variant', JSON.stringify(input.change), 'candidate-probe');
    expect(original.result.score).toBe(0);
    expect(variant.result.score).toBe(1);
    expect(variant.receipt.outputText).toContain('ROUTED_OK');
    expect(variant.receipt.outputText).not.toContain('BEFORE');
    expect(variant.receipt.sessionId).not.toBe(original.receipt.sessionId);
    expect(variant.manifest).not.toBe(original.manifest);
    for (const kind of input.requiredEffects) {
      expect(variant.receipt.effectProof.events.some((event) => event.kind === kind && event.evidenceHash.length === 64)).toBe(true);
    }
    const routedKind = input.kind === 'webhook-wiring' ? 'loopback-webhook-received'
      : input.kind === 'refine-task' ? 'agent-output' : 'recipe-selected';
    expect(variant.receipt.effectProof.events.some((event) =>
      event.kind === routedKind && event.subject === variant.receipt.sessionId)).toBe(true);
    if (input.baselineAbsent) {
      expect(original.receipt.effectProof.events.some((event) => event.kind === 'target-absent')).toBe(true);
      expect(original.receipt.outputText).toBe('');
    } else {
      const routedEvent = original.receipt.effectProof.events.find((event) =>
        event.kind === 'recipe-selected' || event.kind === 'scheduled-task-fired');
      expect(routedEvent).toBeTruthy();
      expect(original.receipt.outputText).toContain('BEFORE');
    }
    const budget = await repository.getBudgetAsync(jobId);
    expect(budget.settledTokens).toBeGreaterThan(0);
    expect(budget.settledTokens).toBeLessThanOrEqual(20_000);
    expect(budget.outstandingTokens).toBe(0);
    expect(budget.hasUnknownUsage).toBe(false);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    db.close();
    rmSync(ownedRoot, { recursive: true, force: true });
  }
}

describe.skipIf(!enabled)('real private-engine routed evaluation, gated', () => {
  it('creates an absent recipe and scores the selected child output', () => runScenario({
    kind: 'create-recipe', targetRef: 'recipe:Owned recipe',
    original: snapshot('create-recipe', 'recipe:Owned recipe'), baselineAbsent: true,
    change: { title: 'Owned recipe', description: 'Owned fixture',
      steps_json: '["Reply with exactly ROUTED_OK"]', boundConfigId: profile.id },
    requiredEffects: ['recipe-persisted', 'recipe-selected'],
  }), 240_000);

  it('refines an existing legacy recipe and scores both routed child outputs', () => {
    const priorStepsJson = '["Reply with exactly BEFORE"]';
    return runScenario({ kind: 'refine-recipe', targetRef: 'recipe:owned-recipe',
      original: snapshot('refine-recipe', 'recipe:owned-recipe', [recipe(priorStepsJson)]), baselineAbsent: false,
      change: { recipeId: 'owned-recipe', priorStepsJson,
        revisedStepsJson: '["Reply with exactly ROUTED_OK"]' },
      requiredEffects: ['recipe-persisted', 'recipe-selected'],
    });
  }, 240_000);

  it('refines task prompt and scores production scheduler-dispatched child output', () => runScenario({
    kind: 'refine-task', targetRef: 'scheduled_task:owned-task',
    original: snapshot('refine-task', 'scheduled_task:owned-task', [], [schedule('Reply with exactly BEFORE')]),
    baselineAbsent: false, change: { taskPatch: { scheduledTaskId: 'owned-task', field: 'prompt',
      value: 'Reply with exactly ROUTED_OK' } },
    requiredEffects: ['schedule-persisted', 'scheduled-task-fired', 'agent-output'],
  }), 240_000);

  it('rejects bad HMAC, dispatches a valid recipe webhook, and scores its child output', () => runScenario({
    kind: 'webhook-wiring', targetRef: 'webhook:Owned endpoint',
    original: snapshot('webhook-wiring', 'webhook:Owned endpoint',
      [recipe('["Reply with exactly ROUTED_OK"]')]), baselineAbsent: true,
    change: { triggerSource: 'Owned endpoint', targetRecipeId: 'owned-recipe',
      eventTypes: ['evaluation.probe'], targetPromptTemplate: 'Handle {{payload}} with the selected recipe.' },
    requiredEffects: ['webhook-persisted', 'loopback-webhook-received', 'invalid-webhook-signature-denied'],
  }), 240_000);
});
