/**
 * G2 S5 D/E/F: checked result → exactly one next ordinal → checked final stop,
 * through the real service/conversation repo/coordinator/inspector/job repo
 * (see the harness for exactly what is stubbed). No UI poll participates: the
 * existing reconciliation sweep reconciles the manager and the existing
 * terminal observer (or the sweep's workflow branch) consumes the result.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import {
  SELECTED_REFERENCE_RECEIPT_BASES,
  workflowCriterionReceiptId,
  type WorkflowCriterionReceipt,
} from '../contracts/agent_workstream_contract';
import {
  admit, authority, build, closeWorld, criteria, managerFinishes, reviewText, reviewerFinishes, scope, settle,
  summaryText, workstream, world, HASH, SOURCE, VERSION, type Built, type World,
} from './helpers/coding_workflow_s5_harness';

let w: World | null = null;
afterEach(() => { if (w) closeWorld(w); w = null; });

async function sweep(h: Built) {
  await h.service.sweepFiniteConversationReconciliation();
  await settle();
}

function terminal(h: Built, jobId: string) {
  return h.service.onCoordinatorTerminal({
    ownerUserId: scope.ownerUserId, projectId: scope.projectId, workstreamId: authority(h).workstreamId,
    parentSessionId: scope.sessionId, jobId, state: 'succeeded', hostEpoch: 'g2-epoch',
  });
}

describe('G2 S5 checked result and next ordinal', () => {
  it('ordinal 1 server receipt → exactly one ordinal 2; ordinal 2 reviewed brief → completed, no ordinal 3', async () => {
    w = world();
    const h = build(w);
    expect((await admit(w, h)).planned.kind).toBe('planned');
    expect(h.dispatch).toHaveBeenCalledTimes(1);

    managerFinishes(w, 1);
    await sweep(h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    const [job1, job2] = h.nativeJobs();
    expect(job1.state).toBe('succeeded');
    expect(JSON.parse(job1.native_usage_json!)).toMatchObject({ status: 'actual', coveredSessionCount: 1 });
    const app1 = JSON.parse(job1.native_application_json!);
    expect(app1).toMatchObject({
      status: 'applied', authority: 'server_checked_selected_reference_summary_v1',
      workflowReceipts: [{ criterionId: 'selected_reference_current', bases: ['server_resolved_source'], observedHash: HASH, review: null }],
    });
    expect(criteria(h)).toEqual({ selected_reference_current: 'verified', reviewed_summary_with_citation: 'pending' });
    expect(authority(h)).toMatchObject({ consumedTurns: 2, workstreamRevision: workstream(h).revision });
    expect(JSON.parse(job2.native_metadata_json).workflow.authorization.ordinal).toBe(2);
    expect(w.objectives[1]).toContain('Step 2 of 2');

    managerFinishes(w, 2, summaryText());
    reviewerFinishes(w, 2, reviewText());
    await sweep(h);
    expect(workstream(h).state).toBe('completed');
    expect(criteria(h)).toEqual({ selected_reference_current: 'verified', reviewed_summary_with_citation: 'verified' });
    const app2 = JSON.parse(h.nativeJobs()[1].native_application_json!);
    expect(app2.workflowReceipts[0]).toMatchObject({
      criterionId: 'reviewed_summary_with_citation',
      bases: ['server_resolved_source_and_structural_checks', 'independent_model_review'],
      review: { reviewerSdkSessionId: 'sdk-reviewer-2', managerTerminalMessageId: 'asst-manager-2' },
    });
    expect(JSON.parse(h.nativeJobs()[1].native_usage_json!)).toMatchObject({ coveredSessionCount: 2 });

    // Final stops: duplicate events and sweeps create nothing.
    await terminal(h, h.nativeJobs()[1].id);
    await sweep(h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.nativeJobs()).toHaveLength(2);
  });

  it('model "done" is not a checked result: a changed source holds with no criterion and no next ordinal', async () => {
    w = world();
    const h = build(w);
    await admit(w, h);
    managerFinishes(w, 1, 'All done! Both deliverables are complete.');
    w.sourceHash.value = 'c'.repeat(64);
    await sweep(h);
    expect(h.nativeJobs()[0].state).toBe('succeeded');
    expect(JSON.parse(h.nativeJobs()[0].native_application_json!).status).toBe('quarantined');
    expect(criteria(h)).toEqual({ selected_reference_current: 'pending', reviewed_summary_with_citation: 'pending' });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(authority(h).consumedTurns).toBe(1);
  });

  it('the repository never resolves a workflow criterion without the exact server receipt', async () => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);
    managerFinishes(w, 1);
    await h.service.sweepFiniteConversationReconciliation(); // manager reconciled; observer absent
    const job = h.nativeJobs()[0];
    expect(job.state).toBe('succeeded');
    const ws = workstream(h);
    const receipt: WorkflowCriterionReceipt = {
      schemaVersion: 1, kind: 'selected_reference_summary_v1', criterionId: 'selected_reference_current',
      bases: SELECTED_REFERENCE_RECEIPT_BASES.selected_reference_current, sourceId: SOURCE, canonicalId: 'canon-1',
      observedVersion: VERSION, observedHash: HASH, sourceInstance: 'b'.repeat(64), review: null,
    };
    const apply = (over: Record<string, unknown>) => new AgentBridgeJobsRepository(w!.db).applyCoordinatorCriteria({
      localUserId: scope.ownerUserId, projectId: scope.projectId, workstreamId: ws.id, jobId: job.id,
      expectedRevision: ws.revision, currentEpoch: 'g2-epoch',
      criteria: [{ criterionId: 'selected_reference_current', criterionStatus: 'verified', receiptId: workflowCriterionReceiptId(receipt) }],
      application: {}, now: new Date().toISOString(), ...over,
    }).outcome;
    expect(apply({})).toBe('criterion_unavailable'); // a model "done" with no server receipt
    expect(apply({ workflowReceipts: [{ ...receipt, bases: ['independent_model_review'] }] })).toBe('criterion_unavailable');
    expect(apply({ workflowReceipts: [{ ...receipt, observedVersion: 'v6' }] })).toBe('criterion_unavailable');
    expect(apply({
      criteria: [{ criterionId: 'reviewed_summary_with_citation', criterionStatus: 'verified', receiptId: 'x' }],
      workflowReceipts: [{ ...receipt, criterionId: 'reviewed_summary_with_citation' }],
    })).toBe('criterion_unavailable'); // out of order
    expect(criteria(h)).toEqual({ selected_reference_current: 'pending', reviewed_summary_with_citation: 'pending' });
    expect(apply({ workflowReceipts: [receipt] })).toBe('applied');
  });

  it('concurrent observer events, sweeps and a reconstructed service still consume exactly one next ordinal', async () => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);
    managerFinishes(w, 1);
    await h.service.sweepFiniteConversationReconciliation();
    const jobId = h.nativeJobs()[0].id;
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const reconstructed = build(w, { observe: false });
    await Promise.all([
      terminal(h, jobId), terminal(h, jobId), h.service.sweepFiniteConversationReconciliation(),
      terminal(reconstructed, jobId), reconstructed.service.sweepFiniteConversationReconciliation(),
    ]);
    await settle();
    expect(h.dispatch.mock.calls.length + reconstructed.dispatch.mock.calls.length).toBe(2);
    expect(h.nativeJobs()).toHaveLength(2);
    expect(authority(h).consumedTurns).toBe(2);
  });

  it('a missed observer event is recovered by the sweep workflow branch exactly once', async () => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);
    managerFinishes(w, 1);
    await h.service.sweepFiniteConversationReconciliation(); // reconciles; no observer
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const reconstructed = build(w, { observe: false });
    await reconstructed.service.sweepFiniteConversationReconciliation();
    await reconstructed.service.sweepFiniteConversationReconciliation();
    expect(reconstructed.dispatch).toHaveBeenCalledTimes(1);
    expect(h.nativeJobs()).toHaveLength(2);
  });

  it('unknown delivery: a reconstructed service re-reads only and never re-dispatches', async () => {
    w = world();
    w.delivery.value = 'unknown';
    const h = build(w);
    expect((await admit(w, h)).planned.kind).not.toBe('planned');
    expect(h.nativeJobs()[0].state).toBe('unknown');
    managerFinishes(w, 1);
    const reconstructed = build(w);
    await sweep(reconstructed);
    await terminal(reconstructed, h.nativeJobs()[0].id);
    await settle();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(reconstructed.dispatch).not.toHaveBeenCalled();
    expect(h.nativeJobs()).toHaveLength(1);
    expect(authority(h).consumedTurns).toBe(1);
  });

  it.each([
    ['paused', (h: Built) => h.workstreams.pause(scope.ownerUserId, scope.projectId, workstream(h).id, workstream(h).revision)],
    ['cancelled', (h: Built) => h.workstreams.cancel(scope.ownerUserId, scope.projectId, workstream(h).id, workstream(h).revision)],
    ['expired', (_h: Built, world: World) => { world.clock.value = new Date(world.clock.value.valueOf() + 3_600_000); }],
  ] as const)('%s after the manager finishes: no criterion, no next ordinal', async (_name, act) => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);
    managerFinishes(w, 1);
    await h.service.sweepFiniteConversationReconciliation();
    expect(h.nativeJobs()[0].state).toBe('succeeded');
    act(h, w);
    await terminal(h, h.nativeJobs()[0].id);
    await sweep(h);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(authority(h).consumedTurns).toBe(1);
    expect(criteria(h).selected_reference_current).toBe('pending');
  });

  it('cap: a one-ordinal grant records the checked intermediate result but reserves nothing', async () => {
    w = world();
    const h = build(w);
    await admit(w, h, { maxTurns: 1 });
    managerFinishes(w, 1);
    await sweep(h);
    expect(criteria(h).selected_reference_current).toBe('verified');
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(authority(h)).toMatchObject({ consumedTurns: 1, maxTurns: 1 });
  });

  it.each([
    ['reviewer fails', () => reviewText({ verdict: 'fail' })],
    ['review digests another brief', () => reviewText({}, 'some other text')],
    ['citation differs', () => reviewText({}, 'A brief with no citation.')],
  ] as const)('ordinal 2 holds when %s: no completion, no ordinal 3', async (name, review) => {
    // (the citation case: the reviewer approves the exact citation-less brief;
    // only the server's deterministic citation check can hold it)
    w = world();
    const h = build(w);
    await admit(w, h);
    managerFinishes(w, 1);
    await sweep(h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    managerFinishes(w, 2, name === 'citation differs' ? summaryText('A brief with no citation.') : summaryText());
    reviewerFinishes(w, 2, review());
    await sweep(h);
    expect(workstream(h).state).not.toBe('completed');
    expect(criteria(h).reviewed_summary_with_citation).toBe('pending');
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it('ordinal 2 with no enrolled reviewer holds (a valid brief alone never completes)', async () => {
    w = world();
    const h = build(w);
    await admit(w, h);
    managerFinishes(w, 1);
    await sweep(h);
    managerFinishes(w, 2, summaryText());
    await sweep(h);
    expect(criteria(h).reviewed_summary_with_citation).toBe('pending');
    expect(workstream(h).state).not.toBe('completed');
  });

  it('an open charged callback turn keeps the job running; once closed it is charged and the result advances', async () => {
    w = world();
    const h = build(w);
    await admit(w, h);
    const job = h.nativeJobs()[0];
    // The bound manager's completion callback was prepared (S4 hook) and its
    // root turn is still open when the manager goes idle.
    new AgentBridgeJobsRepository(w.db).recordCoordinatorWorkflowCallbackAnchor({
      delegationId: 'delegation-1', dispatchId: 'cb-dispatch', sdkUserMessageId: 'cb-anchor', now: new Date().toISOString(),
    });
    w.dispatches.set('cb-dispatch', {
      id: 'cb-dispatch', sessionId: scope.sessionId, sdkSessionId: 'sdk-root', sdkUserMessageId: 'cb-anchor', outcome: 'accepted',
    });
    const open = { info: { id: 'cb-asst', role: 'assistant', parentID: 'cb-anchor', finish: 'tool-calls', time: { completed: 5 },
      cost: 0, tokens: { input: 3, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] };
    w.pages.set('sdk-root', [{ info: { id: 'cb-anchor', role: 'user' }, parts: [] }, open]);
    managerFinishes(w, 1);
    await sweep(h);
    expect(h.nativeJobs()[0]).toMatchObject({ id: job.id, state: 'running' });
    expect(h.dispatch).toHaveBeenCalledTimes(1);

    w.pages.set('sdk-root', [{ info: { id: 'cb-anchor', role: 'user' }, parts: [] }, open,
      { info: { ...open.info, id: 'cb-asst-2', finish: 'stop' }, parts: [] }]);
    await sweep(h);
    expect(h.nativeJobs()[0].state).toBe('succeeded');
    // manager (15) + both charged callback steps (4 + 4), one covered root session.
    expect(JSON.parse(h.nativeJobs()[0].native_usage_json!)).toMatchObject({ totalTokens: 23, coveredSessionCount: 2 });
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });
});
