/**
 * CONTRACT TEST for issue #1139 (Review Queue: broaden-scope proposals cannot
 * be approved — "No re-validation is registered for proposal kind 'broaden-scope'").
 *
 * The workflow_signal_generator emits a HIGH-risk `broaden-scope` proposal with
 * a FLAT change_json ({agentConfigId, field, add}) but no validator/applier was
 * ever registered, so approve 400'd at re-validation before the apply step ran.
 *
 * Covers:
 *  - issue-1139-c1: after registerAllProposalAppliers(), validateProposalChange
 *    for a well-formed broaden-scope proposal no longer returns the fail-closed
 *    "No re-validation is registered for proposal kind 'broaden-scope'" (mirrors
 *    the guard in issue_830_contract.test.ts / org_proposal_apply_service).
 *  - issue-1139-c2: applying a broaden-scope proposal appends the denied tool to
 *    the target agent's allowedMcpsJson (behavioral outcome, not "was called").
 *  - issue-1139-c3: fail-closed — a malformed broaden-scope change (missing
 *    agentConfigId, or empty add) is refused with an actionable reason.
 *  - issue-1139-c4: drift guard — a broaden-scope for a since-deleted agent is
 *    refused (not applied) at re-validation time.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import {
  resetProposalPluginsForTests,
  registerProposalApplier,
  registerProposalValidator,
  applyProposal,
  validateProposalChange,
} from '../services/org_proposal_apply_service';
import { registerAllProposalAppliers } from '../services/org_proposal_appliers_wiring';
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
  resetProposalPluginsForTests();
  registerAllProposalAppliers({ registerProposalApplier, registerProposalValidator });
});

/** allowedMcpsJson parsed as a string[]; [] on absent/invalid. */
function mcps(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

describe('issue-1139-c1: broaden-scope has a registered re-validation', () => {
  it('validateProposalChange no longer returns "No re-validation is registered" for broaden-scope', async () => {
    const configsRepo = new AgentConfigsRepository();
    const target = configsRepo.insert({ label: 'Workflow Orchestrator', icon: 'flow' });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: `Grant missing scope 'gitnexus' to ${target.id}`,
      changeJson: JSON.stringify({
        agentConfigId: target.id,
        field: 'allowedMcpsJson',
        add: ['gitnexus'],
      }),
      dedupKey: `broaden-scope:${target.id}:mcp:gitnexus`,
    });

    const validation = await validateProposalChange(proposal);
    expect(validation.reason ?? '').not.toMatch(/No re-validation is registered/);
    expect(validation.valid).toBe(true);
  });
});

describe('issue-1139-c2: approving a broaden-scope appends the tool to allowedMcpsJson', () => {
  it('adds the denied tool to the target agent (behavioral)', async () => {
    const configsRepo = new AgentConfigsRepository();
    const target = configsRepo.insert({
      label: 'Workflow Orchestrator',
      icon: 'flow',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: `Grant missing scope 'gitnexus' to ${target.id}`,
      changeJson: JSON.stringify({
        agentConfigId: target.id,
        field: 'allowedMcpsJson',
        add: ['gitnexus'],
      }),
      dedupKey: `broaden-scope:${target.id}:mcp:gitnexus`,
    });

    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(true);
    // A reversible apply must snapshot the prior value before mutating.
    expect(result.beforeSnapshotJson).toBeTruthy();

    const after = configsRepo.getById(target.id);
    const list = mcps(after?.allowedMcpsJson);
    expect(list).toContain('gitnexus'); // the grant landed
    expect(list).toContain('rhythm'); // the prior entry survives (add, not replace)
  });

  it('is idempotent — re-adding an already-present tool does not duplicate it', async () => {
    const configsRepo = new AgentConfigsRepository();
    const target = configsRepo.insert({
      label: 'Orchestrator',
      icon: 'flow',
      allowedMcpsJson: JSON.stringify(['rhythm', 'gitnexus']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'already granted',
      changeJson: JSON.stringify({ agentConfigId: target.id, field: 'allowedMcpsJson', add: ['gitnexus'] }),
      dedupKey: `broaden-scope:${target.id}:mcp:gitnexus2`,
    });
    await applyProposal(proposal);
    const list = mcps(configsRepo.getById(target.id)?.allowedMcpsJson);
    expect(list.filter((n) => n === 'gitnexus')).toHaveLength(1);
  });
});

describe('issue-1139-c3: broaden-scope fails closed on a malformed change', () => {
  it('refuses a change missing agentConfigId with an actionable reason', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'malformed — no agentConfigId',
      changeJson: JSON.stringify({ field: 'allowedMcpsJson', add: ['gitnexus'] }),
      dedupKey: 'broaden-scope:malformed:1',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(false);
    expect(validation.reason ?? '').toMatch(/broaden-scope/i);
    expect(validation.reason ?? '').not.toMatch(/No re-validation is registered/);
  });

  it('refuses a change with an empty add list', async () => {
    const configsRepo = new AgentConfigsRepository();
    const target = configsRepo.insert({ label: 'X', icon: 'flow' });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'malformed — empty add',
      changeJson: JSON.stringify({ agentConfigId: target.id, field: 'allowedMcpsJson', add: [] }),
      dedupKey: 'broaden-scope:malformed:2',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(false);
  });
});

describe('issue-1139-c4: broaden-scope drift guard', () => {
  it('refuses at re-validation when the target agent no longer exists', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'target gone',
      changeJson: JSON.stringify({
        agentConfigId: 'nonexistent-agent-id',
        field: 'allowedMcpsJson',
        add: ['gitnexus'],
      }),
      dedupKey: 'broaden-scope:gone:1',
    });
    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(false);
    expect(validation.reason ?? '').toMatch(/no longer exists/i);
  });
});
