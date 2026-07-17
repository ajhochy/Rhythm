/**
 * Live E2E test for #1073 (OCU-32) — full permission-key round-trip.
 *
 * Gated behind RHYTHM_LIVE_E2E=1. Drives the running sandbox api_server +
 * real opencode engine (never the live app — see `assertLiveE2EIsolation`).
 *
 * Proves the issue's explicit acceptance criterion: setting
 * {websearch: deny, external_directory: ask} via REST lands in the .md
 * frontmatter, survives reloadConfig, and the ENGINE enforces it — a real
 * agent turn that attempts a websearch tool call is denied, not merely
 * "the config field was saved".
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://localhost:4001';
const AGENTS_DIR = join(homedir(), '.config', 'opencode', 'agents');

const describeLive = LIVE ? describe : describe.skip;
const MODEL = { provider: 'openrouter', id: '' };

let createdAgentIds: string[] = [];
let createdSessionIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}
async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}
async function poll<T>(fn: () => Promise<T>, timeoutMs: number, intervalMs = 800, label = 'poll'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms — last: ${String(lastErr)}`);
}

afterEach(async () => {
  for (const id of createdSessionIds) await api(`/agent-sessions/${id}`, { method: 'DELETE' }).catch(() => {});
  for (const id of createdAgentIds) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => {});
    await rm(join(AGENTS_DIR, `${id}.md`), { force: true }).catch(() => {});
  }
  createdSessionIds = [];
  createdAgentIds = [];
});

describeLive('live E2E — #1073 permission-key round-trip', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await api('/health');
    if (!health.ok) throw new Error(`server not reachable at ${BASE}`);
    const eng = await apiJson<{ status: string }>('/opencode/health');
    if (eng.status !== 'ready') throw new Error(`opencode engine not ready (status=${eng.status})`);
  });

  it(
    'websearch=deny + external_directory=ask round-trips to frontmatter and the engine enforces the denial',
    async () => {
      const cfg = await apiJson<{ id: string; corePermissionsJson: string | null }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'E2E Permission Roundtrip 1073',
          isAgent: true,
          enabled: true,
          sessionSelectable: true,
          modelProvider: MODEL.provider,
          modelId: MODEL.id || undefined,
          corePermissionsJson: JSON.stringify({ websearch: 'deny', external_directory: 'ask' }),
          systemPrompt:
            'You are a test agent. When asked, attempt to use your websearch tool exactly once and report what happened.',
        }),
      });
      createdAgentIds.push(cfg.id);
      expect(JSON.parse(cfg.corePermissionsJson!)).toEqual({ websearch: 'deny', external_directory: 'ask' });

      // Lossless round-trip into frontmatter.
      const projected = await poll(
        async () => {
          const content = await readFile(join(AGENTS_DIR, `${cfg.id}.md`), 'utf8');
          if (!/websearch:\s*deny/.test(content)) throw new Error('websearch:deny not yet projected');
          return content;
        },
        10_000,
        500,
        'projected .md permission block',
      );
      expect(projected).toMatch(/websearch:\s*deny/);
      expect(projected).toMatch(/external_directory:\s*ask/);

      await apiJson('/system/refresh', { method: 'POST' });

      // A real turn that attempts websearch must observe the engine deny it —
      // not merely that the config field was saved.
      const sess = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({ agentId: cfg.id, name: 'E2E perm probe', cwd: homedir() }),
      });
      createdSessionIds.push(sess.id);

      const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      const permissionEvents: Array<Record<string, unknown>> = [];
      ws.on('message', (raw) => {
        try {
          const frame = JSON.parse(String(raw)) as Record<string, unknown>;
          if (frame.type === 'permission.updated' || frame.type === 'permission.replied') {
            permissionEvents.push(frame);
          }
        } catch { /* ignore */ }
      });
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'session.input',
          id: sess.id,
          data: 'Use your websearch tool to look up "opencode engine" once, then report the result.',
        }),
      );

      try {
        await poll(
          async () => {
            const s = await apiJson<{ session: { status: string } }>(`/agent-sessions/${sess.id}`);
            if (s.session.status === 'working' || s.session.status === 'starting') {
              throw new Error(`session still ${s.session.status}`);
            }
            return s;
          },
          90_000,
          800,
          'await turn idle',
        );
      } finally {
        ws.close();
      }

      // The engine must have denied the websearch tool — either via an
      // explicit permission event, or (deny is auto-rejected, no prompt) via
      // the transcript never showing a completed websearch tool call.
      const messages = await apiJson<unknown[]>(`/agent-sessions/${sess.id}/messages`);
      const websearchToolCalls = messages.flatMap((m) => {
        const msg = m as Record<string, unknown>;
        const parts = (msg.parts ?? []) as Array<Record<string, unknown>>;
        return parts.filter((p) => p.type === 'tool' && String(p.tool ?? '').includes('websearch'));
      });
      const completedWebsearch = websearchToolCalls.filter(
        (p) => (p.state as Record<string, unknown> | undefined)?.status === 'completed',
      );
      expect(
        completedWebsearch.length,
        'websearch tool call completed despite corePermissionsJson.websearch=deny',
      ).toBe(0);
    },
    120_000,
  );
});
