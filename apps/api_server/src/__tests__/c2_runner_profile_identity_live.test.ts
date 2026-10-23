// C2-c5: real API -> runner -> native engine -> authoritative GET, synthetic external text transport only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import type { AgentSession, StructuredAgentSessionMessage } from '../models/agent_session';
import type { AgentScheduledTask } from '../repositories/agent_scheduled_tasks_repository';

const base = process.env.RHYTHM_LIVE_URL ?? '';
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}
const profileId = '869234dd-d314-46f4-8f7b-2fdedba42cb4';
(process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip)('C2 actual authoritative root identity', () => {
  // Anthropic SSE protocol reused from the read-only C1 synthetic helper; no backend mocks or lifecycle here.
  const requests: string[] = [];
  const provider = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/messages') { response.writeHead(404); response.end(); return; }
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        const marker = JSON.stringify(JSON.parse(Buffer.concat(chunks).toString())).match(/C2-[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
        if (!marker) { response.writeHead(400); response.end('Missing C2 marker'); return; }
        requests.push(marker);
        const events = [
          { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: 'text', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: marker } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 5 } },
          { type: 'message_stop' },
        ];
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n');
      } catch { response.writeHead(400); response.end('Malformed synthetic request'); }
    });
  });
  let engineAgent: string;
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (base !== 'http://127.0.0.1:4098') throw new Error('C2 requires owned isolated API4098');
    expect(await api('/opencode/health')).toMatchObject({ status: 'ready' });
    await new Promise<void>((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); });
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Provider bind failed');
    console.log('C2 provider', address.port, 'PID', process.pid);
    const response = await fetch('http://127.0.0.1:4097/global/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: { 'synthetic-c2': { npm: '@ai-sdk/anthropic', name: 'C2 synthetic text',
        options: { apiKey: 'c2-synthetic-only', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: { text: { name: 'C2 text', attachment: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000, output: 4000 } } } } } }) });
    expect(response.status).toBe(200);
    await api('/opencode/auth/synthetic-c2', 'POST', { apiKey: 'c2-synthetic-only' });
    await api('/system/refresh', 'POST');
    await api('/agent-configs', 'POST', { id: profileId, label: 'Synthetic C2 identity', icon: 'flask', enabled: true,
      isAgent: true, schedulable: true, sessionSelectable: true, ocAgent: 'build', modelProvider: 'synthetic-c2', modelId: 'text',
      allowedMcpsJson: '[]', allowedSkillsJson: '[]', allowedDelegatesJson: '[]', corePermissionsJson: '{"*":"deny"}',
      systemPrompt: 'Synthetic C2 verification: return only the requested marker. Never use tools or delegate.' });
    const profile = await api<{ id: string; ocAgent: string }>(`/agent-configs/${profileId}`);
    expect(profile.id).toBe(profileId);
    expect(profile.ocAgent).toBeTruthy();
    engineAgent = profile.ocAgent; // Consume actual projection, never guess engine name from config ID.
  }, 120_000);
  afterAll(async () => { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); });

  it.each(['scheduled-manual', 'ordinary-cookbook'])('C2-c5 %s persists profile, engine and root lineage after completion', async mode => {
    const marker = `C2-${randomUUID()}`;
    const prompt = `Reply exactly ${marker}. Synthetic identity verification only. Never use tools or delegate.`;
    let sessionId: string | undefined;
    let task: AgentScheduledTask | undefined;
    if (mode === 'scheduled-manual') {
      task = await api<AgentScheduledTask>('/agent-schedules', 'POST', { name: marker, prompt, agentConfigId: profileId,
        scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z' });
      expect(task.enabled).toBe(true); // Baseline enabled recurrence only; does NOT qualify C1 disabled/dedupe criteria.
      await api(`/agent-schedules/${task.id}/trigger-now`, 'POST');
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        const page = await api<{ sessions: AgentSession[] }>(`/agent-sessions?limit=100&scope=scheduled&includeArchived=true&scheduledTaskId=${task.id}`);
        expect(page.sessions.length).toBeLessThanOrEqual(1);
        const root = page.sessions[0];
        if (root?.sdkSessionId && root.status === 'idle') { sessionId = root.id; break; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } else {
      const recipe = await api<{ id: string }>('/agent-cookbook', 'POST', { title: marker, description: prompt, boundConfigId: profileId, steps: [] });
      const result = await api<{ sessionId: string; status: string }>(`/agent-cookbook/${recipe.id}/run`, 'POST');
      expect(result.status).toBe('done');
      sessionId = result.sessionId;
    }
    expect(sessionId).toBeTruthy();
    const root = await api<{ session: AgentSession; messages: StructuredAgentSessionMessage[] }>(`/agent-sessions/${sessionId}`);
    const engineResponse = await fetch(`http://127.0.0.1:4097/session/${root.session.sdkSessionId}/message?${new URLSearchParams({ directory: root.session.cwd })}`);
    expect(engineResponse.ok).toBe(true);
    const engine = await engineResponse.json() as { info: { id: string; sessionID: string; role: string; agent: string; modelID: string; providerID: string; time: { completed?: number }; error?: unknown }; parts: { type: string; text?: string }[] }[];
    const answer = engine.find(message => message.info.role === 'assistant' && message.info.time.completed && !message.info.error &&
      message.parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim() === marker);
    console.log('C2 actual metadata', JSON.stringify({ mode, marker, session: root.session, answer: answer?.info, requests: requests.filter(value => value === marker).length }));
    if (process.env.RHYTHM_C2_EVIDENCE_FILE) appendFileSync(process.env.RHYTHM_C2_EVIDENCE_FILE, JSON.stringify({ mode, marker, root, engine, requests }) + '\n');
    expect(root.session).toMatchObject({ id: sessionId, profileId, opencodeAgentId: engineAgent,
      scheduledTaskId: task?.id ?? null, ownerUserId: task?.createdByUserId ?? null, parentSessionId: null,
      delegationDepth: 0, providerId: 'synthetic-c2', modelId: 'text', category: task ? 'scheduled' : 'chat' });
    expect(answer?.info).toMatchObject({ sessionID: root.session.sdkSessionId, agent: engineAgent, providerID: 'synthetic-c2', modelID: 'text' });
    expect(root.messages.some(message => message.role === 'output' && message.sessionId === sessionId && message.sdkMessageId === answer?.info.id &&
      message.parts?.some(part => typeof part === 'object' && part !== null && 'type' in part && part.type === 'text' && 'text' in part && part.text === marker))).toBe(true);
    expect(requests.filter(value => value === marker)).toHaveLength(1);
    expect((await api<{ session: AgentSession }>(`/agent-sessions/${sessionId}`)).session).toMatchObject({ profileId, opencodeAgentId: engineAgent, sdkSessionId: root.session.sdkSessionId });
  }, 240_000);
});
