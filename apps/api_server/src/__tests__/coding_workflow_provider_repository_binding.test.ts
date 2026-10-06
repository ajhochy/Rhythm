import { describe, expect, it } from 'vitest';
import type { CoordinatorWorkflowMembership } from '../shared_agents/delegation_jobs_repository';
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
  it('admits a fresh persisted assistant tool step on the same native user anchor', async () => {
    const f = await fixture();
    try {
      const decide = (request: typeof f.request, frame: typeof f.frame) => f.h.service.admitWorkflowProvider({ actor: auth, request, frame,
        nativeParentSessionId: request.binding.rootSdkSessionId });
      expect((await decide(f.request, f.frame)).status).toBe('allow');
      const request = { ...f.request, request: { ...f.request.request, attempt: 1, requestNonce: 'm'.repeat(32), inputDigest: 'b'.repeat(64) } };
      const frame = { ...f.frame, accounting: { ...f.frame.accounting, assistantMessageId: 'actual-assistant-2' },
        frame: { ...f.frame.frame, request: request.request, inputGroupCount: 2 } };
      const next = await decide(request, frame);
      expect(next).toMatchObject({ status: 'allow', reason: 'none' });
      expect(next.current()).toBe(true);
      const membership = JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership;
      expect(membership.map((member: Record<string, unknown>) => ({ assistant: member.assistantMessageId, attempt: member.attempt })))
        .toEqual([{ assistant: 'actual-assistant-1', attempt: 0 }, { assistant: 'actual-assistant-2', attempt: 1 }]);
      expect((await decide(request, frame)).status).toBe('allow');
      expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toHaveLength(2);
      // Attempt alone is not an accounting-step identity.
      const thirdRequest = { ...request, request: { ...request.request, requestNonce: 'q'.repeat(32) } };
      const thirdFrame = { ...frame, accounting: { ...frame.accounting, assistantMessageId: 'actual-assistant-3' },
        frame: { ...frame.frame, request: thirdRequest.request } };
      expect((await decide(thirdRequest, thirdFrame)).status).toBe('allow');
      expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toHaveLength(3);
    } finally { closeWorld(f.w); }
  });

  it('holds a changed native parent across accounting steps without replacing a member', async () => {
    const f = await fixture();
    try {
      expect((await f.h.service.admitWorkflowProvider({ actor: auth, request: f.request, frame: f.frame,
        nativeParentSessionId: f.request.binding.rootSdkSessionId })).status).toBe('allow');
      const stored = JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership[0] as CoordinatorWorkflowMembership;
      expect(() => f.h.jobs.appendCoordinatorWorkflowMembership({ localUserId: auth.user.id,
        workstreamId: f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.workstream_id!, jobId: f.job.id, now: new Date().toISOString(),
        member: { ...stored, attempt: 1, assistantMessageId: 'actual-assistant-2', parentNativeSessionId: 'foreign-parent' },
      })).toThrow('workflow_membership_conflict');
      expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toEqual([stored]);
    } finally { closeWorld(f.w); }
  });

  it('holds a purpose mutation of the same assistant attempt without adding a member', async () => {
    const f = await fixture();
    try {
      expect((await f.h.service.admitWorkflowProvider({ actor: auth, request: f.request, frame: f.frame,
        nativeParentSessionId: f.request.binding.rootSdkSessionId })).status).toBe('allow');
      const row = f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!;
      const stored = JSON.parse(row.native_metadata_json!).workflow.membership[0] as CoordinatorWorkflowMembership;
      expect(() => f.h.jobs.appendCoordinatorWorkflowMembership({ localUserId: auth.user.id,
        workstreamId: row.workstream_id!, jobId: f.job.id, now: new Date().toISOString(),
        member: { ...stored, purpose: 'compaction' },
      })).toThrow('workflow_membership_conflict');
      expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toEqual([stored]);
    } finally { closeWorld(f.w); }
  });

  it.each(['engineGeneration', 'runnerGeneration', 'requestNonce', 'inputDigest'] as const)
    ('holds a conflicting mutation of the same accounting step: %s', async key => {
      const f = await fixture();
      try {
        const decide = (request: typeof f.request, frame: typeof f.frame) => f.h.service.admitWorkflowProvider({ actor: auth, request, frame,
          nativeParentSessionId: request.binding.rootSdkSessionId });
        expect((await decide(f.request, f.frame)).status).toBe('allow');
        const request = { ...f.request, request: { ...f.request.request, [key]: key === 'inputDigest' ? 'b'.repeat(64) : 'changed'.repeat(5) } };
        const frame = { ...f.frame, frame: { ...f.frame.frame, request: request.request } };
        expect((await decide(request, frame)).status).toBe('hold');
        expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toHaveLength(1);
      } finally { closeWorld(f.w); }
    });

  it.each(['engineGeneration', 'runnerGeneration'] as const)
    ('holds a fresh assistant step with changed %s', async key => {
      const f = await fixture();
      try {
        const decide = (request: typeof f.request, frame: typeof f.frame) => f.h.service.admitWorkflowProvider({ actor: auth, request, frame,
          nativeParentSessionId: request.binding.rootSdkSessionId });
        expect((await decide(f.request, f.frame)).status).toBe('allow');
        const request = { ...f.request, request: { ...f.request.request, attempt: 1, [key]: 'changed-generation' } };
        const frame = { ...f.frame, accounting: { ...f.frame.accounting, assistantMessageId: 'actual-assistant-2' },
          frame: { ...f.frame.frame, request: request.request } };
        expect((await decide(request, frame)).status).toBe('hold');
        expect(JSON.parse(f.h.jobs.findCoordinatorWorkflowJob(f.job.id)!.native_metadata_json!).workflow.membership).toHaveLength(1);
      } finally { closeWorld(f.w); }
    });

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
