/** Parent-runtime-only: real HTTP → scheduler → AgentRunner → engine → persisted run/session.
 * No backend lifecycle, DB writes, credentials, mocks, or installed-button attribution here.
 * Required: RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 DB_PATH=<sandbox DB>
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_C1_FIXTURE_PROFILE=<approved synthetic profile>
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { startC1Provider } from './_c1_synthetic_provider';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import type { AgentScheduledTask } from '../repositories/agent_scheduled_tasks_repository';
import type { AgentScheduledTaskRun } from '../repositories/agent_scheduled_task_runs_repository';
import type { AgentSession, StructuredAgentSessionMessage } from '../models/agent_session';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const base = process.env.RHYTHM_LIVE_URL ?? '';
// Structured parts are authoritative: never fall back to raw reasoning/tool text.
function finalOutput(messages: Pick<StructuredAgentSessionMessage, 'role' | 'sessionId' | 'parts' | 'strippedText' | 'rawText'>[], sessionId: string): string[] {
  return messages.filter(message => message.role === 'output' && message.sessionId === sessionId).map(message =>
    Array.isArray(message.parts)
      ? message.parts.filter((part): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: string }).text === 'string' && !(part as { synthetic?: boolean }).synthetic && !(part as { ignored?: boolean }).ignored)
        .map(part => part.text).join('').trim()
      : (message.strippedText || message.rawText || '').trim(),
  ).filter(Boolean);
}
describe('C1 evidence falsification (no server)', () => {
  it('isolates the old input-only false positive before replacing the proof', () => {
    const marker = 'C1-synthetic-proof';
    const root = { messages: [{ role: 'input', rawText: `Reply exactly ${marker}` }] };
    expect(JSON.stringify(root.messages)).toContain(marker); // Old assertion passes without any answer.
    expect(root.messages.some(message => String(message.role) === 'output')).toBe(false);
  });
  it('isolates queued-only duplicate and history-only orphan false positives', () => {
    const immediateDuplicate = { lastRunStatus: 'queued' };
    expect(['queued', 'running']).toContain(immediateDuplicate.lastRunStatus);
    expect(immediateDuplicate.lastRunStatus).not.toBe('running');
    const history = [{ rootSessionId: 'root-1' }];
    const roots = ['root-1', 'orphan-root-2'];
    expect(history).toHaveLength(1); // Old proof cannot see the orphan.
    expect(roots).toHaveLength(2);
  });
  it('accepts persisted output text but rejects input, reasoning, tool, wrong-session and echo-only proofs', () => {
    const marker = 'C1-synthetic-proof';
    const output = { role: 'output' as const, sessionId: 'root-1', strippedText: marker, rawText: marker, parts: [{ type: 'text', text: marker }] };
    expect(finalOutput([output], 'root-1')).toEqual([marker]);
    expect(finalOutput([{ ...output, role: 'input' }], 'root-1')).toEqual([]);
    expect(finalOutput([{ ...output, parts: [{ type: 'reasoning', text: marker }, { type: 'tool', text: marker }] }], 'root-1')).toEqual([]);
    expect(finalOutput([{ ...output, parts: [{ type: 'text', text: marker, synthetic: true }] }], 'root-1')).toEqual([]);
    expect(finalOutput([output], 'other-root')).toEqual([]);
    expect(finalOutput([{ ...output, parts: [{ type: 'text', text: `Reply exactly ${marker}` }] }], 'root-1')).not.toContain(marker);
  });
});
describe('C1 provider control trust boundary', () => {
  it('rejects malformed fixture state/count rather than admitting false runtime evidence', async () => {
    let body: unknown = { state: 'held', requests: 1 };
    const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture bind failed');
    const previous = process.env.RHYTHM_C1_PROVIDER_CONTROL_URL;
    process.env.RHYTHM_C1_PROVIDER_CONTROL_URL = `http://127.0.0.1:${address.port}`;
    try {
      expect(await heldProvider('validation')).toEqual({ state: 'held', requests: 1 });
      for (body of [null, {}, { state: 1, requests: 0 }, { state: 'held', requests: -1 }, { state: 'held', requests: 0.5 }, { state: 'held', requests: '1' }]) {
        await expect(heldProvider('validation')).rejects.toThrow('Malformed synthetic provider control');
      }
    } finally {
      if (previous === undefined) delete process.env.RHYTHM_C1_PROVIDER_CONTROL_URL;
      else process.env.RHYTHM_C1_PROVIDER_CONTROL_URL = previous;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
async function scopedSessions(taskId: string, parentId?: string, marker?: string, scope = 'scheduled'): Promise<AgentSession[]> {
  // Always opt into pagination: legacy task listing appends global resumables.
  const query = new URLSearchParams({ limit: '100', scope, includeArchived: 'true' });
  if (marker) query.set('search', marker); // Literal synthetic marker only; catches roots missing task linkage.
  else query.set('scheduledTaskId', taskId);
  if (parentId) query.set('parentId', parentId);
  const sessions: AgentSession[] = [];
  for (;;) {
    const page = await api<{ sessions: AgentSession[]; resumable: unknown[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }>(`/agent-sessions?${query}`);
    expect(page.resumable).toEqual([]);
    sessions.push(...page.sessions);
    if (!page.pageInfo.hasMore) break;
    expect(page.pageInfo.nextCursor).toBeTruthy();
    query.set('cursor', page.pageInfo.nextCursor!);
  }
  expect(new Set(sessions.map(session => session.id)).size).toBe(sessions.length);
  return sessions;
}
async function markerSessions(marker: string): Promise<AgentSession[]> {
  const sessions: AgentSession[] = [];
  for (const scope of ['scheduled', 'chats', 'self_improvement']) sessions.push(...await scopedSessions('', undefined, marker, scope));
  return sessions;
}
async function heldProvider(marker: string, release = false): Promise<{ state: string; requests: number }> {
  const control = new URL(process.env.RHYTHM_C1_PROVIDER_CONTROL_URL ?? '');
  if (control.hostname !== '127.0.0.1' || control.protocol !== 'http:' || control.pathname !== '/' ||
      !control.port || ['4001', '4002', '4096', '4097', '4098', '4099'].includes(control.port) || control.username || control.password) {
    throw new Error('UNVERIFIED: manager must supply an owned synthetic provider control origin on a separate port');
  }
  const response = await fetch(`${control.origin}/c1/holds/${encodeURIComponent(marker)}${release ? '/release' : ''}`, {
    method: release ? 'POST' : 'GET', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Synthetic provider control HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('state' in body) || typeof body.state !== 'string' ||
      !('requests' in body) || typeof body.requests !== 'number' || !Number.isInteger(body.requests) || body.requests < 0) {
    throw new Error('Malformed synthetic provider control response');
  }
  return { state: body.state, requests: body.requests };
}

(live ? describe : describe.skip)('C1 actual sandbox manual dispatch', () => {
  let provider: Awaited<ReturnType<typeof startC1Provider>> | undefined;
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(base);
    if (url.origin !== 'http://127.0.0.1:4098' || url.pathname !== '/') throw new Error('C1 requires the parent-owned isolated API on 4098');
    const profileId = process.env.RHYTHM_C1_FIXTURE_PROFILE;
    if (!profileId?.startsWith('synthetic-')) throw new Error('Parent must provision an approved synthetic-* runnable fixture profile');
    expect(await api<{ status: string }>('/opencode/health')).toMatchObject({ status: 'ready' });
    provider = await startC1Provider();
    process.env.RHYTHM_C1_PROVIDER_CONTROL_URL = provider.origin;
    console.log('C1 owned provider control', provider.origin);
    const configured = await fetch('http://127.0.0.1:4097/global/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: { 'synthetic-c1': { npm: '@ai-sdk/anthropic', name: 'C1 synthetic text transport',
        options: { apiKey: 'c1-synthetic-only', baseURL: `${provider.origin}/v1` },
        models: { text: { name: 'C1 synthetic text', attachment: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000, output: 4000 } } } } } }) });
    expect(configured.status).toBe(200);
    await api('/opencode/auth/synthetic-c1', 'POST', { apiKey: 'c1-synthetic-only' });
    await api('/system/refresh', 'POST');
    await api('/agent-configs', 'POST', { id: profileId, label: 'Synthetic C1 proof', icon: 'flask', isAgent: true, enabled: true,
      ocAgent: 'build', modelProvider: 'synthetic-c1', modelId: 'text', schedulable: true, sessionSelectable: true,
      allowedMcpsJson: '[]', allowedSkillsJson: '[]', allowedDelegatesJson: '[]', corePermissionsJson: '{"*":"deny"}',
      systemPrompt: 'Synthetic C1 verification: return only the requested C1 marker. Never use tools or delegate.' });
    const profile = await api<{ enabled: boolean; locked: boolean; schedulable?: boolean; sessionSelectable?: boolean }>(`/agent-configs/${encodeURIComponent(profileId)}`);
    expect(profile.enabled).toBe(true);
    expect(profile.locked).not.toBe(true);
    expect(profile.schedulable ?? profile.sessionSelectable).not.toBe(false);
    // Control readiness is fixture authority, not product/runtime readiness.
    expect(await heldProvider('readiness')).toMatchObject({ state: 'ready', requests: 0 });
  }, 120_000);
  afterAll(async () => {
    if (provider) {
      console.log('C1 provider final counts', JSON.stringify([...provider.holds].map(([marker, hold]) => ({ marker, state: hold.state, requests: hold.requests }))));
      await provider.close();
    }
  });

  it('one accepted manual run executes with recurrence off; duplicates join and fresh reads retain one terminal root session', async () => {
    // Regression: disabled queued work never runs, or duplicate clicks reset running and create two roots.
    const marker = `C1-${randomUUID()}`;
    const task = await api<AgentScheduledTask>('/agent-schedules', 'POST', { name: marker, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', agentConfigId: process.env.RHYTHM_C1_FIXTURE_PROFILE, prompt: `Reply exactly ${marker}. Do not use tools or delegate. Synthetic verification only.` });
    await api(`/agent-schedules/${task.id}`, 'PATCH', { enabled: false });
    expect(await api<AgentScheduledTask>(`/agent-schedules/${task.id}`)).toMatchObject({ enabled: false, lastRunStatus: null });
    expect(await api<AgentScheduledTaskRun[]>(`/agent-schedules/${task.id}/runs`)).toEqual([]);
    const beforeRoots = await scopedSessions(task.id);
    expect(beforeRoots).toEqual([]);
    expect(await markerSessions(marker)).toEqual([]);
    const accepted = await api<AgentScheduledTask>(`/agent-schedules/${task.id}/trigger-now`, 'POST');
    expect(accepted).toMatchObject({ id: task.id, enabled: false, lastRunStatus: 'queued' });
    const queuedDuplicate = await api<AgentScheduledTask>(`/agent-schedules/${task.id}/trigger-now`, 'POST');
    expect(queuedDuplicate).toMatchObject({ id: task.id, enabled: false });
    expect(['queued', 'running']).toContain(queuedDuplicate.lastRunStatus);
    // Provider captures the marker and holds its final response until explicitly released.
    let running: AgentScheduledTask | undefined;
    const runningDeadline = Date.now() + 120_000;
    while (Date.now() < runningDeadline) {
      const current = await api<AgentScheduledTask>(`/agent-schedules/${task.id}`);
      expect(current.enabled).toBe(false);
      if (current.lastRunStatus === 'running' && (await heldProvider(marker)).state === 'held') {
        running = current;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    expect(running, 'UNVERIFIED: persisted running plus captured held provider response required').toBeDefined();
    expect(running!.lastRunAt).toBeTruthy();
    const runningRoots = await scopedSessions(task.id);
    expect(runningRoots).toHaveLength(1);
    const runningRoot = runningRoots[0];
    expect(runningRoot).toMatchObject({ scheduledTaskId: task.id, profileId: process.env.RHYTHM_C1_FIXTURE_PROFILE, parentSessionId: null });
    expect(runningRoot.sdkSessionId).toBeTruthy();
    expect((await markerSessions(marker)).map(session => session.id)).toEqual([runningRoot.id]);
    expect(await scopedSessions(task.id, runningRoot.id)).toEqual([]);
    expect(await api<AgentScheduledTaskRun[]>(`/agent-schedules/${task.id}/runs`)).toEqual([]);
    const duplicate = await api<AgentScheduledTask>(`/agent-schedules/${task.id}/trigger-now`, 'POST');
    expect(duplicate).toMatchObject({ id: task.id, enabled: false, lastRunStatus: 'running', lastRunAt: running!.lastRunAt, nextRunAt: running!.nextRunAt });
    expect(await api<AgentScheduledTask>(`/agent-schedules/${task.id}`)).toMatchObject({ lastRunStatus: 'running', lastRunAt: running!.lastRunAt, nextRunAt: running!.nextRunAt });
    expect((await scopedSessions(task.id)).map(session => session.id)).toEqual([runningRoot.id]);
    expect(await heldProvider(marker)).toMatchObject({ state: 'held', requests: 1 });
    expect(await heldProvider(marker, true)).toMatchObject({ state: 'released', requests: 1 });
    const deadline = Date.now() + 180_000;
    let runs: AgentScheduledTaskRun[] = [];
    while (Date.now() < deadline) {
      const current = await api<AgentScheduledTask>(`/agent-schedules/${task.id}`);
      expect(current.enabled).toBe(false);
      runs = await api<AgentScheduledTaskRun[]>(`/agent-schedules/${task.id}/runs`);
      if (runs.length > 0) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(runs).toHaveLength(1);
    expect(['success', 'completed_no_op']).toContain(runs[0].status);
    expect(runs[0]).toMatchObject({ taskId: task.id, rootSessionId: runningRoot.id, startedAt: running!.lastRunAt });
    expect(runs[0].id).toBeTruthy();
    expect(runs[0].endedAt).toBeTruthy();
    const readRoot = () => api<{ session: AgentSession; messages: StructuredAgentSessionMessage[] }>(`/agent-sessions/${runningRoot.id}`);
    const root = await readRoot();
    expect(root.session).toMatchObject({ id: runningRoot.id, scheduledTaskId: task.id, profileId: process.env.RHYTHM_C1_FIXTURE_PROFILE, sdkSessionId: runningRoot.sdkSessionId, parentSessionId: null });
    expect(finalOutput(root.messages, runningRoot.id)).toContain(marker);
    // Independently bind the completed assistant answer to the actual engine session.
    const engineResponse = await fetch(`http://127.0.0.1:4097/session/${encodeURIComponent(runningRoot.sdkSessionId!)}/message?${new URLSearchParams({ directory: root.session.cwd })}`, { signal: AbortSignal.timeout(10_000) });
    expect(engineResponse.ok).toBe(true);
    const engineMessages = await engineResponse.json() as { info: { id: string; role: string; sessionID: string; time: { completed?: number }; error?: unknown }; parts: { type: string; text?: string; synthetic?: boolean; ignored?: boolean }[] }[];
    const final = engineMessages.filter(message => message.info.role === 'assistant' && message.info.sessionID === runningRoot.sdkSessionId && message.info.time.completed && !message.info.error)
      .find(message => message.parts.filter(part => part.type === 'text' && !part.synthetic && !part.ignored).map(part => part.text ?? '').join('').trim() === marker);
    expect(final, 'completed real engine assistant text, not input/tool/reasoning').toBeDefined();
    expect(root.messages.some(message => message.role === 'output' && message.sessionId === runningRoot.id && message.sdkMessageId === final!.info.id && finalOutput([message], runningRoot.id).includes(marker))).toBe(true);
    // Observe another full scheduler interval: recurrence stayed off, no second run/root.
    await new Promise(resolve => setTimeout(resolve, 65_000));
    expect(await api<AgentScheduledTaskRun[]>(`/agent-schedules/${task.id}/runs`)).toEqual(runs);
    expect(await api<AgentScheduledTask>(`/agent-schedules/${task.id}`)).toMatchObject({ enabled: false, lastRunStatus: runs[0].status });
    // New catalog snapshots (no cursor reuse), then reopen the authoritative transcript.
    const reopenedRoots = await scopedSessions(task.id);
    expect(reopenedRoots.filter(session => !beforeRoots.some(before => before.id === session.id)).map(session => session.id)).toEqual([runningRoot.id]);
    expect(reopenedRoots[0]).toMatchObject({ parentSessionId: null, sdkSessionId: runningRoot.sdkSessionId, profileId: process.env.RHYTHM_C1_FIXTURE_PROFILE });
    expect((await markerSessions(marker)).map(session => session.id)).toEqual([runningRoot.id]);
    expect(await scopedSessions(task.id, runningRoot.id)).toEqual([]);
    expect(finalOutput((await readRoot()).messages, runningRoot.id)).toContain(marker);
    expect(await heldProvider(marker)).toMatchObject({ requests: 1 });
    // Only this test's terminal synthetic schedule is removed. Failed/in-flight evidence is left for the owner.
    await api(`/agent-schedules/${task.id}`, 'DELETE');
  }, 400_000);
  it.each(['DISABLED', 'LOCKED', 'RETIRED'])('real %s profile guard rejects without queue/history/root mutation', async kind => {
    const taskId = process.env[`RHYTHM_C1_${kind}_TASK`];
    expect(taskId, `UNVERIFIED: owner must seed synthetic-C1-guard-${kind} schedule bound to the corresponding blocked profile`).toBeTruthy();
    const before = await api<AgentScheduledTask>(`/agent-schedules/${taskId}`);
    expect(before.name).toBe(`synthetic-C1-guard-${kind}`);
    expect(before.enabled).toBe(false);
    expect(before.lastRunStatus).toBeNull();
    expect(before.agentConfigId).toMatch(/^synthetic-/);
    const fixture = await api<{ enabled: boolean; locked: boolean; allowedMcpsJson?: string | null }>(`/agent-configs/${encodeURIComponent(before.agentConfigId!)}`);
    if (kind === 'DISABLED') expect(fixture.enabled).toBe(false);
    if (kind === 'LOCKED') expect(fixture.locked).toBe(true);
    if (kind === 'RETIRED') expect([before.allowedMcpsJson, fixture.allowedMcpsJson].some(json => json?.includes('"rhythm_run_org_optimizer"'))).toBe(true);
    const history = await api<AgentScheduledTaskRun[]>(`/agent-schedules/${taskId}/runs`);
    const roots = await scopedSessions(taskId!);
    expect(history).toEqual([]);
    expect(roots).toEqual([]);
    const response = await fetch(`${base}/agent-schedules/${taskId}/trigger-now`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body.toLowerCase()).toContain(kind.toLowerCase());
    expect(body).not.toMatch(/Bearer\s|api[_-]?key\s*[:=]|SECRET/);
    expect(await api<AgentScheduledTask>(`/agent-schedules/${taskId}`)).toEqual(before);
    expect(await api<AgentScheduledTaskRun[]>(`/agent-schedules/${taskId}/runs`)).toEqual(history);
    expect(await scopedSessions(taskId!)).toEqual(roots);
  });
  it('real model override validation rejects an incomplete pair with actionable feedback', async () => {
    const response = await fetch(`${base}/agent-schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `C1-invalid-model-${randomUUID()}`, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', prompt: 'Synthetic only', modelProvider: 'synthetic-c1' }), signal: AbortSignal.timeout(10_000) });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('modelProvider and modelId must be set together');
  });
  // Complementary live gates are executed separately so each owns its provider
  // and authentication fixtures: c1_gap_auth_live.test.ts (Device rejection),
  // c1_gap_provider_live.test.ts (durable provider failure), and the real browser
  // apps/web/tests/c1-live-reconnect.spec.ts (reconnect and persisted reopening).
  // Combined execution evidence: docs/ai/runs/2026-10-01-memory-recovery-integration.md.
});
