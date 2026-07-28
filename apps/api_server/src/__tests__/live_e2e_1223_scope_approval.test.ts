import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const DB = process.env.RHYTHM_SANDBOX_DB ?? '';
const describeLive = LIVE ? describe : describe.skip;
const configIds: string[] = [];
const proposalIds: string[] = [];

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body}`);
  return JSON.parse(body) as T;
}

function sqlite(sql: string): string {
  return execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim();
}

afterEach(() => {
  if (!DB || !isAbsolute(DB)) return;
  for (const id of proposalIds) sqlite(`DELETE FROM agent_org_proposals WHERE id = '${id}';`);
  for (const id of configIds) sqlite(`DELETE FROM agent_configs WHERE id = '${id}';`);
});

describeLive('issue-1223-c8: live broaden-scope approval', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(BASE);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '4114') {
      throw new Error(`RHYTHM_LIVE_URL must target isolated localhost port 4114, got ${BASE}`);
    }
    if (!DB || !isAbsolute(DB) || resolve(DB) !== resolve(process.env.DB_PATH ?? '') ||
        resolve(DB) !== resolve(process.env.RHYTHM_LIVE_DB_PATH ?? '')) {
      throw new Error('all live DB variables must name the same explicit sandbox copy');
    }
    expect((await fetch(`${BASE}/health`)).ok).toBe(true);
  });

  it('grants gitnexus as a server, reaches a non-measuring state, and is not reproposed', async () => {
    const config = await apiJson<{ id: string }>('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({
        label: `issue-1223-live-${Date.now()}`,
        icon: 'flow',
        allowedMcpsJson: JSON.stringify(['rhythm']),
      }),
    });
    configIds.push(config.id);

    const proposalId = randomUUID();
    proposalIds.push(proposalId);
    const changeJson = JSON.stringify({
      agentConfigId: config.id,
      field: 'allowedMcpsJson',
      add: ['gitnexus'],
    }).replace(/'/g, "''");
    const dedupKey = `broaden-scope:${config.id}:mcp:gitnexus`;
    sqlite(
      `INSERT INTO agent_org_proposals (id, kind, risk, status, title, change_json, dedup_key, created_at, updated_at) ` +
      `VALUES ('${proposalId}', 'broaden-scope', 'high', 'proposed', 'live gitnexus grant', ` +
      `'${changeJson}', '${dedupKey}', datetime('now'), datetime('now'));`,
    );

    const approved = await apiJson<{ status: string }>(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST' });
    expect(approved.status).toBe('applied');

    const after = await apiJson<{ allowedMcpsJson: string | null }>(`/agent-configs/${config.id}`);
    expect(JSON.parse(after.allowedMcpsJson ?? '[]')).toEqual(['rhythm', 'gitnexus']);

    await apiJson('/agent-org-optimizer/run', {
      method: 'POST',
      body: JSON.stringify({ maxProposalsPerRun: 1, maxLlmCallsPerRun: 0 }),
    });
    await apiJson('/agent-org-optimizer/run', {
      method: 'POST',
      body: JSON.stringify({ maxProposalsPerRun: 1, maxLlmCallsPerRun: 0 }),
    });
    expect(sqlite(`SELECT count(*) FROM agent_org_proposals WHERE dedup_key = '${dedupKey}'`)).toBe('1');
    expect(sqlite(`SELECT status FROM agent_org_proposals WHERE id = '${proposalId}'`)).toBe('applied');
  }, 120_000);
});
