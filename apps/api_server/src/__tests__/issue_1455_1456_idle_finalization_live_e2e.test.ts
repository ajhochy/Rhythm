/** Live behavioral gate for #1455/#1456; run only in the isolated sandbox. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const MARKER = 'RHYTHM_IDLE_FINALIZATION_1456';
const created: string[] = [];

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function waitForMarker(sessionId: string): Promise<{
  messages: Array<{ parts?: Array<{ type?: string; text?: string }> }>;
}> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const page = await apiJson<{
      messages: Array<{ parts?: Array<{ type?: string; text?: string }> }>;
    }>(`/agent-sessions/${sessionId}/messages`);
    if (JSON.stringify(page).includes(MARKER)) return page;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('assistant marker was not finalized into the transcript');
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((id) =>
    fetch(`${BASE}/agent-sessions/${id}`, { method: 'DELETE' }),
  ));
});

describeLive('issues #1455/#1456 live idle finalization', () => {
  beforeAll(() => assertLiveE2EIsolation());

  it('persists and finalizes a real assistant turn into transcript and preview', async () => {
    const session = await apiJson<{ id: string }>('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({
        agentId: null,
        cwd: '/tmp',
        name: '#1456 idle finalization',
        permissionMode: 'default',
      }),
    });
    created.push(session.id);

    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({
      v: 1,
      type: 'session.input',
      id: session.id,
      data: `Reply with exactly ${MARKER} and nothing else.`,
    }));
    const transcript = await waitForMarker(session.id);
    ws.close();

    expect(JSON.stringify(transcript)).toContain(MARKER);
    const detail = await apiJson<{ session: { lastPreview: string | null } }>(
      `/agent-sessions/${session.id}`,
    );
    expect(detail.session.lastPreview).toContain(MARKER);
  }, 100_000);
});
