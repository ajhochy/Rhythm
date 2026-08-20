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
 *  - issue-857-c7: POST /agent-org-proposals/:id/revert undoes an `active`
 *    proposal (restores the live agent_configs scope + sets status=reverted);
 *    refused (4xx, no status change) for a proposal not currently `active`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import type { AgentOrgProposalsRepository as AgentOrgProposalsRepositoryType } from '../repositories/agent_org_proposals_repository';
import type { AgentConfigsRepository as AgentConfigsRepositoryType } from '../repositories/agent_configs_repository';
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

  /**
   * Fixture only: place a proposal directly in the durable post-apply state.
   * The generic status API refuses ANY scope arrival at `applied` (W1 package
   * C), so this raw write stands in for a pair the atomic primitive already
   * committed; the tests using it exercise later lifecycle stages.
   */
  const forceApplied = (id: string): void => {
    db.prepare(`UPDATE agent_org_proposals SET status = 'applied' WHERE id = ?`).run(id);
  };

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
    vi.restoreAllMocks();
    vi.doUnmock('../services/post_apply_lifecycle');
    vi.doUnmock('../services/org_proposal_measure');
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
    forceApplied(lowRisk.id);

    const res = await fetch(`${baseUrl}/agent-org-proposals?status=proposed`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ kind: string; status: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe('create-agent');
    expect(body.every((p) => p.status === 'proposed')).toBe(true);
  });

  it('issue-826-c2/#1175-c19: approve records the authenticated actor and ignores hostile reviewer input', async () => {
    // Exercise the real session middleware even though the suite otherwise
    // keeps AGENT_LOCAL enabled to preserve its dedicated bypass coverage.
    await closeServer();
    const [
      { default: express },
      { requireAuth },
      { errorHandler },
      { default: orgProposalsRouter },
      { UsersRepository },
      { SessionsRepository },
    ] = await Promise.all([
      import('express'),
      import('../middleware/auth_middleware'),
      import('../middleware/error_handler'),
      import('../routes/org_proposals_routes'),
      import('../repositories/users_repository'),
      import('../repositories/sessions_repository'),
    ]);
    const actor = new UsersRepository().create({
      name: 'Verified Reviewer',
      email: 'verified-reviewer@example.com',
      role: 'admin',
    });
    const session = new SessionsRepository().create(actor.id);
    const authenticatedApp = express();
    authenticatedApp.use(express.json());
    authenticatedApp.use(
      '/agent-org-proposals',
      requireAuth,
      orgProposalsRouter,
    );
    authenticatedApp.use(errorHandler);
    ({ baseUrl, close: closeServer } =
      await startTestServer(authenticatedApp));

    const proposal = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create a Facilities specialist agent',
      dedupKey: 'create-agent:facilities-2',
      changeJson: JSON.stringify({ agentSlug: 'facilities-specialist' }),
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ decidedByUserId: actor.id + 1000 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; decidedByUserId: number };
    expect(['applied', 'measuring']).toContain(body.status);
    expect(body.decidedByUserId).toBe(actor.id);

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).not.toBe('proposed');
    expect(stored?.decidedByUserId).toBe(actor.id);
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

  it.each([
    {
      lane: 'generic refine-config',
      kind: 'refine-config',
      field: 'model' as const,
      before: 'anthropic/before',
      after: 'anthropic/after',
      expectedStatus: 'applied',
      change: (id: string) => ({ configPatch: { agentConfigId: id, field: 'model', value: 'anthropic/after' } }),
    },
    {
      lane: 'scope refine-scope',
      kind: 'refine-scope',
      field: 'allowedSkillsJson' as const,
      before: '["skill-a"]',
      after: '["skill-a","skill-b"]',
      expectedStatus: 'measuring',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', add: ['skill-b'] } }),
    },
  ])(
    'D2.5: $lane preserves committed approval when lifecycle enrollment rejects',
    async ({ lane, kind, field, before, after, expectedStatus, change }) => {
      // Regression caught: post-commit enrollment failure reaches next(err),
      // returning 500 even though the proposal and target mutation committed.
      await closeServer();
      vi.resetModules();
      const secret = `injected-lifecycle-secret-${lane}`;
      const finalize = vi.fn().mockRejectedValue(new Error(secret));
      vi.doMock('../services/post_apply_lifecycle', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../services/post_apply_lifecycle')>()),
        finalizePostApplyLifecycleAsync: finalize,
      }));
      const measure = vi.fn().mockResolvedValue(undefined);
      vi.doMock('../services/org_proposal_measure', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../services/org_proposal_measure')>()),
        measureProposal: measure,
      }));

      const { setDb } = await import('../database/db');
      const { runMigrations } = await import('../database/migrations');
      const { createApp } = await import('../app');
      const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
      const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
      const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
      const { logger } = await import('../utils/logger');
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      db = makeDb();
      runMigrations(db);
      setDb(db);
      repo = new AgentOrgProposalsRepository(db);
      registerAllProposalAppliers();
      ({ baseUrl, close: closeServer } = await startTestServer(createApp()));

      const configsRepo = new AgentConfigsRepository();
      const config = configsRepo.insert({
        label: `failure isolation ${lane}`,
        icon: 'shield',
        ...(field === 'model'
          ? { modelProvider: 'anthropic', modelId: 'before' }
          : { allowedSkillsJson: before }),
      });
      const proposal = await repo.createAsync({
        kind,
        risk: 'high',
        status: 'proposed',
        title: `failure isolation ${lane}`,
        dedupKey: `failure-isolation-${lane}`,
        changeJson: JSON.stringify(change(config.id)),
      });

      const response = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      expect((await response.json()) as { status: string }).toMatchObject({ status: expectedStatus });
      expect((await repo.findByIdAsync(proposal.id))?.status).toBe(expectedStatus);
      const updated = configsRepo.getById(config.id)!;
      expect(field === 'model' ? `${updated.modelProvider}/${updated.modelId}` : updated[field]).toBe(after);
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(measure).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        `[org-proposals] post-apply enrollment failed proposal=${proposal.id} outcome=committed-success-preserved`,
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    },
  );

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

  it('W1: legacy active-scope revert returns conflict and leaves config/status unchanged', async () => {
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const proposal = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'Tighten unused mcp scope nfl-mcp from secretary',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['nfl-mcp'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['rhythm', 'nfl-mcp']) }),
      dedupKey: 'issue-857-c7:revert-route',
    });
    forceApplied(proposal.id);
    await repo.updateStatusAsync(proposal.id, 'measuring');
    await repo.updateStatusAsync(proposal.id, 'active');

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/revert`, {
      method: 'POST',
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/operator reconciliation is required/i);

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('active');

    const unchangedConfig = configsRepo.getById(config.id);
    expect(unchangedConfig?.allowedMcpsJson).toBe(JSON.stringify(['rhythm']));
  });

  it('W1: a proposed prune-scope proposal makes no config change until it is approved', async () => {
    // Bug this catches: proposal creation itself (or GET listing it) somehow
    // mutating agent_configs before a human ever acts — scope removal must
    // stay inert while sitting in the human-gate queue.
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['gitnexus', 'rhythm']),
    });

    const proposal = await repo.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'Prune dead gitnexus scope from secretary',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      dedupKey: 'w1-routes:prune-scope:no-mutation-before-approval',
    });

    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(JSON.stringify(['gitnexus', 'rhythm']));
    expect((await repo.findByIdAsync(proposal.id))?.status).toBe('proposed');

    const listRes = await fetch(`${baseUrl}/agent-org-proposals?status=proposed`);
    expect(listRes.status).toBe(200);

    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(JSON.stringify(['gitnexus', 'rhythm']));
    expect((await repo.findByIdAsync(proposal.id))?.status).toBe('proposed');
  });

  it('W1: approving a prune-scope proposal removes exactly the named entry, records a V2 snapshot, and advances to measuring', async () => {
    // Bug this catches: tighten-scope/prune-scope have a registered VALIDATOR
    // (so approve does not 400) but no registered APPLIER, so approve would
    // silently no-op (defaultApplier -> measurable:false, no config write, no
    // snapshot) while still reporting success — an approved human decision
    // that never actually took effect.
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();

    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['gitnexus', 'rhythm']),
    });

    const proposal = await repo.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'Prune dead gitnexus scope from secretary',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      dedupKey: 'w1-routes:prune-scope:approve-applies',
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; beforeSnapshotJson: string | null };
    expect(body.status).toBe('measuring');
    expect(body.beforeSnapshotJson).toBeTruthy();

    const snapshot = JSON.parse(body.beforeSnapshotJson!);
    expect(snapshot.version).toBe('scope-delta-v2');
    expect(snapshot.target).toEqual({ type: 'agent_config', id: config.id });
    expect(snapshot.field).toBe('allowedMcpsJson');
    expect(snapshot.requestedRemove).toEqual(['gitnexus']);
    expect(snapshot.removedEntries).toEqual([{ name: 'gitnexus', priorValue: 'gitnexus', priorIndex: 0 }]);
    expect(snapshot.expectedAppliedValue).toBe(JSON.stringify(['rhythm']));
    expect(typeof snapshot.integrityHash).toBe('string');

    // approve() fires a non-awaited measureProposal() immediately after
    // responding (see org_proposals_controller.ts), so a re-fetched row may
    // already have advanced past 'measuring' (e.g. to 'active') by the time
    // this assertion runs — the response body above is the reliable, race-free
    // proof that approve itself transitioned to 'measuring'. It must never
    // have gone back to 'proposed' (approve took no effect) or 'applied'
    // (stuck, un-measured).
    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).not.toBe('proposed');
    expect(stored?.status).not.toBe('applied');

    // The removal itself persists regardless of the race: no exercised-tool
    // evidence exists in this empty DB, so the functional guard, if it has
    // already run, keeps (rather than reverts) the change.
    const updatedConfig = configsRepo.getById(config.id);
    expect(updatedConfig?.allowedMcpsJson).toBe(JSON.stringify(['rhythm']));
  });

  it('W1: persists the applied claim and V2 snapshot before the first config mutation', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Ordering target', icon: 'shield', allowedMcpsJson: JSON.stringify(['gitnexus', 'rhythm']),
    });
    const proposal = await repo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Ordering proof',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
      dedupKey: 'w1:ordering-proof',
    });
    // W1 package C ordering: the durable `approved` claim (with its exact V2
    // snapshot) must land BEFORE the atomic pair that first touches the target.
    const events: string[] = [];
    const originalClaim = AgentOrgProposalsRepository.prototype.claimScopeApprovedWithSnapshotAsync;
    vi.spyOn(AgentOrgProposalsRepository.prototype, 'claimScopeApprovedWithSnapshotAsync')
      .mockImplementation(async function (this: AgentOrgProposalsRepositoryType, ...args) {
        events.push('claim');
        return originalClaim.apply(this, args);
      });
    const originalPair =
      AgentOrgProposalsRepository.prototype.transitionScopeAtomicallyAtRevisionsAsync;
    vi.spyOn(AgentOrgProposalsRepository.prototype, 'transitionScopeAtomicallyAtRevisionsAsync')
      .mockImplementation(async function (this: AgentOrgProposalsRepositoryType, ...args) {
        events.push('atomic-pair');
        return originalPair.apply(this, args);
      });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(events.slice(0, 2)).toEqual(['claim', 'atomic-pair']);
    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.beforeSnapshotJson).toBeTruthy();
  });

  it('W1: claim persistence failure leaves config bytes/profile/status untouched and never measures', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
    const writer = await import('../services/opencode_agent_writer');
    const measure = await import('../services/org_proposal_measure');
    const profileSpy = vi.spyOn(writer, 'writeAgentProfileFile');
    const measureSpy = vi.spyOn(measure, 'measureProposal');
    vi.spyOn(AgentOrgProposalsRepository.prototype, 'claimScopeApprovedWithSnapshotAsync')
      .mockRejectedValue(new Error('injected snapshot persistence failure'));
    const configsRepo = new AgentConfigsRepository();
    const before = JSON.stringify(['gitnexus', 'rhythm']);
    const config = configsRepo.insert({ label: 'Failure target', icon: 'shield', allowedMcpsJson: before });
    const proposal = await repo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Injected failure',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
      dedupKey: 'w1:claim-failure',
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(500);
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(before);
    expect(await repo.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed', beforeSnapshotJson: null,
    });
    expect(profileSpy).not.toHaveBeenCalled();
    expect(measureSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'refine allowed skills',
      kind: 'refine-scope',
      field: 'allowedSkillsJson' as const,
      prior: '["skill-a"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', add: ['skill-b'] } }),
    },
    {
      label: 'refine allowed MCPs',
      kind: 'refine-scope',
      field: 'allowedMcpsJson' as const,
      prior: '["rhythm"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedMcpsJson', add: ['gitnexus'] } }),
    },
    {
      label: 'refine core permissions',
      kind: 'refine-scope',
      field: 'corePermissionsJson' as const,
      prior: ' { "read": "ask" } ',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'corePermissionsJson', set: { read: 'allow' } } }),
    },
    {
      label: 'broaden allowed skills',
      kind: 'broaden-scope',
      field: 'allowedSkillsJson' as const,
      prior: '["skill-a"]',
      change: (id: string) => ({ agentConfigId: id, field: 'allowedSkillsJson', add: ['skill-b'] }),
    },
  ])('W1 corrective 3: real SQLite claim failure is mutation-free for $label', async ({ label, kind, field, prior, change }) => {
    // Regression caught: eager refine/broaden writes survive a failed durable
    // claim, leaving a proposed row with no rollback snapshot.
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const writer = await import('../services/opencode_agent_writer');
    const measure = await import('../services/org_proposal_measure');
    const profileSpy = vi.spyOn(writer, 'writeAgentProfileFile');
    const measureSpy = vi.spyOn(measure, 'measureProposal');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: `Claim failure ${label}`,
      icon: 'shield',
      ...(field === 'allowedMcpsJson' ? { allowedMcpsJson: prior } : {}),
      ...(field === 'allowedSkillsJson' ? { allowedSkillsJson: prior } : {}),
      ...(field === 'corePermissionsJson' ? { corePermissionsJson: prior } : {}),
    });
    const exactChangeJson = JSON.stringify(change(config.id));
    const proposal = await repo.createAsync({
      kind, risk: 'high', title: `Claim failure ${label}`,
      changeJson: exactChangeJson, dedupKey: `w1-c3:claim-failure:${label}`,
    });
    db.prepare(`
      CREATE TRIGGER w1_abort_scope_claim
      BEFORE UPDATE OF status ON agent_org_proposals
      WHEN NEW.status = 'approved'
      BEGIN
        SELECT RAISE(ABORT, 'forced claim persistence failure');
      END
    `).run();

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(500);
    expect((configsRepo.getById(config.id) as unknown as Record<string, unknown> | null)?.[field]).toBe(prior);
    expect(await repo.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed', beforeSnapshotJson: null,
    });
    expect(profileSpy).not.toHaveBeenCalled();
    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('W1: local approval atomically binds sentinel actor, exact change, and snapshot', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Local actor target', icon: 'shield', allowedMcpsJson: JSON.stringify(['x', 'y']),
    });
    const exactChangeJson = ` { "agentConfigId": "${config.id}", "field": "allowedMcpsJson", "remove": ["x"] } `;
    const proposal = await repo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Local actor and exact change',
      changeJson: exactChangeJson, dedupKey: 'w1:local-actor-exact-change',
    });
    const claimSpy = vi.spyOn(
      AgentOrgProposalsRepository.prototype,
      'claimScopeApprovedWithSnapshotAsync',
    );

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(claimSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: proposal.id,
      decidedByUserId: 0,
      expectedRevision: proposal.revision,
      expectedKind: 'prune-scope',
      expectedChangeJson: exactChangeJson,
      beforeSnapshotJson: expect.stringContaining('scope-delta-v2'),
    }));
    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.decidedByUserId).toBe(0);
    expect(stored?.changeJson).toBe(exactChangeJson);
    expect(stored?.beforeSnapshotJson).toContain('scope-delta-v2');
  });

  it('W1: projection refusal is HTTP conflict after durable local claim and never measures', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const writer = await import('../services/opencode_agent_writer');
    const measure = await import('../services/org_proposal_measure');
    vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('blocked');
    const measureSpy = vi.spyOn(measure, 'measureProposal');
    const configsRepo = new AgentConfigsRepository();
    const prior = ' [ "x", "y" ] ';
    const config = configsRepo.insert({ label: 'Blocked projection target', icon: 'shield', allowedMcpsJson: prior });
    const exactChangeJson = JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['x'] });
    const proposal = await repo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Blocked projection',
      changeJson: exactChangeJson, dedupKey: 'w1:blocked-projection-route',
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' });

    // W1 package C: the projection AND its compensating projection are both
    // blocked, so the atomic inverse restores the exact prior target bytes and
    // the unresolved operation is recorded DURABLY as reconciliation-required
    // — an operator can see it, and no automatic path can sweep it onward.
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/reconciliation-required/);
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(prior);
    const settled = await repo.findByIdAsync(proposal.id);
    expect(settled).toMatchObject({
      status: 'reconciliation-required',
      decidedByUserId: 0,
      changeJson: exactChangeJson,
    });
    expect(settled?.reconciliationReason).toMatch(/compensating projection/);
    expect((await repo.findByIdAsync(proposal.id))?.beforeSnapshotJson).toContain('scope-delta-v2');
    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('W1: concurrent approvals have one winner, one conflict, and one durable nonempty delta', async () => {
    const applyService = await import('../services/org_proposal_apply_service');
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    applyService.registerProposalValidator('prune-scope', async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
      return { valid: true };
    });
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Concurrent target', icon: 'shield', allowedMcpsJson: JSON.stringify(['x', 'y']),
    });
    db.prepare('CREATE TABLE w1_scope_mutations (count INTEGER NOT NULL)').run();
    db.prepare('INSERT INTO w1_scope_mutations VALUES (0)').run();
    db.prepare(`
      CREATE TRIGGER w1_count_scope_mutations
      AFTER UPDATE OF allowed_mcps_json ON agent_configs
      WHEN OLD.allowed_mcps_json IS NOT NEW.allowed_mcps_json
      BEGIN
        UPDATE w1_scope_mutations SET count = count + 1;
      END
    `).run();
    const proposal = await repo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Concurrent approval',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['x'] }),
      dedupKey: 'w1:concurrent-approval',
    });

    const responses = await Promise.all([
      fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' }),
      fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((db.prepare('SELECT count FROM w1_scope_mutations').get() as { count: number }).count).toBe(1);
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(JSON.stringify(['y']));
    const stored = await repo.findByIdAsync(proposal.id);
    const snapshot = JSON.parse(stored?.beforeSnapshotJson ?? 'null');
    expect(snapshot.requestedRemove).toEqual(['x']);
    expect(snapshot.removedEntries).toEqual([{ name: 'x', priorValue: 'x', priorIndex: 0 }]);
  });

  it('W1: duplicate current array member is actionable 400 before claim/config/profile writes', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
    const writer = await import('../services/opencode_agent_writer');
    const claimSpy = vi.spyOn(
      AgentOrgProposalsRepository.prototype,
      'claimScopeApprovedWithSnapshotAsync',
    );
    const profileSpy = vi.spyOn(writer, 'writeAgentProfileFile');
    const configsRepo = new AgentConfigsRepository();
    const before = JSON.stringify(['x', 'x', 'y']);
    const config = configsRepo.insert({ label: 'Duplicate target', icon: 'shield', allowedMcpsJson: before });
    const proposal = await repo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Duplicate member',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['x'] }),
      dedupKey: 'w1:duplicate-current',
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/duplicate current entries/i);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(before);
    expect((await repo.findByIdAsync(proposal.id))?.status).toBe('proposed');
    expect(profileSpy).not.toHaveBeenCalled();
  });

  it('W1: successful active-route V2 revert restores exactly the removed entry', async () => {
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { createScopeDeltaV2Snapshot } = await import('../services/org_proposal_apply');
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['x', 'y']);
    const config = configsRepo.insert({ label: 'Route revert', icon: 'shield', allowedMcpsJson: prior });
    const exactChangeJson = JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['x'] });
    const snapshot = createScopeDeltaV2Snapshot(config.id, 'allowedMcpsJson', prior, ['x'], 'prune-scope', exactChangeJson);
    configsRepo.update(config.id, { allowedMcpsJson: snapshot.expectedAppliedValue });
    const proposal = await repo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Route V2 revert',
      changeJson: exactChangeJson,
      beforeSnapshotJson: JSON.stringify(snapshot), dedupKey: 'w1:route-v2-revert',
    });
    forceApplied(proposal.id);
    await repo.updateStatusAsync(proposal.id, 'measuring');
    await repo.updateStatusAsync(proposal.id, 'active');

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/revert`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(prior);
    expect((await repo.findByIdAsync(proposal.id))?.status).toBe('reverted');
  });

  it('W1: reconciliation response does not falsely claim an ambiguous durable commit made no changes', async () => {
    const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
    const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
    const { createScopeStateV2Snapshot } = await import('../services/org_proposal_apply');
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['base']);
    const applied = JSON.stringify(['base', 'grant']);
    const config = configsRepo.insert({
      label: 'Route ambiguous durable commit',
      icon: 'shield',
      allowedSkillsJson: applied,
    });
    const exactChangeJson = JSON.stringify({
      agentConfigId: config.id,
      field: 'allowedSkillsJson',
      add: ['grant'],
    });
    const snapshot = createScopeStateV2Snapshot(
      config.id,
      'allowedSkillsJson',
      prior,
      applied,
      exactChangeJson,
      'broaden-scope',
    );
    const proposal = await repo.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'Route ambiguous durable commit',
      changeJson: exactChangeJson,
      beforeSnapshotJson: JSON.stringify(snapshot),
      dedupKey: `w1:route-ambiguous:${crypto.randomUUID()}`,
    });
    forceApplied(proposal.id);
    await repo.updateStatusAsync(proposal.id, 'measuring');
    await repo.updateStatusAsync(proposal.id, 'active');

    const original = AgentOrgProposalsRepository.prototype.transitionScopeAtomicallyAsync;
    vi.spyOn(AgentOrgProposalsRepository.prototype, 'transitionScopeAtomicallyAsync')
      .mockImplementation(async function (this: AgentOrgProposalsRepositoryType, input) {
        const result = await original.call(this, input);
        throw new Error(`simulated transport failure after commit: ${Boolean(result)}`);
      });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/revert`, { method: 'POST' });
    const text = await res.text();

    expect(res.status).toBe(409);
    expect(text).toMatch(/may have committed|durable state.*inspect|state.*uncertain/i);
    expect(text).not.toMatch(/no changes were made/i);
    expect(configsRepo.getById(config.id)?.allowedSkillsJson).toBe(prior);
    // The revert committed; the unresolved transport failure is now durable, so
    // the row is not indistinguishable from a cleanly reverted one.
    const settled = await repo.findByIdAsync(proposal.id);
    expect(settled?.status).toBe('reconciliation-required');
    expect(settled?.reconciliationReason).toBeTruthy();
  });

  it('#1056: approve accepts a failed proposal for retry, not just proposed', async () => {
    // Bug this catches: publish-skill-to-org's applier marks a prod-down
    // proposal 'failed' (see issue_1056_publish_skill_to_org.test.ts); if
    // approve() only accepted 'proposed', a human could never retry it after
    // fixing connectivity — it would be stuck 409-conflicting forever.
    const proposal = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Retryable after a failed apply attempt',
      dedupKey: 'create-agent:retry-after-failed',
      changeJson: JSON.stringify({ agentSlug: 'retry-agent' }),
    });
    await repo.updateStatusAsync(proposal.id, 'failed');

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/approve`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).not.toBe('failed');
  });

  it('issue-857-c7b: revert refused (4xx) for a proposal that is not active', async () => {
    const proposal = await repo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Still proposed',
      dedupKey: 'issue-857-c7b:not-active',
    });

    const res = await fetch(`${baseUrl}/agent-org-proposals/${proposal.id}/revert`, {
      method: 'POST',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const stored = await repo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('proposed');
  });
});
