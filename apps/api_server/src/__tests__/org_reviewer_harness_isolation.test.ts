/** The isolation preflight reads engine config before any fixture mutation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, ENGINE, guard, LOCAL_REVIEWER_MCP_ENTRYPOINT, ReviewerHarness } from './org_reviewer_harness';

const privateToken = 'synthetic-secret-must-never-appear-in-errors';
let config: Record<string, any>;
let requests: Array<{ url: string; method: string }>;

beforeEach(() => {
  vi.stubEnv('RHYTHM_LIVE_E2E_ISOLATED', '1');
  vi.stubEnv('DB_PATH', '/private/tmp/org-reviewer-isolation-unit-fixture.db');
  requests = [];
  config = { mcp: { rhythm: {
    type: 'local', command: ['node', LOCAL_REVIEWER_MCP_ENTRYPOINT],
    environment: { RHYTHM_API_URL: API, RHYTHM_AGENT_URL: API, RHYTHM_API_TOKEN: privateToken },
  } } };
  // Only external, read-only preflight responses are supplied. The real
  // harness setup runs; any attempted fixture mutation fails this test.
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method });
    if (method !== 'GET') throw new Error('Fixture mutation reached before isolation was established');
    if (url === `${API}/opencode/health`) return Response.json({ status: 'ready' });
    if (url === `${ENGINE}/global/health`) return Response.json({ healthy: true });
    if (url === `${ENGINE}/global/config`) return Response.json(config);
    throw new Error('Unexpected request during isolation preflight');
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Org Reviewer live harness MCP isolation', () => {
  it('accepts only the actual sandbox URLs and this checkout\'s built MCP command', async () => {
    await expect(guard()).resolves.toBeUndefined();
    expect(requests).toContainEqual({ url: `${ENGINE}/global/config`, method: 'GET' });
  });

  it.each([
    ['RHYTHM_AGENT_URL', 'http://localhost:4001'],
    ['RHYTHM_API_URL', 'https://api.example.invalid'],
    ['RHYTHM_AGENT_URL', undefined],
    ['RHYTHM_AGENT_URL', `http://${privateToken}@127.0.0.1:4098`],
  ])('stops setup before mutations when actual MCP %s escapes isolation', async (key, value) => {
    config.mcp.rhythm.environment[key] = value;
    let failure: unknown;
    try { await new ReviewerHarness().setup(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(`sandbox Rhythm MCP ${key}`);
    expect(String(failure)).not.toContain(privateToken);
    expect(requests).toEqual([
      { url: `${API}/opencode/health`, method: 'GET' },
      { url: `${ENGINE}/global/health`, method: 'GET' },
      { url: `${ENGINE}/global/config`, method: 'GET' },
    ]);
  });

  it('refuses a remote or published-package MCP instead of testing another build', async () => {
    config.mcp.rhythm.command = ['npx', '-y', '@ajhochy/rhythm-mcp-server'];
    await expect(new ReviewerHarness().setup()).rejects.toThrow('built local entrypoint');
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });
});
