import { createServer, type Server } from 'http';
import { monitorEventLoopDelay } from 'perf_hooks';
import { gzipSync } from 'zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PORT = 7173;
const ENGINE = `http://127.0.0.1:${PORT}`;

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  requests: [] as Array<{ limit: number | null; caller: string | null }>,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    ensureReady: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-1503' }),
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
      if (options?.caller) query.set('caller', options.caller);
      const response = await fetch(`${ENGINE}/session/${sessionId}/message?${query}`);
      return await response.json();
    },
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { run } from '../services/agent_runner';

function message(index: number, text = `assistant-${index}`) {
  return {
    info: {
      id: `message-${index}`,
      sessionID: 'sdk-1503',
      role: 'assistant',
      time: { created: index },
    },
    parts: [{ id: `part-${index}`, messageID: `message-${index}`, sessionID: 'sdk-1503', type: 'text', text }],
  };
}

describe('#1503 bounded AgentRunner transcript reads', () => {
  let server: Server;
  let largePayloadBytes = 0;
  const latestText = 'latest bounded assistant text';

  beforeAll(async () => {
    const padding = 'x'.repeat(10_000);
    const transcript = Array.from({ length: 2_000 }, (_, index) => message(index, `${padding}-${index}`));
    const largeJson = JSON.stringify(transcript);
    largePayloadBytes = Buffer.byteLength(largeJson);
    const largeGzip = gzipSync(largeJson);
    const tailGzip = gzipSync(JSON.stringify([message(1_999, latestText)]));
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', ENGINE);
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? null : Number(rawLimit);
      mocks.requests.push({ limit, caller: url.searchParams.get('caller') });
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.setHeader('content-encoding', 'gzip');
      response.end(limit === null ? largeGzip : tailGzip);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '127.0.0.1', () => resolve());
    });
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requests.length = 0;
  });

  afterEach(() => {
    delete process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS;
    delete process.env.AGENT_RUN_HARD_TIMEOUT_MS;
  });

  it('1503-B-bounded-agentrunner-activity-probe:1 keeps every recurring probe at limit <= 3 and event-loop p99 below 100 ms', async () => {
    expect(largePayloadBytes).toBeGreaterThan(19_000_000);
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    mocks.prompt.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return { info: { id: 'final', sessionID: 'sdk-1503' }, parts: [{ type: 'text', text: 'done' }] };
    });

    const result = await run({ prompt: 'Probe a long turn', cwd: '/synthetic/project' });
    histogram.disable();

    expect(result).toMatchObject({ status: 'done', result: 'done' });
    expect(mocks.requests.length).toBeGreaterThanOrEqual(8);
    expect(mocks.requests.every((request) => request.limit !== null && request.limit <= 3)).toBe(true);
    expect(mocks.requests.every((request) => request.caller === 'agent_runner.activity_probe')).toBe(true);
    expect(histogram.percentile(99) / 1_000_000).toBeLessThan(100);
  }, 20_000);

  it('1503-B-bounded-agentrunner-activity-probe:2 bounds timeout recovery and retains the last assistant text', async () => {
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '500';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '5000';
    mocks.prompt.mockReturnValue(new Promise(() => {}));

    const result = await run({ prompt: 'Timeout with partial output', cwd: '/synthetic/project' });

    expect(result.status).toBe('error');
    expect(result.result).toBe(latestText);
    expect(mocks.requests).toContainEqual({ limit: 3, caller: 'agent_runner.timeout_recovery' });
    expect(mocks.requests.every((request) => request.limit !== null && request.limit <= 3)).toBe(true);
  });

  it('1503-B-bounded-agentrunner-activity-probe:3 bounds the empty-parts final-text fallback', async () => {
    mocks.prompt.mockResolvedValue({ info: { id: 'final', sessionID: 'sdk-1503' }, parts: [] });

    const result = await run({ prompt: 'Use final transcript text', cwd: '/synthetic/project' });

    expect(result).toMatchObject({ status: 'done', result: latestText });
    expect(mocks.requests).toEqual([
      { limit: 3, caller: 'agent_runner.final_text_fallback' },
    ]);
  });
});
