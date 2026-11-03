/** Real API + fork + local synthetic model transport; never runs in the normal suite. */
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { startC1Provider } from './_c1_synthetic_provider';

const live = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const API = 'http://127.0.0.1:4098';
const ENGINE = 'http://127.0.0.1:4097';

async function json<T>(base: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

async function until<T>(read: () => Promise<T | undefined> | T | undefined, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Installed WS profile identity did not converge');
}

live('installed WebSocket profile identity through real API and engine', () => {
  it('dispatches bound and explicitly selected profiles sharing disabled build alias, and denies disabled selection', async () => {
    assertLiveE2EIsolation();
    const sb = process.env.RHYTHM_SANDBOX_DIR ?? '';
    expect(sb).toMatch(/^\/private\/tmp\/rhythm-/);
    expect(realpathSync(sb)).toBe(sb);
    expect(resolve(process.env.DB_PATH ?? '')).toBe(join(sb, 'rhythm.db'));
    expect(await json<{ status: string }>(API, '/opencode/health')).toMatchObject({ status: 'ready' });

    const provider = await startC1Provider();
    const nonce = randomUUID();
    const providerId = `synthetic-ws-${nonce}`;
    const boundId = `synthetic-ws-bound-${nonce}`;
    const selectedId = `synthetic-ws-selected-${nonce}`;
    const blockedId = `synthetic-ws-blocked-${nonce}`;
    const createdProfiles: string[] = [];
    let insertedReservedBuild = false;
    const sessionIds: string[] = [];
    let socket: WebSocket | undefined;
    try {
      await json(ENGINE, '/global/config', 'PATCH', { provider: { [providerId]: {
        npm: '@ai-sdk/anthropic', options: { apiKey: 'synthetic-only', baseURL: `${provider.origin}/v1` },
        models: { text: { name: 'Synthetic WS profile text', attachment: false,
          modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000, output: 1000 } } },
      } } });
      await json(API, `/opencode/auth/${providerId}`, 'POST', { apiKey: 'synthetic-only' });
      await json(API, '/system/refresh', 'POST');
      // `build` is a protected config ID at the public create route. Seed that
      // one collision row only in this guard-verified throwaway DB; all user
      // behavior below still travels through real HTTP/WS/engine surfaces.
      {
        const db = new Database(join(sb, 'rhythm.db'));
        try {
          expect(db.prepare("SELECT id FROM agent_configs WHERE id = 'build'").get()).toBeUndefined();
          setDb(db);
          new AgentConfigsRepository().insert({ id: 'build', label: 'Disabled built-in fixture', icon: 'flask',
            enabled: false, isAgent: true, ocAgent: 'build' });
          insertedReservedBuild = true;
        } finally { db.close(); }
      }
      for (const [id, enabled] of [[boundId, true], [selectedId, true], [blockedId, false]] as const) {
        await json(API, '/agent-configs', 'POST', { id, label: `Synthetic WS ${id}`, icon: 'flask',
          enabled, isAgent: true, sessionSelectable: enabled, ocAgent: 'build',
          modelProvider: providerId, modelId: 'text', allowedMcpsJson: '[]', allowedSkillsJson: '[]',
          corePermissionsJson: '{"*":"deny"}', systemPrompt: 'Reply only with the requested C1 marker. Never use tools.' });
        createdProfiles.push(id);
      }
      const frames: Array<Record<string, unknown>> = [];
      socket = await new Promise<WebSocket>((resolveOpen, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:4098/ws/agents', { origin: 'rhythm://app' });
        ws.on('message', raw => { try { frames.push(JSON.parse(String(raw)) as Record<string, unknown>); } catch { /* only JSON protocol frames matter */ } });
        ws.once('open', () => resolveOpen(ws));
        ws.once('error', reject);
      });
      for (const [marker, extra] of [
        [`C1-${randomUUID()}`, {}],
        [`C1-${randomUUID()}`, { profileId: selectedId, agent: 'build' }],
      ] as const) {
        // The synthetic provider reads a marker from the entire prompt history.
        // Use one session per case so an earlier turn cannot shadow this marker.
        const session = await json<{ id: string }>(API, '/agent-sessions', 'POST', {
          name: `Synthetic WS ${nonce}`, profileId: boundId, cwd: sb, isolateWorktree: false,
        });
        const sessionId = session.id;
        sessionIds.push(sessionId);
        socket.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: `Reply exactly ${marker}. Never use tools.`, ...extra }));
        await until(() => provider.holds.get(marker)?.state === 'held' ? true : undefined);
        expect(provider.holds.get(marker)?.requests).toBe(1);
        await fetch(`${provider.origin}/c1/holds/${marker}/release`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
        await until(async () => {
          const result = await json<{ messages: Array<{ role?: string; strippedText?: string }> }>(API, `/agent-sessions/${sessionId}/messages`);
          return result.messages.some(message => message.role === 'output' && message.strippedText?.includes(marker)) ? true : undefined;
        });
      }
      const sessionId = sessionIds.at(-1)!;
      socket.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId,
        data: 'This disabled profile must never dispatch.', profileId: blockedId, agent: 'build' }));
      const denied = await until(() => frames.find(frame => frame.type === 'error' && frame.id === sessionId));
      expect(String(denied.message)).toContain('disabled');
      expect([...provider.holds.values()].reduce((sum, hold) => sum + hold.requests, 0)).toBe(2);
      expect((await json<{ messages: unknown[] }>(API, `/agent-sessions/${sessionId}/messages`)).messages.length).toBeGreaterThanOrEqual(2);
    } finally {
      socket?.close();
      for (const sessionId of sessionIds.reverse()) await json(API, `/agent-sessions/${sessionId}/hard`, 'DELETE').catch(() => undefined);
      for (const id of createdProfiles.reverse()) await json(API, `/agent-configs/${id}`, 'DELETE').catch(() => undefined);
      if (insertedReservedBuild) {
        const db = new Database(join(sb, 'rhythm.db'));
        try { db.prepare("DELETE FROM agent_configs WHERE id = 'build'").run(); } finally { db.close(); }
      }
      await provider.close();
    }
  }, 180_000);
});
