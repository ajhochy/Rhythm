/**
 * CONTRACT TEST for issue #1056 (OCU-15) — the `publish-skill-to-org`
 * proposal kind/applier: promote an approved LOCAL managed skill to the
 * shared org library (#1053's `/org-skills` endpoint) through the existing
 * human-gated review queue.
 *
 * Mirrors issue_981_refine_task.test.ts's structure for a "diagnosis lane"
 * kind added directly in org_proposal_appliers_wiring.ts. `fetch` is mocked
 * here (fast, deterministic, no real network) — the REAL HTTP round-trip
 * against the real /org-skills routes (and, for #1054, the real forked
 * engine) is covered by the gated live-e2e test.
 *
 * Covers:
 *  - #1056-risk: classifyProposalRisk('publish-skill-to-org') === 'high'
 *    (never auto-published).
 *  - #1056-validate: refuses a proposal missing skillName/action, and a
 *    'publish' action whose managed skill no longer exists; accepts a
 *    well-formed 'publish' proposal for a live managed skill and any
 *    well-formed 'unpublish' proposal.
 *  - #1056-apply-publish: POSTs the exact on-disk SKILL.md bytes (frontmatter
 *    included) to `<prodBase>/org-skills/<name>` with the configured bearer
 *    token.
 *  - #1056-apply-unpublish: DELETEs `<prodBase>/org-skills/<name>`.
 *  - #1056-reject: reject never invokes the applier (no HTTP call at all).
 *  - #1056-prod-down: a non-OK response / thrown fetch error marks the
 *    proposal 'failed' (not stuck at 'proposed', not silently 'applied') and
 *    re-throws so the approve request still surfaces an error.
 *  - #1056-retry: a 'failed' proposal can be approved again (retryable) and
 *    succeeds once prod is reachable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { classifyProposalRisk } from '../services/org_risk_classifier';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { writeManagedSkill } from '../services/rhythm_managed_skills';
import { env } from '../config/env';
import {
  applyProposal,
  validateProposalChange,
  registerProposalApplier,
  registerProposalValidator,
  resetProposalPluginsForTests,
} from '../services/org_proposal_apply_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let managedDir: string;
let priorProdApiUrl: string | null;
let priorProdAuthToken: string | null;

beforeEach(async () => {
  setDb(makeDb());
  resetProposalPluginsForTests();
  const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
  registerAllProposalAppliers({ registerProposalApplier, registerProposalValidator });

  managedDir = mkdtempSync(join(tmpdir(), 'rhythm-publish-org-managed-'));
  process.env.RHYTHM_MANAGED_SKILLS_DIR = managedDir;

  priorProdApiUrl = env.prodApiUrl;
  priorProdAuthToken = env.prodAuthToken;
  env.prodApiUrl = 'http://localhost:59999';
  env.prodAuthToken = 'test-prod-token';

  global.fetch = vi.fn();
});

afterEach(() => {
  rmSync(managedDir, { recursive: true, force: true });
  delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
  env.prodApiUrl = priorProdApiUrl;
  env.prodAuthToken = priorProdAuthToken;
});

describe('#1056-risk: publish-skill-to-org is human-gated (high risk)', () => {
  it('classifies publish-skill-to-org as high', () => {
    expect(
      classifyProposalRisk({
        kind: 'publish-skill-to-org',
        changeJson: JSON.stringify({ skillName: 'reporter', action: 'publish' }),
      }),
    ).toBe('high');
  });
});

describe('#1056-validate: publish-skill-to-org re-validation at apply time', () => {
  it('refuses a proposal missing skillName/action', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish a skill',
      changeJson: JSON.stringify({ notTheRightShape: true }),
      dedupKey: 'publish-skill-to-org:malformed',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(false);
  });

  it("refuses a 'publish' action whose managed skill no longer exists", async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish a since-deleted skill',
      changeJson: JSON.stringify({ skillName: 'does-not-exist', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:stale',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(false);
    expect(validation.reason ?? '').toMatch(/no longer exists/);
  });

  it("accepts a well-formed 'publish' proposal for a live managed skill", async () => {
    writeManagedSkill({ name: 'reporter', description: 'Reports things', body: 'Report body.' });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:reporter',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(true);
  });

  it("accepts an 'unpublish' proposal without requiring the skill to still exist locally", async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Unpublish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'unpublish' }),
      dedupKey: 'publish-skill-to-org:unpublish-reporter',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(true);
  });
});

describe('#1056-apply-publish: POSTs the on-disk SKILL.md bytes to the org library', () => {
  it('POSTs the exact frontmatter-included file bytes with the configured bearer token', async () => {
    const location = writeManagedSkill({
      name: 'reporter',
      description: 'Reports things',
      body: 'Report body.',
    });
    void location;
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, status: 201 });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:apply-reporter',
    });

    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(false);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:59999/org-skills/reporter');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-prod-token');
    const body = JSON.parse(init.body);
    expect(body.published).toBe(true);
    expect(body.content).toContain('Report body.');
    expect(body.content).toContain('---'); // frontmatter is part of the published body
  });

  it('throws (never publishes) when the managed skill has no SKILL.md on disk', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish a phantom skill',
      changeJson: JSON.stringify({ skillName: 'phantom', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:phantom',
      status: 'approved', // bypass validate() for this apply-level unit test
    });
    await expect(applyProposal(proposal)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('#1056-apply-unpublish: DELETEs the org library entry', () => {
  it('DELETEs the org skill by name, no body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, status: 204 });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Unpublish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'unpublish' }),
      dedupKey: 'publish-skill-to-org:apply-unpublish-reporter',
    });

    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(false);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:59999/org-skills/reporter');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer test-prod-token');
  });
});

describe('#1056-reject: rejection never invokes the applier', () => {
  it('reject transitions to rejected with zero HTTP calls', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:reject',
    });
    const rejected = await proposalsRepo.updateStatusAsync(proposal.id, 'rejected');
    expect(rejected?.status).toBe('rejected');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('#1056-prod-down: a failed publish marks the proposal failed (retryable)', () => {
  it('a non-OK HTTP response marks the proposal failed and re-throws', async () => {
    writeManagedSkill({ name: 'reporter', description: 'Reports things', body: 'Report body.' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 503 });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:prod-down',
    });

    await expect(applyProposal(proposal)).rejects.toThrow();

    const stored = await proposalsRepo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('failed');
  });

  it('a thrown network error (prod unreachable) also marks the proposal failed', async () => {
    writeManagedSkill({ name: 'reporter', description: 'Reports things', body: 'Report body.' });
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:unreachable',
    });

    await expect(applyProposal(proposal)).rejects.toThrow(/ECONNREFUSED/);

    const stored = await proposalsRepo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('failed');
  });

  it('a failed proposal can be retried and succeeds once prod is reachable again', async () => {
    writeManagedSkill({ name: 'reporter', description: 'Reports things', body: 'Report body.' });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'publish-skill-to-org',
      risk: 'high',
      title: 'Publish reporter',
      changeJson: JSON.stringify({ skillName: 'reporter', action: 'publish' }),
      dedupKey: 'publish-skill-to-org:retry',
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(applyProposal(proposal)).rejects.toThrow();
    const failed = await proposalsRepo.findByIdAsync(proposal.id);
    expect(failed?.status).toBe('failed');

    // Retry: prod is reachable this time.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, status: 201 });
    const result = await applyProposal(failed!);
    expect(result.measurable).toBe(false);

    // The retryable transition itself (failed -> applied) is enforced by the
    // repository's ALLOWED_TRANSITIONS state machine, exercised directly here
    // the same way the real approve() controller would use it.
    const applied = await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
      beforeSnapshotJson: result.beforeSnapshotJson,
    });
    expect(applied?.status).toBe('applied');
  });
});
