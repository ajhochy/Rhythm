/**
 * Live E2E for config-doctor core-permission scope patches.
 *
 * Run only against the isolated sandbox built from this branch:
 *   tools/dev/sandbox.sh up
 *   HOME=/tmp/rhythm-dev-sandbox/home DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
 *     RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
 *     RHYTHM_SANDBOX_DB=/tmp/rhythm-dev-sandbox/rhythm.db \
 *     RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *     RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *     npx vitest run src/__tests__/live_e2e_config_doctor_core_permissions.test.ts
 *   tools/dev/sandbox.sh down
 *
 * There is deliberately no proposal-create HTTP route: seed the exact stored
 * proposal payload into the sandbox copy, then drive the real public approve
 * route and observe the profile through the public config route.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const DB = process.env.RHYTHM_SANDBOX_DB ?? '';
const describeLive = LIVE ? describe : describe.skip;

let configIds: string[] = [];
let proposalIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${body}`);
  return JSON.parse(body) as T;
}

function sqlite(sql: string): void {
  execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' });
}

afterEach(() => {
  if (!DB || !isAbsolute(DB)) return;
  for (const id of proposalIds) sqlite(`DELETE FROM agent_org_proposals WHERE id = '${id}';`);
  for (const id of configIds) sqlite(`DELETE FROM agent_configs WHERE id = '${id}';`);
  proposalIds = [];
  configIds = [];
});

describeLive('live E2E — config-doctor core-permission scope approval', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!BASE) throw new Error('RHYTHM_LIVE_URL is required');
    const url = new URL(BASE);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error(`RHYTHM_LIVE_URL must target localhost, got ${url.hostname}`);
    }
    if (url.port !== '4098') throw new Error(`RHYTHM_LIVE_URL must target sandbox port 4098, got ${url.port || '(default)'}`);
    if (!DB || !isAbsolute(DB)) throw new Error('RHYTHM_SANDBOX_DB must be an explicit absolute sandbox DB path');
    const dbPath = process.env.DB_PATH;
    const declaredLiveDb = process.env.RHYTHM_LIVE_DB_PATH;
    if (!dbPath || !declaredLiveDb || resolve(DB) !== resolve(dbPath) || resolve(DB) !== resolve(declaredLiveDb)) {
      throw new Error('RHYTHM_SANDBOX_DB, DB_PATH, and RHYTHM_LIVE_DB_PATH must name the same sandbox DB');
    }
    expect((await api('/health')).ok).toBe(true);
  });

  it('approves a core-permission patch and deep-merges it through the public API', async () => {
    const created = await apiJson<{ id: string; corePermissionsJson: string | null }>('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({
        label: `e2e core permissions ${Date.now()}`,
        icon: 'verified',
        corePermissionsJson: JSON.stringify({ bash: { '*': 'ask', 'git push*': 'ask' }, webfetch: 'allow' }),
      }),
    });
    configIds.push(created.id);

    const proposalId = randomUUID();
    const changeJson = JSON.stringify({
      scopePatch: {
        agentConfigId: created.id,
        field: 'corePermissionsJson',
        set: { read: 'allow', glob: 'allow', bash: { '*': 'allow' } },
      },
    }).replace(/'/g, "''");
    sqlite(
      `INSERT INTO agent_org_proposals (id, kind, risk, status, title, change_json, dedup_key, created_at, updated_at) ` +
        `VALUES ('${proposalId}', 'refine-scope', 'high', 'proposed', 'e2e grant core permissions', ` +
        `'${changeJson}', 'config-doctor:e2e:${proposalId}', datetime('now'), datetime('now'));`,
    );
    proposalIds.push(proposalId);

    const approval = await api(`/agent-org-proposals/${proposalId}/approve`, { method: 'POST' });
    expect(approval.ok, `approve → ${approval.status}: ${await approval.text()}`).toBe(true);

    const after = await apiJson<{ corePermissionsJson: string | null }>(`/agent-configs/${created.id}`);
    expect(JSON.parse(after.corePermissionsJson ?? '{}')).toEqual({
      bash: { '*': 'allow', 'git push*': 'ask' }, webfetch: 'allow', read: 'allow', glob: 'allow',
    });
  }, 30_000);
});
