/**
 * CONTRACT TEST for issue #824 (org-optimizer-08) — must fail before
 * `services/generators/new_agent_generator.ts` exists, then pass once it is
 * implemented. See docs/ai/contracts/issue-824.json for the criterion mapping.
 *
 * Covers:
 *  - issue-824-c1: gap -> one high-risk create-agent proposal with the
 *    documented change_json shape.
 *  - issue-824-c2: a gap whose proposed scopes cannot resolve against the
 *    live set is not emitted.
 *  - issue-824-c3: apply creates agent_configs with is_manager=0 and writes
 *    a valid role file.
 *  - issue-824-c4: apply rejects when a proposed name is no longer live at
 *    apply time.
 *  - issue-824-c5: create-agent is never reachable from the auto-apply path.
 *  - issue-824-c6: registerNewAgentApplier wires into the
 *    org_proposal_apply_service seam.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { classifyProposalRisk } from '../services/org_risk_classifier';
import {
  applyProposal as autoApplyProposal,
} from '../services/org_proposal_apply';
import {
  registerProposalApplier,
  registerProposalValidator,
  applyProposal as queueApplyProposal,
  validateProposalChange,
  resetProposalPluginsForTests,
} from '../services/org_proposal_apply_service';

// ── opencode_engine mock — the gated apply step re-checks live names at
// apply time via opencodeClient.listMcp()/listSkills(); this mock lets each
// test control the "live at apply time" set independently of proposal time. ──
let mockIsReady = true;
const listMcp = vi.fn();
const listSkills = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return {
      get isReady() {
        return mockIsReady;
      },
      listMcp: (...a: unknown[]) => listMcp(...a),
      listSkills: (...a: unknown[]) => listSkills(...a),
    };
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let tmpRolesDir: string;

beforeEach(() => {
  setDb(makeDb());
  resetProposalPluginsForTests();
  tmpRolesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-roles-test-'));
  process.env.MCP_ROLES_DIR = tmpRolesDir;
  mockIsReady = true;
  listMcp.mockReset();
  listSkills.mockReset();
  listMcp.mockResolvedValue({ rhythm: {} });
  listSkills.mockResolvedValue([{ name: 'coding-agent', location: 'x' }]);
});

afterEach(() => {
  delete process.env.MCP_ROLES_DIR;
  fs.rmSync(tmpRolesDir, { recursive: true, force: true });
});

describe('issue-824-c1: gap -> one high-risk create-agent proposal with the documented change_json shape', () => {
  it('emits a single create-agent proposal whose change_json carries id/label/systemPrompt + allowlists', async () => {
    // Bug this catches: the generator emits the wrong risk tier, omits a
    // required change_json field, or emits more/fewer than one proposal for
    // a single coverage-gap signal.
    const { generateCreateAgentProposal } = await import(
      '../services/generators/new_agent_generator'
    );

    const proposalsRepo = new AgentOrgProposalsRepository();
    const liveMcpNames = new Set(['rhythm', 'obsidian']);
    const liveSkillNames = new Set(['coding-agent']);

    const result = await generateCreateAgentProposal(
      {
        gapId: 'coverage-gap:worship-tech-1',
        evidence: 'toolName=propresenter_trigger_cue deniedCount=7 noFittingProfile=true',
        proposedId: 'worship-tech',
        proposedLabel: 'Worship Tech Operator',
        proposedSystemPrompt: 'You operate ProPresenter cues during service.',
        proposedAllowedMcps: ['rhythm', 'obsidian'],
        proposedAllowedSkills: ['coding-agent'],
      },
      { proposalsRepo, liveMcpNames, liveSkillNames },
    );

    expect(result.emitted).toBe(true);
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed).toHaveLength(1);
    const proposal = proposed[0];
    expect(proposal.kind).toBe('create-agent');
    expect(proposal.risk).toBe('high');
    expect(classifyProposalRisk(proposal)).toBe('high');

    const change = JSON.parse(proposal.changeJson!);
    expect(change.agentSlug).toBe('worship-tech');
    expect(change.label).toBe('Worship Tech Operator');
    expect(change.systemPrompt).toContain('ProPresenter');
    expect(change.allowedMcpsJson).toBe(JSON.stringify(['rhythm', 'obsidian']));
    expect(change.allowedSkillsJson).toBe(JSON.stringify(['coding-agent']));
  });
});

describe('issue-824-c2: a gap whose proposed scopes cannot resolve against the live set is not emitted', () => {
  it('does not create a proposal when a proposed MCP name has no live match', async () => {
    // Bug this catches: the generator trusts its own proposed names without
    // checking them against mcp_name_alignment, so a hallucinated/dead MCP
    // name could reach a human reviewer as if it were valid.
    const { generateCreateAgentProposal } = await import(
      '../services/generators/new_agent_generator'
    );

    const proposalsRepo = new AgentOrgProposalsRepository();
    const liveMcpNames = new Set(['rhythm']); // 'nonexistent-mcp' has no match
    const liveSkillNames = new Set(['coding-agent']);

    const result = await generateCreateAgentProposal(
      {
        gapId: 'coverage-gap:bad-scope',
        evidence: 'toolName=fake_tool deniedCount=5 noFittingProfile=true',
        proposedId: 'bad-agent',
        proposedLabel: 'Bad Agent',
        proposedSystemPrompt: 'Does something.',
        proposedAllowedMcps: ['rhythm', 'nonexistent-mcp'],
        proposedAllowedSkills: ['coding-agent'],
      },
      { proposalsRepo, liveMcpNames, liveSkillNames },
    );

    expect(result.emitted).toBe(false);
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed).toHaveLength(0);
  });

  it('does not create a proposal when a proposed skill name has no live match', async () => {
    const { generateCreateAgentProposal } = await import(
      '../services/generators/new_agent_generator'
    );
    const proposalsRepo = new AgentOrgProposalsRepository();
    const result = await generateCreateAgentProposal(
      {
        gapId: 'coverage-gap:bad-skill',
        evidence: 'toolName=fake_tool deniedCount=5 noFittingProfile=true',
        proposedId: 'bad-agent-2',
        proposedLabel: 'Bad Agent 2',
        proposedSystemPrompt: 'Does something.',
        proposedAllowedMcps: ['rhythm'],
        proposedAllowedSkills: ['nonexistent-skill'],
      },
      {
        proposalsRepo,
        liveMcpNames: new Set(['rhythm']),
        liveSkillNames: new Set(['coding-agent']),
      },
    );
    expect(result.emitted).toBe(false);
    expect(await proposalsRepo.listByStatusAsync('proposed')).toHaveLength(0);
  });
});

describe('issue-824-c3: apply creates agent_configs with is_manager=0 and writes a valid role file', () => {
  it('creates the agent_configs row and a .mcp-roles/<slug>.mcp.json passing the alignment invariant', async () => {
    // Bug this catches: apply forgets is_manager=0 (defaulting to whatever
    // the DB default happens to be) or writes a role file shape that does
    // not match { mcpServers: {...} }, breaking resolveMcpRole().
    const { registerNewAgentApplier } = await import(
      '../services/generators/new_agent_generator'
    );
    registerNewAgentApplier({ registerProposalApplier, registerProposalValidator });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      status: 'approved',
      title: 'Create Worship Tech Operator',
      changeJson: JSON.stringify({
        agentSlug: 'worship-tech',
        label: 'Worship Tech Operator',
        systemPrompt: 'You operate ProPresenter cues during service.',
        allowedMcpsJson: JSON.stringify(['rhythm']),
        allowedSkillsJson: JSON.stringify(['coding-agent']),
      }),
      dedupKey: 'create-agent:worship-tech',
    });

    const result = await queueApplyProposal(proposal);
    expect(result.measurable).toBe(false);

    const configsRepo = new AgentConfigsRepository();
    const created = configsRepo.getById('worship-tech');
    expect(created).not.toBeNull();
    expect(created!.isManager).toBe(false);
    expect(created!.label).toBe('Worship Tech Operator');

    const rolePath = path.join(tmpRolesDir, 'worship-tech.mcp.json');
    expect(fs.existsSync(rolePath)).toBe(true);
    const roleFile = JSON.parse(fs.readFileSync(rolePath, 'utf8'));
    expect(roleFile).toHaveProperty('mcpServers');
    expect(Object.keys(roleFile.mcpServers)).toContain('rhythm');
  });
});

describe('issue-824-c4: apply rejects when a proposed name is no longer live at apply time', () => {
  it('does not create an agent_configs row or role file when a name has drifted dead since proposal time', async () => {
    // Bug this catches: apply trusts the change_json blindly instead of
    // re-checking names against the CURRENT live set, so a name that died
    // between proposal and human approval would still get written into a
    // live role file (the #781 hazard, but at agent-creation time).
    const { registerNewAgentApplier } = await import(
      '../services/generators/new_agent_generator'
    );
    registerNewAgentApplier({ registerProposalApplier, registerProposalValidator });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      status: 'approved',
      title: 'Create Drifted Agent',
      changeJson: JSON.stringify({
        agentSlug: 'drifted-agent',
        label: 'Drifted Agent',
        systemPrompt: 'Does something.',
        allowedMcpsJson: JSON.stringify(['now-dead-mcp']),
        allowedSkillsJson: JSON.stringify([]),
      }),
      dedupKey: 'create-agent:drifted-agent',
    });

    await expect(queueApplyProposal(proposal)).rejects.toThrow();

    const configsRepo = new AgentConfigsRepository();
    expect(configsRepo.getById('drifted-agent')).toBeNull();
    const rolePath = path.join(tmpRolesDir, 'drifted-agent.mcp.json');
    expect(fs.existsSync(rolePath)).toBe(false);
  });
});

describe('issue-824-c5: create-agent is not reachable from the auto-apply path (gate assertion)', () => {
  it('org_proposal_apply.ts (the auto-apply lane) refuses a create-agent proposal outright', async () => {
    // Bug this catches: a future change accidentally reclassifies
    // create-agent as low-risk, or the auto-apply path stops re-checking
    // classifyProposalRisk, silently making agent creation reachable without
    // human sign-off.
    expect(classifyProposalRisk({ kind: 'create-agent' })).toBe('high');

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Should never auto-apply',
      changeJson: JSON.stringify({
        agentSlug: 'auto-path-agent',
        label: 'Auto Path Agent',
        systemPrompt: 'x',
        allowedMcpsJson: JSON.stringify(['rhythm']),
        allowedSkillsJson: JSON.stringify([]),
      }),
      dedupKey: 'create-agent:auto-path-agent',
    });

    const result = await autoApplyProposal(proposal);
    expect(result.status).toBe('refused-high-risk');

    const configsRepo = new AgentConfigsRepository();
    expect(configsRepo.getById('auto-path-agent')).toBeNull();
  });
});

describe('issue-824-c6: registerNewAgentApplier wires validator+applier into the org_proposal_apply_service seam', () => {
  it('after registration, validateProposalChange and applyProposal both resolve for kind=create-agent via the shared seam', async () => {
    // Bug this catches: registerNewAgentApplier only registers one of the two
    // (validator or applier), so the queue's re-validation-then-apply
    // sequence breaks even though apply "seems" wired.
    const { registerNewAgentApplier } = await import(
      '../services/generators/new_agent_generator'
    );

    resetProposalPluginsForTests();
    registerNewAgentApplier({ registerProposalApplier, registerProposalValidator });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      status: 'approved',
      title: 'Wiring check agent',
      changeJson: JSON.stringify({
        agentSlug: 'wiring-check-agent',
        label: 'Wiring Check Agent',
        systemPrompt: 'x',
        allowedMcpsJson: JSON.stringify(['rhythm']),
        allowedSkillsJson: JSON.stringify([]),
      }),
      dedupKey: 'create-agent:wiring-check-agent',
    });

    const validation = await validateProposalChange(proposal);
    expect(validation.valid).toBe(true);

    const applyResult = await queueApplyProposal(proposal);
    expect(applyResult.measurable).toBe(false);

    const configsRepo = new AgentConfigsRepository();
    expect(configsRepo.getById('wiring-check-agent')).not.toBeNull();
  });
});
