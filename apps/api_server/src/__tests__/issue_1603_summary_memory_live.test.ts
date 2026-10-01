/** Real API + fork regression. Only synthetic data inside an owned dev sandbox. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const SB = process.env.RHYTHM_SANDBOX_DIR ?? '';
const MARKER = 'SUMMARY_1603_SYNTHETIC_REPLY';
type Diff = { file?: string; patch?: string; patchOmitted?: string; additions: number; deletions: number };

async function json<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(base + path, {
    ...init, signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return await response.json() as T;
}

async function poll<T>(read: () => Promise<T | undefined>, timeout = 60_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Summary convergence timed out');
}

function stream(model: string): string {
  const events = [
    { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: MARKER } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 20, output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

live('issue-1603 real sandbox summary memory', () => {
  beforeAll(() => {
    assertLiveE2EIsolation();
    if (!SB || realpathSync(SB) !== SB || !SB.startsWith('/private/tmp/') ||
        resolve(process.env.DB_PATH ?? '') !== join(SB, 'rhythm.db')) {
      throw new Error('Requires a canonical owned /private/tmp sandbox and its exact synthetic DB');
    }
    for (const base of [API, ENGINE]) {
      const url = new URL(base);
      if (url.hostname !== '127.0.0.1' || ['4000', '4001', '4002', '4096'].includes(url.port)) {
        throw new Error('Refusing a live application or non-loopback endpoint');
      }
    }
  });

  it('issue-1603-c5: real turn retains bounded diffs, correct counts, and responsive health', async () => {
    const project = mkdtempSync(join(SB, 'summary-1603-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: project, stdio: 'pipe' });
    git('init', '-q');
    const normal = Array.from({ length: 16 }, (_, i) => `normal-${String(i).padStart(2, '0')}.txt`);
    const content = 'unchanged content row\n'.repeat(4_800);
    for (const name of normal) writeFileSync(join(project, name), content + 'before\n');
    writeFileSync(join(project, 'oversized.txt'), 'large unchanged content\n'.repeat(25_000) + 'before\n');
    writeFileSync(join(project, '000-small.txt'), 'before\n');
    git('add', '.');
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic baseline');

    const id = `summary-1603-${randomUUID().slice(0, 8)}`;
    const model = 'synthetic-summary';
    let provider: Server | undefined;
    let socket: WebSocket | undefined;
    let profile: { id: string } | undefined;
    let session: { id: string; sdkSessionId: string } | undefined;
    let original: Record<string, unknown> | undefined;
    let requests = 0;
    let stopProbes = false;
    let probes: Promise<void> | undefined;
    let peakRssKiB = 0;
    const latencies: number[] = [];
    const healthErrors: string[] = [];
    try {
      const enginePid = Number(execFileSync('lsof', ['-tiTCP:' + new URL(ENGINE).port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim());
      expect(Number.isSafeInteger(enginePid) && enginePid > 1).toBe(true);
      probes = (async () => {
        while (!stopProbes) {
          const start = performance.now();
          try {
            await json(API, '/health');
            await json(ENGINE, '/global/health');
            latencies.push(performance.now() - start);
            const rss = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(enginePid)], { encoding: 'utf8', timeout: 2_000 }).trim());
            peakRssKiB = Math.max(peakRssKiB, rss);
          } catch (error) { healthErrors.push(String(error)); }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      })();
      provider = createServer(async (request, response) => {
        request.resume();
        if (request.method !== 'POST' || !request.url?.endsWith('/messages')) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ data: [] }));
          return;
        }
        requests++;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const [start, ...rest] = stream(model).split('\n\n');
        response.write(start + '\n\n');
        try {
          // Provider discovery can contact this endpoint before a turn starts.
          // Mutate only after the real processor has persisted its baseline.
          await poll(async () => {
            if (!session) return;
            const rows = await json<Array<{ parts: Array<{ type: string; snapshot?: string }> }>>(ENGINE,
              `/session/${session.sdkSessionId}/message?directory=${encodeURIComponent(project)}`);
            return rows.some(row => row.parts.some(part => part.type === 'step-start' && part.snapshot)) ? true : undefined;
          }, 10_000);
          for (const name of normal) writeFileSync(join(project, name), content + 'after\n');
          writeFileSync(join(project, 'oversized.txt'), 'large unchanged content\n'.repeat(25_000) + 'after\n');
          writeFileSync(join(project, '000-small.txt'), 'after\n');
          response.end(rest.join('\n\n'));
        } catch (error) { response.destroy(error as Error); }
      });
      await new Promise<void>(resolve => provider!.listen(0, '127.0.0.1', resolve));
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('Synthetic provider failed to bind');
      original = await json(ENGINE, '/global/config');
      const config = structuredClone(original) as { provider?: Record<string, unknown> };
      config.provider = { ...config.provider, [id]: { npm: '@ai-sdk/anthropic', name: 'Synthetic summary provider',
        options: { apiKey: 'synthetic-only', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: { [model]: { name: model, limit: { context: 200_000, output: 1_000 } } } } };
      await json(ENGINE, '/global/config', { method: 'PATCH', body: JSON.stringify(config) });
      await json(API, '/system/refresh', { method: 'POST' });
      profile = await json(API, '/agent-configs', { method: 'POST', body: JSON.stringify({
        id, label: 'Synthetic memory regression', isAgent: true, modelProvider: id, modelId: model,
        systemPrompt: 'Return the response supplied by the synthetic provider.',
      }) });
      session = await json(API, '/agent-sessions', { method: 'POST', body: JSON.stringify({
        agentId: profile!.id, cwd: project, name: 'Synthetic bounded summary', permissionMode: 'default',
      }) });
      socket = new WebSocket(API.replace(/^http/, 'ws') + '/ws/agents');
      await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
      socket.send(JSON.stringify({ v: 1, type: 'session.input', id: session!.id,
        data: 'Respond with the synthetic reply.', modelOverride: { providerId: id, modelId: model } }));
      const directory = `directory=${encodeURIComponent(project)}`;
      const diffs = await poll(async () => {
        const rows = await json<Diff[]>(ENGINE, `/session/${session!.sdkSessionId}/diff?${directory}`);
        return rows.length === 18 ? rows : undefined;
      });
      expect(requests).toBeGreaterThan(0);
      expect(diffs.every(diff => diff.additions === 1 && diff.deletions === 1)).toBe(true);
      expect(diffs.find(diff => diff.file === 'oversized.txt')?.patchOmitted).toBe('file_too_large');
      expect(diffs.some(diff => diff.patchOmitted === 'total_budget_exceeded')).toBe(true);
      expect(diffs.find(diff => diff.file === '000-small.txt')?.patch).toContain('+after');
      const patchBytes = diffs.reduce((sum, diff) => sum + Buffer.byteLength(diff.patch ?? ''), 0);
      expect(patchBytes).toBeLessThanOrEqual(1_048_576);
      await poll(async () => {
        const result = await json<{ messages: Array<{ parts?: Array<{ type: string; text?: string }> }> }>(API,
          `/agent-sessions/${session!.id}/messages`);
        return result.messages.some(message => message.parts?.some(part => part.type === 'text' && part.text?.includes(MARKER))) ? true : undefined;
      });
      stopProbes = true;
      await probes;
      expect(healthErrors).toEqual([]);
      expect(latencies.length).toBeGreaterThan(0);
      expect(Math.max(...latencies)).toBeLessThan(5_000);
      expect(peakRssKiB).toBeGreaterThan(0);
      expect(peakRssKiB).toBeLessThan(2 * 1024 * 1024);
      const receipt = { receipt: 'issue-1603-live', files: diffs.length, patchBytes,
        omitted: diffs.filter(diff => diff.patchOmitted).length, peakRssKiB, healthSamples: latencies.length,
        maxHealthMs: Math.round(Math.max(...latencies)), requests };
      writeFileSync(join(SB, 'summary-memory-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
      console.info(JSON.stringify(receipt));
    } finally {
      stopProbes = true;
      await probes;
      socket?.terminate();
      if (session) await fetch(`${API}/agent-sessions/${session.id}`, { method: 'DELETE' });
      if (profile) await fetch(`${API}/agent-configs/${profile.id}`, { method: 'DELETE' });
      if (original) await json(ENGINE, '/global/config', { method: 'PATCH', body: JSON.stringify(original) });
      if (provider) { provider.closeAllConnections(); await new Promise<void>(resolve => provider!.close(() => resolve())); }
      // The sandbox owns this uniquely created repository and removes it at teardown.
    }
  }, 120_000);
});
