import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { startC1ErrorProvider } from './_c1_error_provider';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import type { AgentScheduledTask } from '../repositories/agent_scheduled_tasks_repository';
import type { AgentScheduledTaskRun } from '../repositories/agent_scheduled_task_runs_repository';
import type { AgentSession, StructuredAgentSessionMessage } from '../models/agent_session';
const base = 'http://127.0.0.1:4098';
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return response.json() as Promise<T>;
}
(process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip)('C1 actual provider terminal failure', () => {
  const profileId = `synthetic-c1-error-${randomUUID()}`;
  let provider: Awaited<ReturnType<typeof startC1ErrorProvider>>;
  beforeAll(async () => {
    assertLiveE2EIsolation();
    expect(process.env.RHYTHM_LIVE_URL).toBe(base);
    expect(await api('/opencode/health')).toMatchObject({ status: 'ready' });
    provider = await startC1ErrorProvider();
    const result = await fetch('http://127.0.0.1:4097/global/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: { 'synthetic-c1': { npm: '@ai-sdk/anthropic', options: { apiKey: 'c1-synthetic-only', baseURL: `${provider.origin}/v1` }, models: { text: { name: 'C1 synthetic text', attachment: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000, output: 4000 } } } } } }) });
    expect(result.status).toBe(200);
    await api('/opencode/auth/synthetic-c1', 'POST', { apiKey: 'c1-synthetic-only' });
    await api('/system/refresh', 'POST');
    await api('/agent-configs', 'POST', { id: profileId, label: 'Synthetic C1 error proof', icon: 'flask', isAgent: true, enabled: true, ocAgent: 'build', modelProvider: 'synthetic-c1', modelId: 'text', schedulable: true, sessionSelectable: true, allowedMcpsJson: '[]', allowedSkillsJson: '[]', allowedDelegatesJson: '[]', corePermissionsJson: '{"*":"deny"}', systemPrompt: 'Return only the requested C1 marker. Never use tools or delegate.' });
    console.log('C1 error provider', provider.origin);
  }, 120000);
  afterAll(async () => { if (provider) await provider.close(); });
  it('nonretryable synthetic 401 becomes durable actionable error, never false completion; disabled recurrence stays off', async () => {
    const marker = `C1-${randomUUID()}`;
    provider.failures.set(marker, 0);
    const task = await api<AgentScheduledTask>('/agent-schedules', 'POST', { name: marker, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', agentConfigId: profileId, prompt: `Reply exactly ${marker}. Never use tools or delegate.` });
    await api(`/agent-schedules/${task.id}`, 'PATCH', { enabled: false });
    expect(await api(`/agent-schedules/${task.id}/trigger-now`, 'POST')).toMatchObject({ enabled: false, lastRunStatus: 'queued' });
    const states: { at: number; task: AgentScheduledTask; runs: AgentScheduledTaskRun[] }[] = [];
    const deadline = Date.now() + 180000;
    let runs: AgentScheduledTaskRun[] = [];
    while (Date.now() < deadline) {
      const current = await api<AgentScheduledTask>(`/agent-schedules/${task.id}`);
      runs = await api<AgentScheduledTaskRun[]>(`/agent-schedules/${task.id}/runs`);
      expect(current.enabled).toBe(false);
      states.push({ at: Date.now(), task: current, runs });
      if (runs.length) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const current = await api<AgentScheduledTask>(`/agent-schedules/${task.id}`);
    const catalog = await api<{ sessions: AgentSession[] }>(`/agent-sessions?limit=100&scope=scheduled&includeArchived=true&scheduledTaskId=${task.id}`);
    const root = catalog.sessions[0] ? await api<{ session: AgentSession; messages: StructuredAgentSessionMessage[] }>(`/agent-sessions/${catalog.sessions[0].id}`) : null;
    const engine = root?.session.sdkSessionId ? await (await fetch(`http://127.0.0.1:4097/session/${root.session.sdkSessionId}/message?${new URLSearchParams({ directory: root.session.cwd })}`)).json() : null;
    // Preserve evidence before asserting terminal classification; teardown is never the induced failure.
    writeFileSync(`${process.env.RHYTHM_C1_GAP_EVIDENCE}/provider-live.json`, JSON.stringify({ marker, taskId: task.id, providerOrigin: provider.origin, requests: provider.failures.get(marker), states, current, runs, catalog, root, engine }, null, 2));
    console.log('C1 provider terminal evidence', JSON.stringify({ marker, taskId: task.id, requests: provider.failures.get(marker), current, runs, root: root?.session }));
    expect(provider.failures.get(marker)).toBe(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ taskId: task.id, status: 'error', rootSessionId: root!.session.id });
    expect(runs[0].error).toMatch(/provider|auth|model|401/i);
    expect(current).toMatchObject({ enabled: false, lastRunStatus: 'error', lastError: runs[0].error });
    expect(catalog.sessions).toHaveLength(1);
    expect(root!.session).toMatchObject({ status: 'error', profileId, parentSessionId: null });
    expect(root!.messages.some(message => message.role === 'output' && message.strippedText?.trim() === marker)).toBe(false);
    // No automatic quarantine/disable policy is asserted for SQLite; Postgres is a separate gate.
    await new Promise(resolve => setTimeout(resolve, 65000));
    expect(await api(`/agent-schedules/${task.id}/runs`)).toEqual(runs);
    expect(await api(`/agent-schedules/${task.id}`)).toMatchObject({ enabled: false, lastRunStatus: 'error' });
    expect(provider.failures.get(marker)).toBe(1);
  }, 300000);
});
