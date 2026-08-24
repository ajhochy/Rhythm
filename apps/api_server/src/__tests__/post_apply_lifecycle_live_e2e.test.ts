/** Live #1435 proof: public approval enrolls; the existing scheduler clears. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const DB = process.env.RHYTHM_SANDBOX_DB ?? '';
const configIds: string[] = [];
const proposalIds: string[] = [];

function sqlite(sql: string): string {
  return execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim();
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

afterEach(() => {
  for (const id of proposalIds) {
    sqlite(`DELETE FROM agent_org_post_apply_events WHERE proposal_id = '${id}';`);
    sqlite(`DELETE FROM agent_org_proposals WHERE id = '${id}';`);
  }
  for (const id of configIds) sqlite(`DELETE FROM agent_configs WHERE id = '${id}';`);
  proposalIds.length = 0;
  configIds.length = 0;
});

describeLive('live E2E — D2.5 post-apply lifecycle', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(BASE);
    if (url.hostname !== '127.0.0.1' || url.port !== '4098') {
      throw new Error('RHYTHM_LIVE_URL must target http://127.0.0.1:4098');
    }
    if (!DB || !isAbsolute(DB)) throw new Error('RHYTHM_SANDBOX_DB must be absolute');
    if (resolve(DB) !== resolve(process.env.DB_PATH ?? '') || resolve(DB) !== resolve(process.env.RHYTHM_LIVE_DB_PATH ?? '')) {
      throw new Error('all live DB variables must identify the sandbox database');
    }
    expect((await api('/health')).ok).toBe(true);
  });

  it('public profile approval enrolls once and the scheduler clears the expired event', async () => {
    const configResponse = await api('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({ label: `D2.5 live ${Date.now()}`, icon: 'verified', modelProvider: 'anthropic', modelId: 'before' }),
    });
    expect(configResponse.ok).toBe(true);
    const config = await configResponse.json() as { id: string };
    configIds.push(config.id);

    const proposalId = randomUUID();
    proposalIds.push(proposalId);
    const changeJson = JSON.stringify({
      configPatch: { agentConfigId: config.id, field: 'model', value: 'anthropic/after' },
    }).replaceAll("'", "''");
    sqlite(
      `INSERT INTO agent_org_proposals (id, kind, risk, status, title, target_ref, change_json, dedup_key, created_at, updated_at) ` +
      `VALUES ('${proposalId}', 'refine-config', 'high', 'proposed', 'D2.5 live apply', 'profile:${config.id}', ` +
      `'${changeJson}', 'd2.5-live:${proposalId}', datetime('now'), datetime('now'));`,
    );

    const approval = await api(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST' });
    expect(approval.ok, `approve returned ${approval.status}: ${await approval.text()}`).toBe(true);
    expect(Number(sqlite(`SELECT COUNT(*) FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`))).toBe(1);
    expect(sqlite(`SELECT status FROM agent_org_proposals WHERE id = '${proposalId}';`)).toBe('measuring');

    sqlite(
      `UPDATE agent_org_post_apply_events SET monitoring_window_end = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second') ` +
      `WHERE proposal_id = '${proposalId}';`,
    );
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline && sqlite(`SELECT guardrail_status FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`) !== 'clear') {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    }
    expect(sqlite(`SELECT guardrail_status FROM agent_org_post_apply_events WHERE proposal_id = '${proposalId}';`)).toBe('clear');
    expect(sqlite(`SELECT status FROM agent_org_proposals WHERE id = '${proposalId}';`)).toBe('active');
  }, 90_000);
});
