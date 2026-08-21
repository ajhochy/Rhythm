/** D1.4 live contract: the real creation route runs vetting and never applies unavailable tools. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../services/org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../models/guardrail_registry';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const DB = process.env.RHYTHM_SANDBOX_DB ?? '';
const LOCAL_ARTIFACT_DIGEST = process.env.RHYTHM_D1_LOCAL_ARTIFACT_DIGEST ?? '';
const MANAGED_TOOL_ROOT = process.env.RHYTHM_MANAGED_TOOL_ROOT ?? '';
const proposalIds: string[] = [];
const configIds: string[] = [];

function sqlite(sql: string): string {
  return execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim();
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

  it('drives a safe immutable local tarball from Docker vet through receipt-verified activation and denial through the real API', async () => {
    const config = await api<{ id: string; revision: number; systemPrompt: string | null }>('/agent-configs', {
      method: 'POST', body: JSON.stringify({ label: `D1.4 live ${Date.now()}`, icon: 'shield', systemPrompt: 'test' }),
    });
    configIds.push(config.id);
    expect(LOCAL_ARTIFACT_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    expect(MANAGED_TOOL_ROOT).toMatch(/^\//);
    const safeChange = {
      toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${LOCAL_ARTIFACT_DIGEST}`, installMethod: 'local-tarball', agentConfigId: config.id,
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
    const safe = await api<{ id: string; status: string }>('/agent-org-proposals/tool-install', {
      method: 'POST', body: JSON.stringify({ title: 'D1.4 live safe tool install', change: safeChange }),
    });
    proposalIds.push(safe.id);
    expect(safe.status).toBe('sandbox-vetted');
    expect(sqlite(`SELECT verdict FROM tool_safety_reports WHERE proposal_id = '${safe.id}';`)).toBe('safe');

    const attempted = await api<{ status: string }>(`/agent-org-proposals/${safe.id}/approve`, {
      method: 'POST', body: JSON.stringify({ verdict: 'unsafe', report: { verdict: 'unsafe' } }),
    });
    expect(attempted.status).toBe('applied');
    expect(existsSync(resolve(MANAGED_TOOL_ROOT, 'tools', `fixture-tool-${LOCAL_ARTIFACT_DIGEST.slice(0, 16)}`, '.rhythm-managed-install.json'))).toBe(true);

    // Missing inside the same image: deterministic broken candidate without
    // allowing npm's network retry loop to outlive the test timeout.
    const unavailableChange = { ...safeChange, packageSource: `local-tarball:sha256:${'0'.repeat(64)}` };
    const unavailable = await api<{ id: string; status: string }>('/agent-org-proposals/tool-install', {
      method: 'POST', body: JSON.stringify({ title: 'D1.4 live unavailable tool install', change: unavailableChange }),
    });
    proposalIds.push(unavailable.id);
    expect(unavailable.status).toBe('pending');
    expect(sqlite(`SELECT verdict FROM tool_safety_reports WHERE proposal_id = '${unavailable.id}';`)).toBe('unknown');
    expect(sqlite(`SELECT reason FROM tool_safety_reports WHERE proposal_id = '${unavailable.id}';`)).toBe('unsafe_package_source');

    const denied = await api<{ status: string }>(`/agent-org-proposals/${unavailable.id}/reject`, { method: 'POST' });
    expect(denied.status).toBe('rejected');
    expect(sqlite(`SELECT status FROM agent_org_proposals WHERE id = '${unavailable.id}';`)).toBe('rejected');
  }, 90_000);
});
