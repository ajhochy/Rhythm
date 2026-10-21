import { randomInt } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { OrgEvaluationRepository } from '../repositories/org_evaluation_repository';
import { asOpenCodeAgentId, asRhythmProfileId } from '../models/agent_session';
import type { AgentRunOptions, AgentRunResult } from './agent_runner';
import { OrgEvaluationCoordinator } from './org_evaluation_coordinator';
import type { OrgEvaluationStage } from '../models/org_evaluation';
import { captureOrgEvaluationTargetAsync } from './org_evaluation_fixture';
import { getOrgEvaluationProviderRelay } from './org_evaluation_provider_relay';
import { getOrgEvaluationSettingsAsync } from './org_evaluation_settings';
import { OrgReviewerService } from './org_reviewer_service';
import { ORG_REVIEWER_PROFILE_ID } from './org_reviewer_seed';
import { recordTerminalOutcome } from './run_outcome_service';
import { resolveEvaluationEngineBinary } from './org_evaluation_engine_binary';

let activeReviewerRun = false;

/** Exact-profile AgentRunner branch. A real Rhythm background session records
 * this work, but the unbounded OpenCode parent turn is never started. */
export async function runOrgEvaluationReview(opts: AgentRunOptions): Promise<AgentRunResult> {
  if (activeReviewerRun) return { sessionId: '', result: '', status: 'error',
    error: 'A bounded Org Reviewer evaluation is already running', errorCode: 'capacity' };
  activeReviewerRun = true;
  const sessions = new AgentSessionsRepository();
  const reviewer = new OrgReviewerService();
  const ownerUserId = opts.ownerUserId ?? null;
  let session: ReturnType<AgentSessionsRepository['insert']>;
  try { session = sessions.insert({
    agentKind: 'codex', profileId: asRhythmProfileId(ORG_REVIEWER_PROFILE_ID),
    opencodeAgentId: asOpenCodeAgentId(ORG_REVIEWER_PROFILE_ID),
    taskId: null, taskTitle: opts.taskTitle ?? null, cwd: opts.cwd ?? process.cwd(),
    name: opts.sessionName ?? 'Org Reviewer evaluation',
    scheduledTaskId: opts.scheduledTaskId ?? null, ownerUserId,
    mcpAllowedToolsJson: '{}', permissionMode: 'default',
    category: 'self_improvement', isSystem: true,
  }); } catch (error) { activeReviewerRun = false; throw error; }
  let workerBaseRoot: string | null = null;
  try {
    sessions.updateStatus(session.id, 'working');
    await opts.onSessionCreated?.(session.id);
    reviewer.assertServerEvaluationProfile();
    await reviewer.assertServerEvaluationTask(opts.scheduledTaskId, ownerUserId);
    const pending = (await new OrgEvaluationRepository().listJobsAsync())
      .some((job) => job.budgetRootId === null && ['planning', 'exploring', 'validating'].includes(job.status));
    if (pending) throw new Error('A prior reviewer evaluation cycle remains active; reconcile it before another run');
    const profile = new AgentConfigsRepository().getById(ORG_REVIEWER_PROFILE_ID);
    // Evaluation uses a transport with a proven output ceiling. The ordinary
    // reviewer profile may still name an older unqualified provider/model.
    // Record the explicit evaluation route rather than changing that profile.
    const modelID = profile?.modelProvider === 'anthropic' && profile.modelId?.startsWith('claude-')
      ? profile.modelId : 'claude-sonnet-4-5';
    const settings = await getOrgEvaluationSettingsAsync();
    const context = await reviewer.evaluationContext(ownerUserId);
    context.evaluationModel = { providerID: 'anthropic', modelID };
    const { listOrgEvaluationToolArtifacts } = await import('./org_evaluation_tool_inputs');
    const availableToolArtifacts = listOrgEvaluationToolArtifacts();
    if (availableToolArtifacts.length && Array.isArray(context.batches)) {
      const batches = context.batches as Array<Record<string, unknown>>;
      for (const batch of [...batches]) {
        const augmented = { ...batch, availableToolArtifacts };
        if (Buffer.byteLength(JSON.stringify(augmented)) <= 24_000) {
          batch.availableToolArtifacts = availableToolArtifacts;
          continue;
        }
        const toolBatch = { sessionEvidence: batch.sessionEvidence, profiles: batch.profiles,
          availableToolArtifacts, omission: 'Only approved digest-pinned local tarballs are available for tool installation' };
        if (Buffer.byteLength(JSON.stringify(toolBatch)) > 24_000)
          throw new Error('Approved tool artifact inventory cannot fit beside complete cited evidence');
        batches.push(toolBatch);
      }
    }
    const relay = getOrgEvaluationProviderRelay();
    const engineBinary = resolveEvaluationEngineBinary();
    workerBaseRoot = mkdtempSync(join(tmpdir(), 'rhythm-org-evaluation-'));
    const { createOrgEvaluationRuntimeAdapter } = await import('./org_evaluation_runtime');
    const runtime = createOrgEvaluationRuntimeAdapter({
      engineBinary, workerBaseRoot,
      model: { providerID: 'anthropic', modelID },
      createLease: ({ jobId, stage, model, maxCalls }: {
        jobId: string; stage: OrgEvaluationStage; model: string; maxCalls: number;
      }) => relay.createLease({ jobId, stage, model, maxCalls }),
      getObservedToolCatalog: (leaseId: string) => relay.getObservedToolCatalog(leaseId),
      finishLease: (leaseId: string) => relay.finishLease(leaseId),
      enginePort: () => randomInt(45000, 60000),
      wallMs: 120_000,
    });
    const coordinator = new OrgEvaluationCoordinator({
      repository: new OrgEvaluationRepository(), runtime,
      model: async ({ jobId, stage, prompt }) => (await relay.runBoundedText({
        jobId, stage, model: modelID, prompt,
      })).text,
      capture: async (diagnosis, owner) => captureOrgEvaluationTargetAsync({ kind: diagnosis.kind,
        targetRef: diagnosis.targetRef, expectedRevision: diagnosis.targetRevision,
        ownerUserId: owner, change: diagnosis.change,
        evidenceSessionIds: diagnosis.evidence.map((item) => item.sessionId) }),
      verifyEvidence: async (diagnosis, owner) => {
        reviewer.verifyEvaluationEvidence(diagnosis.evidence, owner);
      },
    });
    const result = await coordinator.run({ ownerUserId, settings, context });
    if (result.cycle.status !== 'qualified') throw new Error(result.cycle.failureReason ?? 'Evaluation was inconclusive');
    const unproved = result.evaluations.filter(evaluation => evaluation.status !== 'qualified').length;
    const message = `Reviewed ${result.evaluations.length} improvement targets; ${result.proposals.length} test-qualified proposal(s) entered human review; ${unproved} could not be verified and kept their original configuration.`;
    sessions.updatePreview(session.id, message, new Date().toISOString());
    sessions.updateStatus(session.id, 'closed');
    void recordTerminalOutcome({ sessionId: session.id, terminalStatus: 'completed', producedArtifact: result.proposals.length > 0 });
    return { sessionId: session.id, result: message, status: 'done' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sessions.updatePreview(session.id, message.slice(0, 500), new Date().toISOString());
    sessions.updateStatus(session.id, 'error');
    void recordTerminalOutcome({ sessionId: session.id, terminalStatus: 'error', producedArtifact: false });
    return { sessionId: session.id, result: '', status: 'error', error: message };
  } finally {
    try {
      if (workerBaseRoot) rmSync(workerBaseRoot, { recursive: true, force: true });
    } finally { activeReviewerRun = false; }
  }
}
