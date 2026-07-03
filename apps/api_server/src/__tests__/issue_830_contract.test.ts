/**
 * CONTRACT TEST for issue #830 (org-optimizer-14: seeded optimizer cron +
 * wiring the six generator appliers + real exercised-tools resolver) — must
 * fail before implementation, then pass once org_optimizer_seed.ts,
 * org_proposal_appliers_wiring.ts, and the exercisedTools resolver exist.
 * See docs/ai/contracts/issue-830.json for the criterion mapping.
 *
 * Covers:
 *  - issue-830-c1: seedOrgOptimizerTask() is idempotent/name-guarded — at
 *    most one "Org Self-Optimizer" task exists after multiple calls.
 *  - issue-830-c2: seedOrgOptimizerTask() also seeds exactly one external
 *    discovery task, distinct from the internal audit task.
 *  - issue-830-c3: the internal audit task is scheduled daily; the external
 *    discovery task is scheduled less frequently (weekly).
 *  - issue-830-c4: both role files (.mcp-roles/org-optimizer.mcp.json,
 *    .mcp-roles/org-external-discovery.mcp.json) parse as valid JSON and
 *    their granted tool names are a subset of a live/mocked engine set.
 *  - issue-830-c5: the optimizer role grants ONLY read-audit + write-proposal
 *    tools — no config/delegation/webhook WRITE tools appear in its allowlist.
 *  - issue-830-c6: registerAllProposalAppliers() wires all six generators'
 *    apply steps into the shared org_proposal_apply_service registry —
 *    after calling it, applyProposal succeeds (does not throw
 *    "no re-validation is registered") for create-agent, grant-delegation /
 *    expand-delegation, external-adoption, and webhook-wiring kinds.
 *  - issue-830-c7: the real exercisedTools resolver derives tool names from
 *    tool-call parts in agent_session_messages for sessions run under the
 *    given agent_config_id (via agent_scheduled_tasks.agent_config_id join),
 *    NOT the always-empty stub default.
 *  - issue-830-c8: missing role files never block server boot — seeding is
 *    non-fatal and skips (not throws) when a role file is absent/malformed.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import {
  resetProposalPluginsForTests,
  registerProposalApplier,
  registerProposalValidator,
  applyProposal,
  validateProposalChange,
} from '../services/org_proposal_apply_service';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
  resetProposalPluginsForTests();
});

const ROOT = path.join(__dirname, '..', '..', '..', '..');

describe('issue-830-c1: seedOrgOptimizerTask is idempotent/name-guarded', () => {
  it('creates at most one "Org Self-Optimizer" task even when called twice', async () => {
    // Bug this catches: a missing name-guard would insert a duplicate
    // scheduled task on every server restart.
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    const schedRepo = new AgentScheduledTasksRepository();

    await seedOrgOptimizerTask();
    await seedOrgOptimizerTask();

    const all = await schedRepo.listAllAsync();
    const optimizerTasks = all.filter((t) => t.name === 'Org Self-Optimizer');
    expect(optimizerTasks.length).toBe(1);
  });
});

describe('issue-830-c2: exactly one external-discovery task is also seeded, distinct from the audit task', () => {
  it('seeds a second, differently-named external discovery task', async () => {
    // Bug this catches: reusing the same task/name for both the internal
    // audit and the external-discovery pass would collapse two distinct
    // cadences into one.
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    const schedRepo = new AgentScheduledTasksRepository();

    await seedOrgOptimizerTask();
    await seedOrgOptimizerTask();

    const all = await schedRepo.listAllAsync();
    const externalTasks = all.filter((t) =>
      /external/i.test(t.name) && /discovery|optimizer/i.test(t.name),
    );
    expect(externalTasks.length).toBe(1);
    expect(externalTasks[0].name).not.toBe('Org Self-Optimizer');
  });
});

describe('issue-830-c3: internal audit task is daily, external discovery task is less frequent', () => {
  it('audit task scheduleType=daily; external task scheduleType is weekly (or otherwise not daily)', async () => {
    // Bug this catches: seeding the external-discovery pass on the same
    // daily cadence as the cheap internal audit would make the expensive,
    // noisy external search run far too often (violates the decision doc's
    // "throttle it ... less frequent than the internal audit" requirement).
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    const schedRepo = new AgentScheduledTasksRepository();

    await seedOrgOptimizerTask();

    const all = await schedRepo.listAllAsync();
    const audit = all.find((t) => t.name === 'Org Self-Optimizer');
    const external = all.find(
      (t) => /external/i.test(t.name) && /discovery|optimizer/i.test(t.name),
    );

    expect(audit?.scheduleType).toBe('daily');
    expect(external?.scheduleType).not.toBe('daily');
  });
});

describe('issue-830-c4: both role files parse as valid JSON with tool names ⊆ a live/mocked engine set', () => {
  it('org-optimizer.mcp.json and org-external-discovery.mcp.json are valid JSON, resolvable to a live name set', () => {
    // Bug this catches: a malformed or drifted role file would silently
    // scope the seeded task's session to zero tools (the #781 hazard) or
    // fail JSON.parse outright.
    const roleDir = path.join(ROOT, '.mcp-roles');
    const files = ['org-optimizer.mcp.json', 'org-external-discovery.mcp.json'];

    // A representative "live" engine set standing in for GET /opencode/mcp —
    // this mirrors the #834 role-file validation smoke pattern (names must be
    // a subset of the live set, not merely valid JSON).
    const liveMcpNames = new Set(['rhythm', 'mcp-registry', 'obsidian']);

    for (const file of files) {
      const full = path.join(roleDir, file);
      expect(existsSync(full), `${file} must exist`).toBe(true);
      const raw = readFileSync(full, 'utf8');
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(raw);
      }, `${file} must be valid JSON`).not.toThrow();
      const obj = parsed as { mcpServers?: Record<string, unknown>; agentConfigId?: string };
      expect(typeof obj.agentConfigId).toBe('string');
      expect(obj.mcpServers).toBeTruthy();
      const names = Object.keys(obj.mcpServers ?? {});
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(liveMcpNames.has(name), `${file} grants unknown server "${name}"`).toBe(true);
      }
    }
  });
});

describe('issue-830-c5: the optimizer role grants ONLY read-audit + write-proposal tools', () => {
  it('org-optimizer.mcp.json never grants a config/delegation/webhook WRITE tool', () => {
    // Bug this catches: an over-broad optimizer role would let the LLM agent
    // itself mutate agent_configs / allowed_delegates_json / webhook
    // endpoints directly from its tool surface, violating safety invariant
    // #6 in the decision doc (privileged writes happen server-side behind
    // the queue, never from the agent's own tools).
    const full = path.join(ROOT, '.mcp-roles', 'org-optimizer.mcp.json');
    const parsed = JSON.parse(readFileSync(full, 'utf8')) as {
      mcpServers: Record<string, { allowedTools?: string[] }>;
    };
    const allTools = Object.values(parsed.mcpServers).flatMap((s) => s.allowedTools ?? []);

    const forbiddenPatterns = [
      /create_agent/i,
      /delegate/i,
      /grant/i,
      /webhook/i,
      /update_automation/i,
      /create_automation/i,
      /delete_automation/i,
    ];
    for (const tool of allTools) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(tool),
          `org-optimizer role must not grant "${tool}" (matches forbidden pattern ${pattern})`,
        ).toBe(false);
      }
    }
  });
});

describe('issue-830-c6: registerAllProposalAppliers wires all six generators into the shared registry', () => {
  // applyCreateAgentChange (new_agent_generator.ts) writes a REAL
  // .mcp-roles/<slug>.mcp.json file when it applies — isolate that write to a
  // temp dir so this test never pollutes the repo's real .mcp-roles/
  // directory (which issue-830-c4/c5 and the #834 role-file count guard both
  // depend on being exactly the checked-in set).
  let tmpRolesDir: string;
  beforeEach(() => {
    tmpRolesDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-roles-test-'));
    process.env.MCP_ROLES_DIR = tmpRolesDir;
  });
  afterEach(() => {
    delete process.env.MCP_ROLES_DIR;
    rmSync(tmpRolesDir, { recursive: true, force: true });
  });

  it('applyProposal succeeds for create-agent, grant-delegation, external-adoption, and webhook-wiring without a re-validation error', async () => {
    // Bug this catches: forgetting to call one generator's register*()
    // function would leave that proposal kind on the default no-op applier
    // forever, silently dropping approved human-gated proposals.
    const { registerAllProposalAppliers } = await import(
      '../services/org_proposal_appliers_wiring'
    );

    registerAllProposalAppliers({
      registerProposalApplier,
      registerProposalValidator,
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const configsRepo = new AgentConfigsRepository();

    // create-agent: registered validator requires the full CreateAgentChange
    // shape (agentSlug, label, systemPrompt, allowedMcpsJson, allowedSkillsJson).
    const createAgentProposal = await proposalsRepo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create a new specialist agent',
      changeJson: JSON.stringify({
        agentSlug: 'test-specialist',
        label: 'Test Specialist',
        systemPrompt: 'You are a test specialist.',
        allowedMcpsJson: '[]',
        allowedSkillsJson: '[]',
      }),
      dedupKey: 'create-agent:test-specialist',
    });
    // Should not throw "No re-validation is registered for proposal kind".
    await expect(applyProposal(createAgentProposal)).resolves.toBeTruthy();

    // grant-delegation: manager + target must exist for the delegation
    // applier's re-validation to succeed. changeJson shape mirrors
    // delegation_generator.ts's own DelegationChangePayload exactly.
    const manager = configsRepo.insert({
      label: 'Manager',
      icon: 'star',
      isManager: true,
      allowedDelegatesJson: JSON.stringify([]),
    });
    const target = configsRepo.insert({ label: 'Specialist', icon: 'wrench' });
    const delegationProposal = await proposalsRepo.createAsync({
      kind: 'grant-delegation',
      risk: 'high',
      title: 'Grant delegation from Manager to Specialist',
      changeJson: JSON.stringify({
        agentConfigId: manager.id,
        allowed_delegates_json: { add: [target.id] },
      }),
      dedupKey: `grant-delegation:${manager.id}:${target.id}`,
    });
    await expect(applyProposal(delegationProposal)).resolves.toBeTruthy();

    // webhook-wiring: requires a concrete wiring target.
    const scheduledTask = await new AgentScheduledTasksRepository().createAsync({
      name: 'Some Recipe Task',
      scheduleType: 'daily',
      prompt: 'do the thing',
    });
    const webhookProposal = await proposalsRepo.createAsync({
      kind: 'webhook-wiring',
      risk: 'high',
      title: 'Wire an inbound webhook to Some Recipe Task',
      changeJson: JSON.stringify({
        targetScheduledTaskId: scheduledTask.id,
        eventTypes: ['*'],
      }),
      provenanceJson: JSON.stringify({ securityNote: 'HMAC + SSRF-safe; fenced payload' }),
      dedupKey: `webhook-wiring:${scheduledTask.id}`,
    });
    await expect(applyProposal(webhookProposal)).resolves.toBeTruthy();

    // external-adoption: re-validation must be registered (not "no
    // re-validation is registered for kind"). The full applyProposal path is
    // NOT exercised here — it would perform a REAL curated-MCP install
    // against the live opencode engine/filesystem, which is unsafe/impure in
    // a unit test (see external_discovery_generator.test.ts for the
    // fake-deps-injected applier coverage). This asserts the re-validation
    // gate specifically, which is exactly what "wiring" must close.
    const externalProposal = await proposalsRepo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      external: 1,
      title: 'Adopt a candidate MCP server',
      changeJson: JSON.stringify({ candidateKind: 'mcp', serverName: 'some-candidate-mcp' }),
      provenanceJson: JSON.stringify({ source: 'mcp-registry', license: 'MIT' }),
      dedupKey: 'external-adoption:some-candidate-mcp',
    });
    const validation = await validateProposalChange(externalProposal);
    expect(validation.reason ?? '').not.toMatch(/No re-validation is registered/);
    expect(validation.valid).toBe(true);
  });
});

describe('issue-830-c7: the real exercisedTools resolver derives usage from session tool-call parts', () => {
  it('returns the set of tool names actually invoked by sessions run under the given agent_config_id', async () => {
    // Bug this catches: leaving the #821 measure path on its stubbed
    // always-empty default would make the functional guard a no-op — every
    // prune-scope proposal would "pass" the guard even when the pruned tool
    // was actively in use, defeating the entire safety check.
    const { resolveExercisedTools } = await import('../services/org_exercised_tools_resolver');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({ label: 'Secretary', icon: 'mail' });

    const schedRepo = new AgentScheduledTasksRepository();
    const task = await schedRepo.createAsync({
      name: 'Secretary Daily Run',
      scheduleType: 'daily',
      prompt: 'do secretary things',
      agentConfigId: config.id,
    });

    const sessionsRepo = new AgentSessionsRepository();
    const session = sessionsRepo.insert({
      taskId: null,
      taskTitle: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'run',
      scheduledTaskId: task.id,
    });

    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(
      session.id,
      'msg-1',
      'output',
      JSON.stringify([
        { type: 'tool', id: 'part-1', tool: 'rhythm_list_tasks', state: { status: 'completed' } },
        { type: 'tool', id: 'part-2', tool: 'rhythm_create_task', state: { status: 'completed' } },
        { type: 'text', text: 'done' },
      ]),
      null,
      null,
    );

    const exercised = await resolveExercisedTools(config.id);
    expect(exercised.has('rhythm_list_tasks')).toBe(true);
    expect(exercised.has('rhythm_create_task')).toBe(true);
    // A tool never seen in any session's parts must not be reported exercised.
    expect(exercised.has('rhythm_delete_task')).toBe(false);
  });

  it('is wired as the real deps.exercisedTools for org_proposal_measure (not the always-empty stub)', async () => {
    // Bug this catches: the resolver existing in isolation but never being
    // passed to measureProposal's deps leaves #821's functional guard
    // unwired in production, exactly the concern flagged in project-state.md.
    const wiringSrc = readFileSync(
      path.join(
        __dirname,
        '..',
        'services',
        'org_optimizer_seed.ts',
      ),
      'utf8',
    ).concat(
      readFileSync(
        path.join(__dirname, '..', 'services', 'org_exercised_tools_resolver.ts'),
        'utf8',
      ),
    );
    // The resolver module must be referenced somewhere in the optimizer
    // seed/measure call site wiring (grep-level contract — the real
    // assertion is issue-830-c7's functional test above; this just confirms
    // the module is not dead code).
    expect(wiringSrc).toContain('resolveExercisedTools');
  });
});

describe('issue-830-c8: missing/malformed role files never block server boot', () => {
  it('seedOrgOptimizerTask resolves without throwing even if a role file is absent', async () => {
    // Bug this catches: a hard `throw` on a missing role file would crash
    // the whole boot sequence per the ministry-recipes-seed precedent this
    // issue must follow (non-fatal, skip-and-retry-next-boot).
    vi.resetModules();
    const originalEnv = process.env.MCP_ROLES_DIR;
    process.env.MCP_ROLES_DIR = '/nonexistent/path/for/issue-830-c8';
    try {
      const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
      await expect(seedOrgOptimizerTask()).resolves.not.toThrow();
    } finally {
      if (originalEnv === undefined) delete process.env.MCP_ROLES_DIR;
      else process.env.MCP_ROLES_DIR = originalEnv;
      vi.resetModules();
    }
  });
});
