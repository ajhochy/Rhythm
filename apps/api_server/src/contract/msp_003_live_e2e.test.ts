/**
 * Env-gated live behavioral contract for MSP-003.
 *
 * This must be run by the integrator against the rebuilt fork + api_server in
 * an isolated sandbox. It deliberately refuses the shipping ports and is
 * skipped during the normal Vitest suite.
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * npx vitest run src/contract/msp_003_live_e2e.test.ts --no-file-parallelism
 */
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { assertLiveE2EIsolation } from '../__tests__/_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4001';
const createdAgentIds: string[] = [];
const createdSessionIds: string[] = [];

type Interaction = {
  id: string;
  kind: 'permission' | 'question';
  status: 'pending' | 'resolved' | 'failed';
  sessionId: string;
  sdkSessionId: string;
  callId: string | null;
  payload: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  error: { message: string; retryable: boolean } | null;
};

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) as T : undefined as T;
}

async function openWs(): Promise<{
  ws: WebSocket;
  frames: Array<Record<string, unknown>>;
}> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  const frames: Array<Record<string, unknown>> = [];
  ws.on('message', (raw) => {
    try {
      frames.push(JSON.parse(String(raw)) as Record<string, unknown>);
    } catch {
      // Ignore non-JSON transport noise.
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, frames };
}

async function poll<T>(
  operation: () => T | Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error(`${label} timed out: ${String(last)}`);
}

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) {
    await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdAgentIds.splice(0)) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
});

describeLive('MSP-003 live shared pending interaction continuation', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (BASE.includes(':4001') || BASE.includes(':4096')) {
      throw new Error('MSP-003 live test refuses shipping API/engine ports');
    }
    expect((await api('/health')).ok).toBe(true);
    expect((await apiJson<{ status: string }>('/opencode/health')).status).toBe('ready');
  });

  it(
    'issue-3-c11: real engine continuation resolves through dedicated interaction endpoints',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const profileId = `msp-003-live-${suffix}`;
      const profile = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: profileId,
          label: `MSP-003 live ${suffix}`,
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          ocAgent: profileId,
          modelProvider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'openrouter',
          modelId:
            process.env.RHYTHM_LIVE_MODEL_ID || 'anthropic/claude-haiku-4.5',
          corePermissionsJson: JSON.stringify({ question: 'allow' }),
          systemPrompt:
            'When the user says ASK, call the question tool exactly once with ' +
            'header "Protocol", question "Choose a color", options Blue and Green. ' +
            'After the dedicated question reply resolves, write exactly CONTINUED_BLUE. ' +
            'Never treat a normal user prompt as the question answer.',
        }),
      });
      createdAgentIds.push(profile.id);
      await apiJson('/system/refresh', { method: 'POST' });

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: profile.id,
          name: `MSP-003 live ${suffix}`,
          cwd: process.env.RHYTHM_LIVE_SESSION_CWD ?? homedir(),
        }),
      });
      createdSessionIds.push(session.id);

      const first = await openWs();
      first.ws.send(JSON.stringify({
        v: 1,
        type: 'session.input',
        id: session.id,
        data: 'ASK',
      }));
      const pending = await poll(
        () => {
          const update = first.frames.find((frame) => {
            const interaction = frame.interaction as Interaction | undefined;
            return frame.type === 'interaction.updated' &&
              interaction?.sessionId === session.id &&
              interaction.kind === 'question' &&
              interaction.status === 'pending';
          });
          const interaction = update?.interaction as Interaction | undefined;
          if (!interaction) throw new Error('question pending interaction not observed');
          return interaction;
        },
        90_000,
        'question.asked canonical event',
      );
      first.ws.close();

      // A client that attaches after question.asked must receive the same stable
      // request ID in its initial snapshot, without waiting for a new event.
      const late = await openWs();
      const snapshotted = await poll(
        () => {
          const snapshot = late.frames.find((frame) => frame.type === 'sessions.list');
          const interactions = snapshot?.pendingInteractions as Interaction[] | undefined;
          const found = interactions?.find((item) => item.id === pending.id);
          if (!found) throw new Error('late attach snapshot missing question');
          return found;
        },
        10_000,
        'late attach pending snapshot',
      );
      expect(snapshotted).toEqual(pending);

      // Race two desktop-shaped answers. The server must serialize them around
      // one engine reply and return the exact same authoritative terminal state
      // to both callers rather than turning the loser into an error card.
      const resolutionPath =
        `/agent-sessions/${session.id}/question/${encodeURIComponent(pending.id)}/reply`;
      const [one, two] = await Promise.all([
        api(resolutionPath, {
          method: 'POST',
          body: JSON.stringify({ answers: [['Blue']] }),
        }),
        api(resolutionPath, {
          method: 'POST',
          body: JSON.stringify({ answers: [['Green']] }),
        }),
      ]);
      expect(one.status).toBe(200);
      expect(two.status).toBe(200);
      const [winner, loser] = await Promise.all([
        one.json() as Promise<Interaction>,
        two.json() as Promise<Interaction>,
      ]);
      expect(loser).toEqual(winner);
      expect(winner).toMatchObject({
        id: pending.id,
        kind: 'question',
        status: 'resolved',
        resolution: { action: 'reply', source: 'desktop' },
      });

      await poll(
        async () => {
          const messages = await apiJson<{
            messages: Array<{ rawText?: string; parts?: Array<{ text?: string }> }>;
          }>(`/agent-sessions/${session.id}/messages?limit=200`);
          const transcript = messages.messages
            .flatMap((message) => [
              message.rawText ?? '',
              ...(message.parts ?? []).map((part) => part.text ?? ''),
            ])
            .join('\n');
          if (!transcript.includes('CONTINUED_BLUE')) {
            throw new Error('engine has not continued with the winning answer');
          }
          return transcript;
        },
        120_000,
        'real engine continuation',
      );
      late.ws.close();
    },
    300_000,
  );
});
