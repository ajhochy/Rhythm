/**
 * CONTRACT TEST for issue #826 (org-optimizer-10) — human-gate review queue API.
 *
 * IMPORTANT — Policy update (2026-07-02, locked by maintainer) supersedes the
 * issue body above it: autonomy is "full autonomy with rollback". The review
 * queue is the EXCEPTION path (new-agent + external-adoption/webhook-wiring)
 * plus an audit-trail/rollback view of auto-applied proposals — not the
 * default approval path. Criteria below are written against that policy:
 * the queue only ever surfaces proposals actually sitting in `proposed`
 * (repository-enforced already), and approve/reject operate generically on
 * whatever kind is queued (today: create-agent, external-adoption,
 * webhook-wiring are the realistic gated kinds; low-risk kinds never reach
 * `proposed` because the auto-apply lane skips straight to `applied`).
 *
 * See docs/ai/contracts/issue-826.json for the criterion mapping.
 *
 * Covers:
 *  - issue-826-c1: GET /agent-org-proposals?status=proposed lists only
 *    proposed-status rows; a low-risk row already advanced to `applied` is
 *    never listed.
 *  - issue-826-c2: POST /agent-org-proposals/:id/approve transitions
 *    proposed -> applied, records decided_by_user_id.
 *  - issue-826-c3: POST /agent-org-proposals/:id/reject transitions
 *    proposed -> rejected.
 *  - issue-826-c4: approve is refused (4xx) for external-adoption without
 *    provenance_json.
 *  - issue-826-c5: approve is refused (4xx) for webhook-wiring without the
 *    required security note fields.
 *  - issue-826-c6: approve re-validates change_json at apply time and
 *    rejects (4xx, no status change) when the validator reports invalid.
 *  - issue-826-c7: endpoints respect the AGENT_LOCAL bypass (no bearer token
 *    required when AGENT_LOCAL=true), matching the existing agent-webhooks
 *    posture.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import type { AgentOrgProposalsRepository as AgentOrgProposalsRepositoryType } from '../repositories/agent_org_proposals_repository';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('issue-826: human-gate review queue API', () => {
  let db: Database.Database;
  let repo: AgentOrgProposalsRepositoryType;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  // Routers read env.agentLocal at import time (see
  // agent_local_auth_bypass.test.ts), so AGENT_LOCAL must be stubbed and the
  // module graph reset BEFORE dynamically importing db/migrations/app —
  // otherwise setDb() targets a stale module and the router captures the
  // pre-test env.agentLocal value.
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'true');

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const { AgentOrgProposalsRepository } = await import(
      '../repositories/agent_org_proposals_repository'
    );
    const { createApp } = await import('../app');

    db = makeDb();
    runMigrations(db);
    setDb(db);
    repo = new AgentOrgProposalsRepository(db);

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('issue-826-c1: GET ?status=proposed lists only proposed rows (low-risk applied row excluded)', async () => {
    // Bug this catches: a naive `SELECT *` with no status filter, or a filter
    // that also matches `applied`, would leak an already-auto-applied
    // low-risk proposal into the human queue.
    await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create a Facilities specialist agent',
      dedupKey: 'create-agent:facilities',
    });
    const lowRisk = await repo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Prune dead scope entry',
      dedupKey: 'prune-scope:dead-1',
    });
    await repo.updateStatusAsync(lowRisk.id, 'applied');

    const res = await fetch(`${baseUrl}/agent-org-proposals?status=proposed`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ kind: string; status: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe('create-agent');
    expect(body.every((p) => p.status === 'proposed')).toBe(true);
  });

  it('issue-826-c2: approve transitions proposed -> applied and records decided_by_user_id', async () => {
    const proposal = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create a Facilities specialist agent',
      dedupKey: 'create-agent:facilities-2',
      changeJson: JSON.stringify({ agentSlug: 'facilities-specialist' }),
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decidedByUserId: 42 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; decidedByUserId: number };
    expect(['applied', 'measuring']).toContain(body.status);
    expect(body.decidedByUserId).toBe(42);

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).not.toBe('proposed');
    expect(stored?.decidedByUserId).toBe(42);
  });

  it('issue-826-c3: reject transitions proposed -> rejected', async () => {
    const proposal = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create a redundant agent',
      dedupKey: 'create-agent:redundant',
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/reject`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('rejected');

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('rejected');
  });

  it('issue-826-c4: approve refused (4xx) for external-adoption without provenance_json', async () => {
    // Bug this catches: approve applying an external-adoption proposal
    // without ever checking for the mandatory provenance/security note —
    // the single highest-risk proposal kind per the decision doc.
    const proposal = await repo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      external: 1,
      title: 'Adopt an MCP server',
      dedupKey: 'external-adoption:some-server',
      changeJson: JSON.stringify({ serverName: 'some-mcp-server' }),
      // provenanceJson intentionally omitted
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
      method: 'POST',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('proposed');
  });

  it('issue-826-c5: approve refused (4xx) for webhook-wiring without the required security note', async () => {
    const proposal = await repo.createAsync({
      kind: 'webhook-wiring',
      risk: 'high',
      title: 'Wire an inbound webhook to the on-call recipe',
      dedupKey: 'webhook-wiring:on-call',
      changeJson: JSON.stringify({ targetScheduledTaskId: 'task-1' }),
      // provenanceJson (security note) intentionally omitted
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
      method: 'POST',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('proposed');
  });

  it('issue-826-c6: approve re-validates change_json at apply time and rejects an invalid change', async () => {
    // Bug this catches: approve blindly marks `applied` without re-running
    // the kind-specific validator, so a change that became invalid between
    // proposal-time and approval-time (e.g. references a name no longer
    // live) would be silently applied instead of refused.
    const proposal = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create an agent referencing an invalid shape',
      dedupKey: 'create-agent:invalid-shape',
      // Missing the required agentSlug field the validator checks for.
      changeJson: JSON.stringify({ notAValidField: true }),
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
      method: 'POST',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('proposed');
  });

  it('issue-826-c7: AGENT_LOCAL bypass — no bearer token required for queue endpoints', async () => {
    const proposal = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Local-bypass check',
      dedupKey: 'create-agent:local-bypass',
    });

    const listRes = await fetch(`${baseUrl}/agent-org-proposals?status=proposed`);
    expect(listRes.status).toBe(200);

    const rejectRes = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/reject`, {
      method: 'POST',
    });
    expect(rejectRes.status).toBe(200);
  });
});
