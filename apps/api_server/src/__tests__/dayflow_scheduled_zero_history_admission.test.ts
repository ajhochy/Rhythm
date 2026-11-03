import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHarness, OWNER, PROJECT, request, type Harness } from './helpers/dayflow_provider_harness';

describe('scheduled Dayflow provider admission', () => {
  let h: Harness;

  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); vi.restoreAllMocks(); });

  function addScheduled(suffix: string, over: Record<string, unknown> = {}) {
    const sdkSessionId = `sdk:scheduled-${suffix}`;
    const userMessageId = `msg_scheduled_${suffix}`;
    h.makeSession(`scheduled:${suffix}`, {
      sdk_session_id: sdkSessionId,
      owner_user_id: null,
      project_id: null,
      scheduled_task_id: 'scheduled:task',
      is_system: 1,
      category: 'scheduled',
      ...over,
    });
    h.engine.stored = [...h.engine.stored, userMessageId];
    return { sdkSessionId, userMessageId };
  }

  it.each([
    ['owner only', { owner_user_id: null, project_id: PROJECT }],
    ['project only', { owner_user_id: OWNER, project_id: null }],
    ['owner and project', { owner_user_id: null, project_id: null }],
  ])('keeps a scheduler-shaped zero-history SDK session ordinary when %s was not recorded', async (_name, over) => {
    const { sdkSessionId, userMessageId } = addScheduled(`zero-${_name.replaceAll(' ', '-')}`, over);

    const result = await h.admit({ sdkSessionId, userMessageId });

    expect(result.body).toMatchObject({
      decision: 'ordinary',
      rawHistoryReusable: true,
      overlay: null,
      projection: null,
      reason: 'none',
    });
    expect(h.engine.enrolled.size).toBe(0);
    expect(h.resolved).toEqual([]);
  });

  it('preserves ownership refusal when an otherwise unbound scheduled row names another user', async () => {
    const foreign = addScheduled('foreign-owner', { owner_user_id: OWNER + 1, project_id: null });

    expect((await h.admit(foreign)).body).toMatchObject({
      decision: 'hold', rawHistoryReusable: false, reason: 'receiver_changed', overlay: null, projection: null,
    });
  });

  it.each([
    ['a nonpositive owner', { owner_user_id: 0, project_id: PROJECT }],
    ['an invalid present project', { owner_user_id: OWNER, project_id: 'project with spaces' }],
    ['a non-UUID scheduled task id', { scheduled_task_id: 'not a task id!' }],
    ['a non-system scheduled row', { owner_user_id: null, project_id: null, is_system: 0 }],
    ['a non-scheduled category', { owner_user_id: null, project_id: null, category: 'chat' }],
  ])('holds a scheduler lookalike with %s', async (_name, over) => {
    const { sdkSessionId, userMessageId } = addScheduled(`malformed-${_name.replaceAll(' ', '-')}`, over);

    expect((await h.admit({ sdkSessionId, userMessageId })).body).toMatchObject({
      decision: 'hold', rawHistoryReusable: false, reason: 'history_ambiguous', overlay: null, projection: null,
    });
  });

  it('holds duplicate SDK rows, any sticky marker field, and retained/corrupt context', async () => {
    const duplicate = addScheduled('duplicate');
    h.makeSession('scheduled:duplicate-other', {
      sdk_session_id: duplicate.sdkSessionId, owner_user_id: null, project_id: null,
      scheduled_task_id: 'scheduled:task', is_system: 1, category: 'scheduled',
    });
    expect((await h.admit(duplicate)).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });

    const code = addScheduled('marker-code');
    h.db.prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_manifest_malformed' WHERE sdk_session_id=?`)
      .run(code.sdkSessionId);
    expect((await h.admit(code)).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });

    const timestamp = addScheduled('marker-timestamp');
    h.db.prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_at='2026-10-07T00:00:00.000Z' WHERE sdk_session_id=?`)
      .run(timestamp.sdkSessionId);
    expect((await h.admit(timestamp)).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });

    const retained = addScheduled('corrupt-context');
    const row = h.provenance.insert({
      sessionId: 'scheduled:corrupt-context', sdkSessionId: retained.sdkSessionId,
      sdkUserMessageId: retained.userMessageId, origin: 'agent_runner', requestedSource: 'agent_config', routeAuthed: null,
    } as never);
    h.provenance.setOutcome(row.id, 'accepted');
    h.db.prepare(`UPDATE agent_turn_dispatches SET dayflow_context_manifest_json='not-json' WHERE id=?`).run(row.id);
    expect((await h.admit(retained)).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });
  });

  it.each(['marker', 'retained context', 'duplicate SDK row', 'working directory'])('rechecks the unbound scheduled classification before emitting ordinary when %s changes', async (change) => {
    const initial = addScheduled(`finalize-${change.replaceAll(' ', '-')}`);
    const req = request(initial);
    h.engine.install(req);
    const admitted = await h.admission.admit({ user: { id: OWNER }, sessionToken: 'test' } as never, req);
    if (!admitted.ok) throw new Error('admission request rejected');
    expect(admitted.response).toMatchObject({ decision: 'ordinary', reason: 'none' });

    if (change === 'marker') {
      h.db.prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_manifest_malformed' WHERE sdk_session_id=?`)
        .run(initial.sdkSessionId);
    } else if (change === 'retained context') {
      const row = h.provenance.insert({
        sessionId: `scheduled:finalize-retained-context`, sdkSessionId: initial.sdkSessionId,
        sdkUserMessageId: initial.userMessageId, origin: 'agent_runner', requestedSource: 'agent_config', routeAuthed: null,
      } as never);
      h.provenance.setOutcome(row.id, 'accepted');
      h.db.prepare(`UPDATE agent_turn_dispatches SET dayflow_context_schema_version=1 WHERE id=?`).run(row.id);
    } else if (change === 'duplicate SDK row') {
      h.makeSession('scheduled:finalize-duplicate', {
        sdk_session_id: initial.sdkSessionId, owner_user_id: null, project_id: null,
        scheduled_task_id: 'scheduled:task', is_system: 1, category: 'scheduled',
      });
    } else {
      h.db.prepare(`UPDATE agent_sessions SET cwd='/different/scheduler-directory' WHERE sdk_session_id=?`)
        .run(initial.sdkSessionId);
    }

    expect(admitted.finalize()).toMatchObject({
      decision: 'hold', rawHistoryReusable: false, reason: 'receiver_changed', overlay: null, projection: null,
    });
  });
});
