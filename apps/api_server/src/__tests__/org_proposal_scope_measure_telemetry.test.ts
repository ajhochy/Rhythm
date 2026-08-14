/**
 * W2 (canonical/fail-closed capability telemetry) — scope-measurement
 * regressions for `org_proposal_measure.ts`'s functional guard.
 *
 * Covers:
 *  - a removed server with successful raw `<server>_<tool>` telemetry
 *    canonicalizes to the server id and the guard reverts the prune, closing
 *    the false-positive named in the plan (`gitnexus_query` compared against
 *    `gitnexus` used to pass the guard incorrectly).
 *  - unavailable telemetry is never treated as proof of zero use — the
 *    proposal is skipped and stays `measuring` rather than being kept or
 *    reverted.
 *
 * The default (non-injected) catalog-resolution path — `measureProposal`
 * fetching the live MCP catalog itself and canonicalizing callables against
 * it — is covered by issue-853-c3 in
 * `services/__tests__/org_exercised_tools_resolver.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

describe('canonical scope-measurement telemetry', () => {
  it('reverts removal of gitnexus when canonical telemetry records gitnexus_query use', async () => {
    const { measureProposal } = await import('../services/org_proposal_measure');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Research',
      icon: 'search',
      allowedMcpsJson: JSON.stringify([]),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune gitnexus scope (actually in use)',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['gitnexus']) }),
      dedupKey: `prune-scope:${config.id}:gitnexus:canonical-revert`,
    });

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => ({
        availability: 'available' as const,
        rawCallableNames: new Set(['gitnexus_query']),
        canonicalServerIds: new Set(['gitnexus']),
        has: (name: string) => name === 'gitnexus_query' || name === 'gitnexus',
      }),
    });

    expect(outcome).toBe('reverted');
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('reverted');
    expect(JSON.parse(configsRepo.getById(config.id)!.allowedMcpsJson!)).toEqual(['gitnexus']);
  });

  it('skips and leaves the proposal measuring when canonical telemetry is unavailable', async () => {
    const { measureProposal } = await import('../services/org_proposal_measure');
    const config = new AgentConfigsRepository().insert({
      label: 'Research',
      icon: 'search',
      allowedMcpsJson: JSON.stringify([]),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune gitnexus without telemetry',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['gitnexus']) }),
      dedupKey: `prune-scope:${config.id}:gitnexus:unavailable`,
    });

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => ({
        availability: 'unavailable' as const,
        reason: 'catalog-unavailable' as const,
        rawCallableNames: new Set<string>(),
        canonicalServerIds: new Set<string>(),
        has: () => false,
      }),
    });

    expect(outcome).toBe('skipped');
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('measuring');
  });
});
