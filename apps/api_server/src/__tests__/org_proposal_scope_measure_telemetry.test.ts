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
        knownServerIds: new Set(['gitnexus']),
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
        knownServerIds: new Set<string>(),
        has: () => false,
      }),
    });

    expect(outcome).toBe('skipped');
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('measuring');
  });
});

describe('W2 P1-1: alias-form removal names canonicalize against the live catalog before comparison', () => {
  it('reverts removal of nfl-mcp when canonical telemetry recorded the underscore live form nfl_mcp', async () => {
    // Bug this catches: the guard compared `remove` names to canonicalServerIds
    // by raw string equality, so an allowlist entry stored in one alias form
    // (`nfl-mcp`) was never recognized as the same server the profile actually
    // used under its live/canonical id (`nfl_mcp`) — an active tool could be
    // pruned and silently KEPT.
    const { measureProposal } = await import('../services/org_proposal_measure');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Football Desk',
      icon: 'search',
      allowedMcpsJson: JSON.stringify(['nfl-mcp']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune nfl-mcp (alias for the actually-used nfl_mcp)',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['nfl-mcp'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['nfl-mcp']) }),
      dedupKey: `prune-scope:${config.id}:nfl-mcp:alias-revert`,
    });

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => ({
        availability: 'available' as const,
        rawCallableNames: new Set(['nfl_mcp']),
        canonicalServerIds: new Set(['nfl_mcp']),
        knownServerIds: new Set(['nfl_mcp']),
        has: (name: string) => name === 'nfl_mcp',
      }),
    });

    expect(outcome).toBe('reverted');
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('reverted');
  });

  it('does not guess when the removal name has no unambiguous canonical match in the live catalog', async () => {
    // The complementary negative case: an unrelated/unknown removal name must
    // never be force-matched to an unrelated live server.
    const { measureProposal } = await import('../services/org_proposal_measure');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Unrelated',
      icon: 'search',
      allowedMcpsJson: JSON.stringify(['totally-unrelated-server']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune an unrelated dead server',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['totally-unrelated-server'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['totally-unrelated-server']) }),
      dedupKey: `prune-scope:${config.id}:totally-unrelated-server`,
    });

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => ({
        availability: 'available' as const,
        rawCallableNames: new Set(['nfl_mcp']),
        canonicalServerIds: new Set(['nfl_mcp']),
        knownServerIds: new Set(['nfl_mcp']),
        has: (name: string) => name === 'nfl_mcp',
      }),
    });

    expect(outcome).toBe('kept');
  });
});

describe('W2 P1-3: a proven positive vetoes a revert even while telemetry is otherwise unavailable', () => {
  it('reverts a gitnexus removal when partial/unavailable telemetry still retained a canonical gitnexus hit', async () => {
    // Bug this catches: the guard checked availability BEFORE checking for a
    // canonical positive match, so 'skipped' won every time telemetry came
    // back unavailable — even when that same unavailable result carried a
    // proven positive (e.g. partial-structured-telemetry after W2 P1-3's
    // resolver fix). The governing rule: a proven positive is a monotonic
    // veto and must win over an availability-based skip.
    const { measureProposal } = await import('../services/org_proposal_measure');
    const config = new AgentConfigsRepository().insert({
      label: 'Research',
      icon: 'search',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune gitnexus under partial telemetry',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['gitnexus']) }),
      dedupKey: `prune-scope:${config.id}:gitnexus:partial-positive-veto`,
    });

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => ({
        availability: 'unavailable' as const,
        reason: 'partial-structured-telemetry' as const,
        rawCallableNames: new Set(['gitnexus_query']),
        canonicalServerIds: new Set(['gitnexus']),
        knownServerIds: new Set(['gitnexus']),
        has: (name: string) => name === 'gitnexus_query' || name === 'gitnexus',
      }),
    });

    expect(outcome).toBe('reverted');
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('reverted');
  });
});
