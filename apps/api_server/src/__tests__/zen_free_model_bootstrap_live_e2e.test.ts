/**
 * Zen bootstrap live contract: an untouched sandbox has no provider credential, yet its
 * fresh Rhythm Setup profile can complete a real engine turn through Zen.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { homedir } from 'node:os';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
let sessionId: string | undefined;

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function waitForIdle(id: string): Promise<{ status: string }> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await apiJson<{ session: { status: string } }>(`/agent-sessions/${id}`);
    if (!['working', 'starting'].includes(result.session.status)) return result.session;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`session ${id} did not finish within 120 seconds`);
}

describeLive('Zen free-model bootstrap live acceptance contract', () => {
  beforeAll(() => assertLiveE2EIsolation());

  afterEach(async () => {
    if (sessionId) await fetch(`${BASE}/agent-sessions/${sessionId}`, { method: 'DELETE' });
    sessionId = undefined;
  });

  it('completes a no-auth rhythm-setup turn over opencode/deepseek-v4-flash-free', async () => {
    const profile = await apiJson<{
      modelProvider: string;
      modelId: string;
    }>('/agent-configs/rhythm-setup');
    expect(profile).toMatchObject({
      modelProvider: 'opencode',
      modelId: 'deepseek-v4-flash-free',
    });
    const configDoctor = await apiJson<{
      modelProvider: string;
      modelId: string;
      allowedSkillsJson: string | null;
    }>('/agent-configs/config-doctor');
    expect(configDoctor).toMatchObject({
      modelProvider: 'opencode',
      modelId: 'deepseek-v4-flash-free',
    });
    expect(JSON.parse(configDoctor.allowedSkillsJson ?? '[]')).toContain('zen-free-models');

    const session = await apiJson<{ id: string }>('/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'rhythm-setup',
        cwd: homedir(),
        name: 'Zen free bootstrap contract',
      }),
    });
    sessionId = session.id;

    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'Reply with exactly: zen-bootstrap-ok',
    }));
    const finished = await waitForIdle(session.id);
    ws.close();

    // Regression: an absent keyless opencode route leaves this turn in error
    // instead of producing any completed real-engine response.
    expect(finished.status).toBe('idle');
    const { messages } = await apiJson<{ messages: Array<{ role?: string; rawText?: string }> }>(
      `/agent-sessions/${session.id}/messages`,
    );
    const output = messages.find((message) => message.role === 'output')?.rawText?.trim();
    expect(output).toBe('zen-bootstrap-ok');
    console.log(output);
  }, 140_000);
});
