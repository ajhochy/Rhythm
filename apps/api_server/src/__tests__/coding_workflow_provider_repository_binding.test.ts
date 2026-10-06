import { describe, expect, it } from 'vitest';
import { admit, auth, build, closeWorld, HASH, world } from './helpers/coding_workflow_s5_harness';

// Uses the actual SQLite repository methods, without prebound function mocks.
// Engine/resolver edges remain S5 unit fixtures; the separate opt-in test is live.
async function fixture() {
  const w = world();
  const h = build(w);
  const admission = await admit(w, h);
  if (admission.planned.kind !== 'planned') throw Error(admission.planned.kind);
  const job = h.nativeJobs()[0];
  const metadata = JSON.parse(job.native_metadata_json);
  const binding = metadata.workflow.prepared.workflowBinding;
  const nativeRequest = {
    schemaVersion: 1 as const, sdkSessionId: binding.managerSdkSessionId,
    userMessageId: metadata.workflow.prepared.dispatch.sdkUserMessageId, requestNonce: 'n'.repeat(32),
    engineGeneration: 'engine-g1', runnerGeneration: 'runner-g1', attempt: 0,
    purpose: 'answer' as const, inputDigest: HASH,
  };
  const request = { schemaVersion: 2 as const, kind: 'coordinator_workflow_provider' as const,
    binding, scope: { kind: 'manager_lineage' as const }, request: nativeRequest };
  const frame = { schemaVersion: 2 as const, kind: 'coordinator_workflow_provider_frame' as const,
    binding, scope: request.scope, nativeLineageDigest: HASH,
    accounting: { kind: 'persisted_assistant' as const, assistantMessageId: 'actual-assistant-1', parentMessageId: nativeRequest.userMessageId },
    frame: { schemaVersion: 1 as const, status: 'pending' as const, request: nativeRequest,
      agentName: 'workflow-orchestrator', userKind: 'authored' as const, initiatingUserMessageId: null,
      inputGroupCount: 1, originCoverage: 'complete' as const, sourceProofs: [] },
  };
  return { w, h, job, request, frame };
}

describe('Coding Workflow provider gate retains real repository receivers', () => {
  it('persists exact membership before returning an allow and current proof', async () => {
    const f = await fixture();
    try {
      const verdict = await f.h.service.admitWorkflowProvider({ actor: auth, request: f.request, frame: f.frame,
        nativeParentSessionId: f.request.binding.rootSdkSessionId });
      expect(verdict).toMatchObject({ status: 'allow', reason: 'none' });
      expect(verdict.current()).toBe(true);
      expect(f.h.jobs.hasCoordinatorWorkflowMember(f.job.id, f.request.request.sdkSessionId, f.request.request.userMessageId)).toBe(true);
      expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toHaveLength(1);
    } finally { closeWorld(f.w); }
  });

  it('a changed parent binding still holds and persists no membership', async () => {
    const f = await fixture();
    try {
      const verdict = await f.h.service.admitWorkflowProvider({ actor: auth, request: f.request, frame: f.frame,
        nativeParentSessionId: 'unrelated-native-parent' });
      expect(verdict).toMatchObject({ status: 'hold', reason: 'membership_unavailable' });
      expect(verdict.current()).toBe(false);
      expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toEqual([]);
    } finally { closeWorld(f.w); }
  });
  it('an unavailable repository port still holds without throwing or adding membership', async () => {
    const f = await fixture();
    try {
      Object.defineProperty(f.h.jobs, 'findCoordinatorWorkflowJob', { value: undefined });
      const verdict = await f.h.service.admitWorkflowProvider({ actor: auth, request: f.request, frame: f.frame,
        nativeParentSessionId: f.request.binding.rootSdkSessionId });
      expect(verdict).toMatchObject({ status: 'hold', reason: 'authority_unavailable' });
      expect(verdict.current()).toBe(false);
      expect(JSON.parse(f.h.nativeJobs()[0].native_metadata_json).workflow.membership).toEqual([]);
    } finally { closeWorld(f.w); }
  });

});
