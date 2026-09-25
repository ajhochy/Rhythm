import { createServer, type Server } from 'http';
import { performance } from 'perf_hooks';
import { gzipSync } from 'zlib';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

const API_PORT = 7174;
const ENGINE_PORT = 7175;
const API = `http://127.0.0.1:${API_PORT}`;
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  transcriptLimits: [] as Array<number | null>,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    statusMessage: 'synthetic ready',
    ensureReady: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-1503-health' }),
    prompt: mocks.prompt,
    abortSession: vi.fn().mockResolvedValue(true),
    listMcp: vi.fn().mockResolvedValue({}),
    async listMessages(
      sessionId: string,
      directory?: string,
      options?: { limit?: number; caller?: string },
    ) {
      const query = new URLSearchParams();
      if (directory) query.set('directory', directory);
      if (options?.limit !== undefined) query.set('limit', String(options.limit));
      const response = await fetch(`${ENGINE}/session/${sessionId}/message?${query}`);
      return await response.json();
    },
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { run } from '../services/agent_runner';

const liveDescribe = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;

liveDescribe('#1503 live health-latency regression gate', () => {
  let apiServer: Server;
  let engineServer: Server;
  let payloadBytes = 0;

  beforeAll(async () => {
    const padding = 'x'.repeat(10_000);
    const transcript = Array.from({ length: 2_000 }, (_, index) => ({
      info: {
        id: `message-${index}`,
        sessionID: 'sdk-1503-health',
        role: 'assistant',
        time: { created: index },
      },
      parts: [{
        id: `part-${index}`,
        messageID: `message-${index}`,
        sessionID: 'sdk-1503-health',
        type: 'text',
        text: `${padding}-${index}`,
      }],
    }));
    const largeJson = JSON.stringify(transcript);
    payloadBytes = Buffer.byteLength(largeJson);
    const largeGzip = gzipSync(largeJson);
    const tailGzip = gzipSync(JSON.stringify(transcript.slice(-3)));
    engineServer = createServer((request, response) => {
      const url = new URL(request.url ?? '/', ENGINE);
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? null : Number(rawLimit);
      mocks.transcriptLimits.push(limit);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.setHeader('content-encoding', 'gzip');
      response.end(limit === null ? largeGzip : tailGzip);
    });
    await listen(engineServer, ENGINE_PORT);

    setDb(new Database(':memory:'));
    runMigrations(getDb());
    apiServer = createServer(createApp());
    apiServer.maxRequestsPerSocket = 1;
    await listen(apiServer, API_PORT);
  }, 30_000);

  afterAll(async () => {
    await close(apiServer);
    await close(engineServer);
  });

  it('1503-D-health-latency-regression-gate:1 keeps /health responsive during 30 seconds of transcript probing', async () => {
    expect(payloadBytes).toBeGreaterThan(19_000_000);
    mocks.transcriptLimits.length = 0;
    mocks.prompt.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      return {
        info: { id: 'final', sessionID: 'sdk-1503-health' },
        parts: [{ id: 'final-part', type: 'text', text: 'done' }],
      };
    });

    const latencies: number[] = [];
    const runPromise = run({ prompt: 'Long synthetic health gate', cwd: '/synthetic/project' });
    const pollPromise = (async () => {
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        const startedAt = performance.now();
        const response = await fetch(`${API}/health`);
        expect(response.status).toBe(200);
        await response.arrayBuffer();
        latencies.push(performance.now() - startedAt);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();

    const [result] = await Promise.all([runPromise, pollPromise]);
    expect(result.status).toBe('done');
    expect(latencies.length).toBeGreaterThanOrEqual(100);
    const sorted = [...latencies].sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    const max = sorted.at(-1)!;
    console.info(
      `[issue-1503] health samples=${latencies.length} p95Ms=${p95.toFixed(1)} maxMs=${max.toFixed(1)}`,
    );
    expect(p95).toBeLessThan(500);
    expect(max).toBeLessThan(2_000);
    expect(mocks.transcriptLimits.length).toBeGreaterThanOrEqual(25);
    expect(mocks.transcriptLimits.every((limit) => limit !== null && limit <= 3)).toBe(true);
  }, 45_000);
});

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

async function close(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}
