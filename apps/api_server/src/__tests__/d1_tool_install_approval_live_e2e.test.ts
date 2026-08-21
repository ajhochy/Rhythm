/** D1.4 live contract: a durable safe report authorizes the real HTTP route. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../services/org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../models/guardrail_registry';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const DB = process.env.RHYTHM_SANDBOX_DB ?? '';
const proposalIds: string[] = [];
const configIds: string[] = [];

function sqlite(sql: string): string {
  return execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim();
}

function sqlText(value: string): string {
  return value.replaceAll("'", "''");
}

function fingerprint(proposalId: string, change: { toolName: string; packageSource: string; installMethod: string; testPrompts: string[] }): string {
  return createHash('sha256').update(JSON.stringify({
    proposalId, toolName: change.toolName, packageSource: change.packageSource,
    installMethod: change.installMethod, scenarioIds: [...change.testPrompts].sort(),
  })).digest('hex');
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body}`);
  return JSON.parse(body) as T;
}

afterEach(() => {
  for (const id of proposalIds) {
    sqlite(`DELETE FROM tool_safety_reports WHERE proposal_id = '${id}';`);
    sqlite(`DELETE FROM agent_org_proposals WHERE id = '${id}';`);
  }
  for (const id of configIds) sqlite(`DELETE FROM agent_configs WHERE id = '${id}';`);
  proposalIds.length = 0;
  configIds.length = 0;
});

describeLive('D1.4 live tool-install approval gate', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const url = new URL(BASE);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || ['4000', '4001', ''].includes(url.port)) {
      throw new Error('RHYTHM_LIVE_URL must target an explicit isolated localhost sandbox port');
    }
    if (!DB || !isAbsolute(DB) || resolve(DB) !== resolve(process.env.DB_PATH ?? '') || resolve(DB) !== resolve(process.env.RHYTHM_LIVE_DB_PATH ?? '')) {
      throw new Error('all live DB variables must identify the same explicit sandbox database');
    }
    expect((await fetch(`${BASE}/health`)).ok).toBe(true);
  });

  it('accepts a persisted matching safe report through the running API, not client verdict fields', async () => {
    const config = await api<{ id: string; revision: number; systemPrompt: string | null }>('/agent-configs', {
      method: 'POST', body: JSON.stringify({ label: `D1.4 live ${Date.now()}`, icon: 'shield', systemPrompt: 'test' }),
    });
    configIds.push(config.id);
    const proposalId = randomUUID();
    proposalIds.push(proposalId);
    const change = {
      toolName: 'example-tool', packageSource: 'npm:example-tool', installMethod: 'npm install', agentConfigId: config.id,
      testPrompts: ['version-check', 'help-check'],
      evidenceBundle: {
        version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
        sourceEvidence: { sessionIds: ['live-session'], eventIds: [] },
        counterEvidenceSearch: { query: 'live tool install', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
        target: { ref: toProfileTargetRef(config.id), hash: buildProfileRevisionFingerprint(config) },
        expectedOutcome: 'improve scheduling', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
        guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count', rollbackRule: 'revoke', generatorVersion: 'd1-live', confidenceCalibrationVersion: 'uncalibrated',
      },
    };
    const changeJson = JSON.stringify(change);
    sqlite(
      `INSERT INTO agent_org_proposals (id, kind, risk, status, title, change_json, created_at, updated_at) VALUES ` +
      `('${proposalId}', 'tool-install', 'high', 'proposed', 'D1.4 live tool install', '${sqlText(changeJson)}', datetime('now'), datetime('now'));`,
    );
    const proposalFingerprint = fingerprint(proposalId, change);
    expect(proposalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    sqlite(
      `INSERT INTO tool_safety_reports (id, proposal_id, proposal_fingerprint, tool_name, package_source, install_method, sandbox_duration_ms, test_prompts_run_count, verdict, evidence_json, created_at, updated_at) VALUES ` +
      `('${randomUUID()}', '${proposalId}', '${proposalFingerprint}', 'example-tool', 'npm:example-tool', 'npm install', 1, 2, 'safe', '{}', datetime('now'), datetime('now'));`,
    );

    const approved = await api<{ status: string }>(`/agent-org-proposals/${proposalId}/approve`, {
      method: 'POST', body: JSON.stringify({ verdict: 'unsafe', report: { verdict: 'unsafe' } }),
    });
    expect(approved.status).toBe('applied');
    expect(sqlite(`SELECT status FROM agent_org_proposals WHERE id = '${proposalId}';`)).toBe('applied');
  }, 60_000);
});
