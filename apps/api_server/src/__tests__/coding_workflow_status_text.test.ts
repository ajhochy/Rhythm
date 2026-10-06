/**
 * G2 S5-G/H: every workflow hold/terminal appears in the existing
 * model-facing coordinator status text with an honest state, and admission is
 * pinned to the CURRENT project authorization (not mere catalog presence).
 * Same real service/repos/coordinator harness as the checked-result tests.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  admit, auth, authority, build, closeWorld, criteria, managerErrors, managerFinishes, reviewText, reviewerFinishes, scope,
  settle, summaryText, workstream, world, type Built, type World,
} from './helpers/coding_workflow_s5_harness';

let w: World | null = null;
afterEach(() => { if (w) closeWorld(w); w = null; });

async function statusOf(h: Built): Promise<{ state: string; text: string }> {
  const status = await h.service.modelStatus(auth, {
    sessionId: scope.sessionId, projectId: scope.projectId, sdkSessionId: 'sdk-root', bindingCurrent: async () => true,
  });
  if (status.kind !== 'available') throw new Error('status unavailable');
  const body = JSON.parse(status.text.slice(status.text.indexOf('{')));
  const finite = body.finite ?? [];
  expect(finite).toHaveLength(1);
  return finite[0].workflow;
}

async function statusTextOf(h: Built): Promise<string> {
  const status = await h.service.modelStatus(auth, {
    sessionId: scope.sessionId, projectId: scope.projectId, sdkSessionId: 'sdk-root', bindingCurrent: async () => true,
  });
  if (status.kind !== 'available') throw new Error('status unavailable');
  return status.text;
}

function statusPayload(text: string): { state: string; finite: Array<{ workflow: { state: string; text: string } }> } {
  return JSON.parse(text.slice(text.indexOf('{')));
}

function claimsCriterionVerified(text: string, criterionId: string): boolean {
  const escaped = criterionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:${escaped}[^\\n.]{0,96}\\bverified\\b|\\bverified\\b[^\\n.]{0,96}${escaped})`, 'i').test(text);
}

async function sweep(h: Built) {
  await h.service.sweepFiniteConversationReconciliation();
  await settle();
}

describe('G2 S5-G workflow state in the coordinator status text', () => {
  it('C5-SIGNED-CHECKED-STATUS-1: exposes only the two server-checked criteria and the exact 2-of-2 stop', async () => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);

    const runningText = await statusTextOf(h);
    const running = statusPayload(runningText).finite[0].workflow;
    expect(running.state).toBe('running');
    expect(running.text).toMatch(/unverified/i);
    expect(claimsCriterionVerified(running.text, 'selected_reference_current')).toBe(false);
    expect(claimsCriterionVerified(running.text, 'reviewed_summary_with_citation')).toBe(false);

    managerFinishes(w, 1, 'The note is current and the brief is done.');
    await h.service.sweepFiniteConversationReconciliation();
    const proseOnly = await statusOf(h);
    expect(proseOnly.state).toBe('awaiting_check');
    expect(criteria(h)).toEqual({ selected_reference_current: 'pending', reviewed_summary_with_citation: 'pending' });
    expect(claimsCriterionVerified(proseOnly.text, 'selected_reference_current')).toBe(false);
    expect(claimsCriterionVerified(proseOnly.text, 'reviewed_summary_with_citation')).toBe(false);

    await sweep(h);
    managerFinishes(w, 2, summaryText());
    reviewerFinishes(w, 2, reviewText());
    await sweep(h);
    await sweep(h);
    expect(workstream(h).state).toBe('completed');
    expect(criteria(h)).toEqual({ selected_reference_current: 'verified', reviewed_summary_with_citation: 'verified' });
    const receipts = workstream(h).checkpoint.criteria.map((criterion) => criterion.receiptId);
    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt) => typeof receipt === 'string' && receipt.length > 0)).toBe(true);
    expect(new Set(receipts).size).toBe(2);

    const completedText = await statusTextOf(h);
    const payload = statusPayload(completedText);
    expect(Buffer.byteLength(completedText, 'utf8')).toBeLessThanOrEqual(3_800);
    expect(payload.state).toBe('authoritative_current_projection');
    expect(payload.finite).toHaveLength(1);
    const completed = payload.finite[0].workflow;
    expect.soft(completed.state).toBe('completed');
    expect.soft(completed.text).toContain('ordinal 2 of 2');
    expect.soft(completed.text).toMatch(/server[- ]check|server verified/i);
    expect.soft(claimsCriterionVerified(completed.text, 'selected_reference_current')).toBe(true);
    expect.soft(claimsCriterionVerified(completed.text, 'reviewed_summary_with_citation')).toBe(true);
    expect.soft(completed.text).not.toMatch(/ordinal 3 of/i);

    w.clock.value = new Date(w.clock.value.valueOf() + 65_000);
    await sweep(h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.nativeJobs()).toHaveLength(2);
    expect(workstream(h).state).toBe('completed');
  });

  it('C5-SIGNED-CHECKED-STATUS-2: a completed row with revised pending criteria is not reported as verified completion', async () => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);
    managerFinishes(w, 1);
    await h.service.sweepFiniteConversationReconciliation();
    await sweep(h);
    managerFinishes(w, 2, summaryText());
    reviewerFinishes(w, 2, reviewText());
    await sweep(h);
    await sweep(h);
    expect(workstream(h).state).toBe('completed');
    expect(criteria(h)).toEqual({ selected_reference_current: 'verified', reviewed_summary_with_citation: 'verified' });

    const before = workstream(h);
    const revised = h.workstreams.revise(scope.ownerUserId, scope.projectId, before.id, before.revision, {
      checkpoint: {
        ...before.checkpoint,
        criteria: before.checkpoint.criteria.map(({ id }) => ({ id, status: 'pending' as const })),
      },
    });
    expect(revised?.state).toBe('completed');
    expect(revised?.checkpoint.criteria).toEqual([
      { id: 'selected_reference_current', status: 'pending' },
      { id: 'reviewed_summary_with_citation', status: 'pending' },
    ]);

    const current = await statusOf(h);
    expect.soft(current.state).not.toBe('completed');
    expect.soft(current.state).toMatch(/unverified|unavailable|held/i);
    expect.soft(current.text).toMatch(/unverified|not verified|could not be proved|held/i);
    expect.soft(current.text).not.toMatch(/source is server-verified current/i);
    expect.soft(current.text).not.toMatch(/passed server citation checks plus independent verification-gate review/i);
    expect.soft(claimsCriterionVerified(current.text, 'selected_reference_current')).toBe(false);
    expect.soft(claimsCriterionVerified(current.text, 'reviewed_summary_with_citation')).toBe(false);
  });

  it('running → awaiting_check (model "done" is not done) → completed', async () => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);
    expect(await statusOf(h)).toEqual({ state: 'running', text: 'Running ordinal 1 of 2; manager output is unverified until the server checks it.' });
    managerFinishes(w, 1, 'Done!');
    await h.service.sweepFiniteConversationReconciliation();
    const awaiting = await statusOf(h);
    expect(awaiting.state).toBe('awaiting_check');
    expect(awaiting.text).toContain('a model "done" completes nothing');
    await sweep(h); // checked → ordinal 2
    managerFinishes(w, 2, summaryText());
    reviewerFinishes(w, 2, reviewText());
    await sweep(h);
    await sweep(h);
    expect(workstream(h).state).toBe('completed');
    expect((await statusOf(h)).state).toBe('completed');
  });

  it.each([
    ['paused', (h: Built) => { h.workstreams.pause(scope.ownerUserId, scope.projectId, workstream(h).id, workstream(h).revision); }],
    ['cancelled', (h: Built) => { h.workstreams.cancel(scope.ownerUserId, scope.projectId, workstream(h).id, workstream(h).revision); }],
    ['expired', (_h: Built, world: World) => { world.clock.value = new Date(world.clock.value.valueOf() + 3_600_000); }],
  ] as const)('%s', async (state, act) => {
    w = world();
    const h = build(w, { observe: false });
    await admit(w, h);
    managerFinishes(w, 1);
    await h.service.sweepFiniteConversationReconciliation();
    act(h, w);
    if (state === 'expired') {
      // Expiry is also a model-status eligibility change; read the mapping directly.
      const found = h.repository.get(scope);
      if (found.kind !== 'found') throw new Error('conversation missing');
      expect(h.service.workflowStatus(found.conversation, authority(h))).toMatchObject({ state: 'expired' });
      return;
    }
    const status = await statusOf(h);
    expect(status?.state).toBe(state);
    expect(status?.text).toMatch(/nothing runs|no further ordinal/);
  });

  it('refused before exposure', async () => {
    w = world();
    w.delivery.value = 'rejected';
    const h = build(w);
    expect((await admit(w, h)).planned.kind).not.toBe('planned');
    expect(await statusOf(h)).toMatchObject({ state: 'refused' });
  });

  it('planning_dispatch_hold when the adapter refuses before preparing', async () => {
    w = world();
    w.delivery.value = 'refused_before_prepare';
    const h = build(w);
    expect((await admit(w, h)).planned.kind).toBe('planning_dispatch_hold');
    expect(await statusOf(h)).toMatchObject({ state: 'planning_dispatch_hold' });
  });

  it('unknown delivery', async () => {
    w = world();
    w.delivery.value = 'unknown';
    const h = build(w);
    await admit(w, h);
    expect(await statusOf(h)).toMatchObject({ state: 'unknown', text: expect.stringContaining('never retried or treated as done') });
  });

  it('failed manager run', async () => {
    w = world();
    const h = build(w);
    await admit(w, h);
    managerErrors(w, 1);
    await sweep(h);
    expect(await statusOf(h)).toMatchObject({ state: 'failed' });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('membership_unavailable when the workflow membership/coverage cannot be proven', async () => {
    w = world();
    const h = build(w);
    await admit(w, h);
    managerFinishes(w, 1);
    w.delegations.delete('delegation-1'); // a known member's durable row disappeared
    await sweep(h);
    expect(await statusOf(h)).toMatchObject({ state: 'membership_unavailable' });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('G2 S5-H admission pins the CURRENT project authorization', () => {
  it.each([
    ['access revoked', (world: World) => { world.access.value = false; }],
    ['project archived', (world: World) => { world.archived.value = true; }],
  ] as const)('%s after capture: zero dispatch', async (_name, act) => {
    w = world();
    const h = build(w);
    h.repository.designatePrimaryOwnerRoot(scope);
    const captured = await h.service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'chat-goal-h', message: 'Validate the selected note and write a cited brief.',
    });
    if (captured.kind !== 'created') throw new Error('capture failed');
    act(w);
    const { admission } = await import('./helpers/coding_workflow_s5_harness');
    const result = await h.service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: captured.conversation.controlRevision, goalId: captured.goal.id,
      admission: admission() as never,
    });
    expect(result.kind).not.toBe('planned');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.nativeJobs()).toEqual([]);
  });
});
