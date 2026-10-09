import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import type { RerankClient } from './decision_client';
import { listDecisions } from './decision_log';
import { rankMcpAllowlist } from './tool_ranker';

const ENV = ['AGENT_DECISION_TOOL_RANKING', 'AGENT_DECISION_TOOL_EAGER_SERVERS', 'AGENT_DECISION_TOOL_MIN_SCORE'];
let saved: Record<string, string | undefined>;
let db: Database.Database;
let prev: Database.Database | null;

/** Scores keyed by a substring of the candidate text (first match wins). */
function byServer(map: Record<string, number>): { client: RerankClient; rerank: ReturnType<typeof vi.fn> } {
  const rerank = vi.fn(async (_q: string, docs: string[]) => ({
    status: 'ok' as const,
    scores: docs.map((d) => map[Object.keys(map).find((k) => d.startsWith(k))!] ?? 0),
    latencyMs: 1,
    model: 'fake',
  }));
  return { client: { rerank } as RerankClient, rerank };
}
const grant = (a: { servers: string[]; tools: string[] }) => [...a.servers, ...a.tools].sort();

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  db = new Database(':memory:');
  runMigrations(db);
  prev = setDb(db);
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setDb(prev);
  db.close();
});

const al = () => ({ servers: ['gmail', 'canva', 'github'], tools: ['vercel_list_projects', 'vercel_get_deployment', 'notion_search'] });

describe('rankMcpAllowlist', () => {
  it('off returns the same object and makes no call', async () => {
    const { client, rerank } = byServer({});
    const input = al();
    expect(await rankMcpAllowlist(input, 'send email', { client })).toBe(input);
    expect(rerank).not.toHaveBeenCalled();
  });

  it('on: reorders by score, preserves the grant set exactly', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    process.env.AGENT_DECISION_TOOL_EAGER_SERVERS = '10';
    const { client } = byServer({ github: 0.9, vercel: 0.8, gmail: 0.5, canva: 0.4, notion: 0.1 });
    const input = al();
    const before = grant(input);
    const out = await rankMcpAllowlist(input, 'deploy the repo', { client });
    expect(out.servers).toEqual(['github', 'gmail', 'canva']);
    expect(out.tools).toEqual(['vercel_list_projects', 'vercel_get_deployment', 'notion_search']);
    expect(grant(out)).toEqual(before);
    expect(out.deferredServers).toBeUndefined();
    expect(input.servers).toEqual(['gmail', 'canva', 'github']); // input not mutated
  });

  it('on: defers low scorers beyond K, unions existing, never removes grants', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    process.env.AGENT_DECISION_TOOL_EAGER_SERVERS = '2';
    process.env.AGENT_DECISION_TOOL_MIN_SCORE = '0.3';
    const { client } = byServer({ github: 0.9, vercel: 0.8, gmail: 0.5, canva: 0.1, notion: 0.05 });
    const input = { ...al(), deferredServers: ['zzz'] };
    const out = await rankMcpAllowlist(input, 'deploy', { client });
    // gmail is beyond K but scores >= min, so it stays eager.
    expect(out.deferredServers).toEqual(['zzz', 'canva', 'notion']);
    expect(grant(out)).toEqual(grant(input));
  });

  it('uses raw server names from toolCounts when deferring', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    process.env.AGENT_DECISION_TOOL_EAGER_SERVERS = '1';
    const { client } = byServer({ my_srv: 0.9, other_srv: 0.1 });
    const out = await rankMcpAllowlist({ servers: ['my_srv', 'other_srv'], tools: [] }, 'q', {
      client,
      toolCounts: { 'my.srv': 3, 'other.srv': 3 },
    });
    expect(out.deferredServers).toEqual(['other.srv']);
  });

  it('deferred-mode allowlist is untouched', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    const { client, rerank } = byServer({});
    const input = { ...al(), deferred: true as const };
    expect(await rankMcpAllowlist(input as never, 'q', { client })).toBe(input);
    expect(rerank).not.toHaveBeenCalled();
  });

  it('empty prompt / empty allowlist return input', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    const { client, rerank } = byServer({});
    const input = al();
    expect(await rankMcpAllowlist(input, '  ', { client })).toBe(input);
    const empty = { servers: [], tools: [] };
    expect(await rankMcpAllowlist(empty, 'q', { client })).toBe(empty);
    expect(rerank).not.toHaveBeenCalled();
  });

  it('shadow logs but returns the input object', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'shadow';
    process.env.AGENT_DECISION_TOOL_EAGER_SERVERS = '2';
    const { client } = byServer({ github: 0.9, vercel: 0.8, gmail: 0.5, canva: 0.4, notion: 0.1 });
    const input = al();
    expect(await rankMcpAllowlist(input, 'deploy', { client, sessionId: 's' })).toBe(input);
    const rows = listDecisions();
    expect(rows[0]).toMatchObject({ feature: 'tool_ranking', mode: 'shadow', applied: false, chosen: 'github,vercel', baseline: 'gmail,canva' });
  });

  it('failure or throwing client returns the identical object', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    const input = al();
    const failing: RerankClient = { rerank: async () => ({ status: 'timeout', reason: 't', latencyMs: 5 }) };
    expect(await rankMcpAllowlist(input, 'q', { client: failing })).toBe(input);
    const throwing: RerankClient = { rerank: async () => { throw new Error('x'); } };
    expect(await rankMcpAllowlist(input, 'q', { client: throwing })).toBe(input);
  });
});
