/**
 * Actual interactive Org Reviewer Task permission boundaries. The live suite
 * uses the isolated API/fork and a scripted loopback provider transport; it
 * never calls an external model provider.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOpencodeClient as createOpencodeClientV2 } from '@opencode-ai/sdk/v2/client';
import { ReviewerHarness, REVIEWER, api, json, type Json } from './org_reviewer_harness';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe.sequential : describe.skip;
const repo = resolve(__dirname, '../../../..');
const harness = new ReviewerHarness();
const permissionDenial = /unavailable tool|not permitted|not allowed|not available|invalid tool|denied|outside|permission/i;

type TaskProbe = {
  result: Awaited<ReturnType<ReviewerHarness['builtin']>>;
  childCount: number;
  childIds: string[];
  assistantAgentNames: string[];
};

function assertBuiltinRoute(selection: Json | null, name: string): void {
  expect(selection, `provider must select a supported route for builtin ${name}`).not.toBeNull();
  const offered = Array.isArray(selection?.offeredToolNames) ? selection.offeredToolNames : [];
  if (offered.includes(name)) {
    expect(selection).toMatchObject({
      selectedPath: 'direct', requestedFamily: 'builtin', requestedToolName: name,
      selectedOuterToolName: name, recordedBeforeEngineExecution: true,
    });
    return;
  }
  expect(offered, `neither ${name} nor deferred dispatcher was offered`).toContain('mcp_dispatch');
  expect(selection).toMatchObject({
    selectedPath: 'deferred-dispatch', requestedFamily: 'builtin', requestedToolName: name,
    selectedOuterToolName: 'mcp_dispatch', selectedFamily: 'builtin', selectedInnerToolName: name,
    recordedBeforeEngineExecution: true,
  });
}

async function taskProbe(session: Json, target: 'general' | 'explore'): Promise<TaskProbe> {
  const directory = String(session.cwd ?? process.env.RHYTHM_SANDBOX_DIR ?? '');
  const before = await harness.client.session.list({ query: { directory }, throwOnError: true });
  const beforeIds = new Set(((before.data ?? []) as Json[]).map((row) => String(row.id)));
  let result: Awaited<ReturnType<ReviewerHarness['builtin']>> | undefined;
  let children: Json[] = [];
  try {
    result = await harness.builtin('task', {
      subagent_type: target,
      description: `${harness.marker} harmless ${target} permission boundary`,
      prompt: 'Return only the word marker. Do not use tools, files, network, or create or change anything.',
    }, session);
  } finally {
    const listed = await harness.client.session.list({ query: { directory }, throwOnError: true });
    children = ((listed.data ?? []) as Json[]).filter((row) =>
      !beforeIds.has(String(row.id)) && row.parentID === session.sdkSessionId,
    );
    if (children.length > 0) await cleanUnexpectedChildren(String(session.sdkSessionId), children, directory);
  }
  return {
    result: result!,
    childCount: children.length,
    childIds: children.map((child) => String(child.id)),
    assistantAgentNames: result!.assistantAgentNames,
  };
}

async function cleanUnexpectedChildren(parentSdkId: string, children: Json[], directory: string): Promise<void> {
  for (const child of children) {
    const id = String(child.id ?? '');
    if (!id) throw new Error('UNVERIFIED: child session had no SDK ID; refusing broad cleanup');
    const detail = await harness.client.session.get({ path: { id }, query: { directory }, throwOnError: true });
    if ((detail.data as Json).parentID !== parentSdkId) {
      throw new Error('UNVERIFIED: refusing to delete a session outside the owned reviewer lineage');
    }
    const removed = await harness.client.session.delete({ path: { id }, query: { directory } });
    if (removed.error) throw new Error('UNVERIFIED: unexpected owned child-session cleanup failed');
  }
}

function assertDenied(probe: TaskProbe, target: 'general' | 'explore'): void {
  assertBuiltinRoute(probe.result.dispatchSelection, 'task');
  expect(probe.assistantAgentNames).toContain(REVIEWER);
  const failure = probe.result.raw;
  expect(probe.result.error, `${target} must fail through the actual engine permission check: ${failure}`).toBe(true);
  expect(permissionDenial.test(failure), `${target} must fail at the permission boundary, not as an unknown tool/schema error: ${failure}`).toBe(true);
  expect(probe.childCount, `${target} must be denied before child-session creation`).toBe(0);
}

function assertBuiltinPermissionDenied(result: Awaited<ReturnType<ReviewerHarness['builtin']>>, name: string): void {
  assertBuiltinRoute(result.dispatchSelection, name);
  expect(result.assistantAgentNames).toContain(REVIEWER);
  expect(result.error, `${name} must fail through the actual engine permission check: ${result.raw}`).toBe(true);
  expect(permissionDenial.test(result.raw), `${name} must fail at the permission boundary: ${result.raw}`).toBe(true);
}

async function sdkSession(session: Json): Promise<Json> {
  const response = await harness.client.session.get({
    path: { id: session.sdkSessionId },
    query: { directory: session.cwd },
    throwOnError: true,
  });
  return response.data as Json;
}

function assertReviewerTaskDeny(session: Json): void {
  const rules: Json[] = Array.isArray(session.permission) ? session.permission : [];
  const taskRules = rules.filter((rule) => rule.permission === 'task');
  expect(taskRules.at(-1), 'the final SDK task rule must keep the reviewer task surface denied').toMatchObject({
    pattern: '*', action: 'deny',
  });
}

describeLive('Org Reviewer interactive native Task policy', () => {
  let owner!: { token: string; userId: number };
  let reviewer!: Json;

  beforeAll(async () => {
    const expected = process.env.RHYTHM_EXPECTED_SOURCE_REVISION ?? '';
    expect(expected).toMatch(/^[a-f0-9]{40}$/);
    expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(expected);
    await harness.setup();
    owner = await harness.syntheticOwner();
    const readiness = await harness.reviewerMcpReadiness();
    expect(readiness.rhythmStatus).toBe('connected');
    expect(readiness.createTaskVisible).toBe(true);

    reviewer = await harness.session(REVIEWER, `${harness.marker} interactive Task policy`, owner.token);
    const envelope = await json(`/agent-sessions/${reviewer.id}`) as Json;
    const durable = envelope.session as Json;
    expect(durable.category).toBe('chat');
    expect(durable.isSystem).toBe(false);
    expect(durable.scheduledTaskId ?? null).toBeNull();
    expect(durable.mcpRole).toBe(REVIEWER);
  }, 120_000);

  afterAll(async () => harness.cleanup(), 180_000);

  it('denies reviewer general and explore Task calls through the actual offered route', async () => {
    const session = await sdkSession(reviewer);
    assertReviewerTaskDeny(session);
    assertDenied(await taskProbe(reviewer, 'general'), 'general');
    assertDenied(await taskProbe(reviewer, 'explore'), 'explore');
  }, 120_000);

  it('denies Reviewer shell and read calls on the normal prompt route', async () => {
    const sandbox = await realpath(String(process.env.RHYTHM_SANDBOX_DIR));
    if (!sandbox.startsWith('/private/tmp/')) throw new Error('UNVERIFIED: harmless read probe must stay in the owned private sandbox');
    const canary = `org-reviewer-read-probe-${randomUUID()}`;
    const fixtureFile = resolve(sandbox, `${canary}.txt`);
    await writeFile(fixtureFile, canary, { encoding: 'utf8', flag: 'wx', mode: 0o400 });
    try {
      const shell = await harness.builtin('bash', {
        command: `printf '%s' '${canary}'`,
        workdir: sandbox,
      }, reviewer);
      assertBuiltinPermissionDenied(shell, 'bash');

      const read = await harness.builtin('read', { filePath: fixtureFile }, reviewer);
      assertBuiltinPermissionDenied(read, 'read');
      expect(read.raw).not.toContain(canary);
    } finally {
      await unlink(fixtureFile).catch(() => undefined);
    }
  }, 120_000);

  it('rejects a normal API permission-mode update to bypass without changing the session', async () => {
    const response = await api(`/agent-sessions/${reviewer.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ permissionMode: 'bypassPermissions' }),
    });
    expect(response.status).toBe(400);
    await response.text();
    const envelope = await json(`/agent-sessions/${reviewer.id}`) as Json;
    expect((envelope.session as Json).permissionMode).toBe('default');
    assertReviewerTaskDeny(await sdkSession(reviewer));
    assertDenied(await taskProbe(reviewer, 'general'), 'general');
    assertDenied(await taskProbe(reviewer, 'explore'), 'explore');
  }, 120_000);

  it('rejects bypass mode before creating an Org Reviewer session', async () => {
    const name = `${harness.marker} rejected bypass creation`;
    const response = await api('/agent-sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({
        profileId: REVIEWER,
        mcpRole: REVIEWER,
        cwd: process.env.RHYTHM_SANDBOX_DIR,
        name,
        permissionMode: 'bypassPermissions',
      }),
    });
    expect(response.status).toBe(400);
    await response.text();
    const listed = await json('/agent-sessions') as Json;
    const rows: Json[] = Array.isArray(listed) ? listed : Array.isArray(listed.sessions) ? listed.sessions : [];
    expect(rows.some((row) => row.name === name), 'rejected create must not leave a durable session row').toBe(false);
  }, 60_000);

  it('reasserts Reviewer denial after restoring a legacy SDK task grant through the API', async () => {
    const sdk = createOpencodeClientV2({
      baseUrl: process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097',
      directory: process.env.RHYTHM_SANDBOX_DIR,
    });
    const legacyPermission = [
      { permission: 'task' as const, pattern: '*', action: 'deny' as const },
      { permission: 'task' as const, pattern: 'explore', action: 'allow' as const },
      { permission: 'task' as const, pattern: 'general', action: 'allow' as const },
    ];
    const seeded = await sdk.session.update({
      sessionID: reviewer.sdkSessionId,
      permission: legacyPermission,
    });
    expect(seeded.error, 'direct SDK setup should reproduce old interactive task grants').toBeUndefined();
    const before = await sdkSession(reviewer);
    const beforeRules: Json[] = Array.isArray(before.permission) ? before.permission : [];
    expect(beforeRules.filter((rule) => rule.permission === 'task').at(-1)).toMatchObject({
      pattern: 'general', action: 'allow',
    });

    const repaired = await api(`/agent-sessions/${reviewer.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ permissionMode: 'default' }),
    });
    expect(repaired.status).toBe(200);
    expect(await repaired.json()).toMatchObject({ permissionMode: 'default' });
    assertReviewerTaskDeny(await sdkSession(reviewer));
    assertDenied(await taskProbe(reviewer, 'general'), 'general');
    assertDenied(await taskProbe(reviewer, 'explore'), 'explore');
  }, 120_000);

  it('denies a legacy SDK task grant on the next ordinary prompt without requiring an API mode update', async () => {
    const legacySession = await harness.session(REVIEWER, `${harness.marker} legacy active prompt`, owner.token);
    const sdk = createOpencodeClientV2({
      baseUrl: process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097',
      directory: process.env.RHYTHM_SANDBOX_DIR,
    });
    const seeded = await sdk.session.update({
      sessionID: legacySession.sdkSessionId,
      permission: [
        { permission: 'task' as const, pattern: '*', action: 'deny' as const },
        { permission: 'task' as const, pattern: 'general', action: 'allow' as const },
      ],
    });
    expect(seeded.error, 'direct SDK setup should reproduce an old active task grant').toBeUndefined();
    expect((await sdkSession(legacySession)).permission.filter((rule: Json) => rule.permission === 'task').at(-1))
      .toMatchObject({ pattern: 'general', action: 'allow' });

    const probe = await taskProbe(legacySession, 'general');
    assertDenied(probe, 'general');
    assertReviewerTaskDeny(await sdkSession(legacySession));
  }, 120_000);

  it('rejects bypass while switching ordinary chat to Reviewer and preserves ordinary Task access', async () => {
    const profile = await harness.profile('ordinary interactive Task control', 'Return a short harmless status. Do not access files or external tools.');
    const session = await harness.session(profile.id, `${harness.marker} ordinary interactive Task control`, owner.token);
    const attemptedPromotion = await api(`/agent-sessions/${session.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ profileId: REVIEWER, permissionMode: 'bypassPermissions' }),
    });
    expect(attemptedPromotion.status).toBe(400);
    await attemptedPromotion.text();
    const envelope = await json(`/agent-sessions/${session.id}`, {
      headers: { authorization: `Bearer ${owner.token}` },
    }) as Json;
    const durable = envelope.session as Json;
    expect(durable.category).toBe('chat');
    expect(durable.isSystem).toBe(false);
    expect(durable.scheduledTaskId ?? null).toBeNull();
    expect(durable.profileId).toBe(profile.id);
    expect(durable.permissionMode).toBe('default');
    const sdk = await sdkSession(session);
    const rules: Json[] = Array.isArray(sdk.permission) ? sdk.permission : [];
    expect(rules.filter((rule) => rule.permission === 'task').at(-1)).toMatchObject({
      pattern: 'general', action: 'allow',
    });

    const probe = await taskProbe(session, 'general');
    assertBuiltinRoute(probe.result.dispatchSelection, 'task');
    expect(probe.result.error, probe.result.raw).toBe(false);
    expect(probe.childCount, 'ordinary interactive general Task must create exactly one owned child').toBe(1);
    expect(probe.childIds).toHaveLength(1);
  }, 120_000);
});
