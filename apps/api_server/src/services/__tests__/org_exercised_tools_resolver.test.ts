/**
 * CONTRACT TEST for issue #853 (org-optimizer-19: broaden exercisedTools
 * telemetry) — must fail before implementation (i.e. before the mcp_role
 * join is added to org_exercised_tools_resolver.ts), then pass once the
 * resolver attributes tool usage from interactive (non-scheduled) sessions
 * in addition to scheduled-task sessions.
 * See docs/ai/contracts/issue-853.json for the criterion mapping.
 *
 * Covers:
 *  - issue-853-c1: a session matched ONLY by mcp_role (no scheduled_task_id)
 *    contributes its tool names to the exercised set.
 *  - issue-853-c2: a tool used ONLY in an interactive mcp_role session (never
 *    in any scheduled-task session) is reported exercised — the exact prior
 *    gap the issue describes ("a tool used only interactively looks 'never
 *    invoked' -> gets wrongly proposed for prune").
 *  - issue-853-c3: the #821 measure functional guard (org_proposal_measure.
 *    measureProposal), using the REAL default resolver (not an injected
 *    fake), reverts a prune-scope proposal that removed a tool now visible
 *    only via the mcp_role join.
 *  - issue-853-c4: window/time-bounding is preserved for mcp_role-matched
 *    sessions — a session created before `sinceIso` is excluded.
 *  - issue-853-c5: mcp_role is only trusted when it equals a REAL
 *    agent_configs.id — a legacy `.mcp-roles/<slug>` style role name stored
 *    in mcp_role must never be treated as a match.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb, getDb } from '../../database/db';
import { env } from '../../config/env';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../../repositories/agent_session_messages_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { opencodeClient } from '../opencode_engine';
import { resolveKnownMcpServerName, resolveMcpServerIdentity } from '../mcp_scope_name';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

function toolPart(tool: string) {
  return { type: 'tool', id: `part-${tool}`, tool, state: { status: 'completed' } };
}

describe('known-catalog MCP callable identity', () => {
  const catalog = ['pco-services', 'gitnexus', 'git', 'gitnexus-admin'];

  it('resolves callable names to their canonical server ids', () => {
    expect(resolveMcpServerIdentity('pco-services_get_plans', catalog)).toBe('pco-services');
    expect(resolveMcpServerIdentity('gitnexus_query', catalog)).toBe('gitnexus');
  });

  it('prefers exact ids, then the longest catalog prefix', () => {
    expect(resolveMcpServerIdentity('gitnexus', catalog)).toBe('gitnexus');
    expect(resolveMcpServerIdentity('gitnexus-admin_query', catalog)).toBe('gitnexus-admin');
  });

  it('leaves unknown or ambiguous callable names unresolved', () => {
    expect(resolveMcpServerIdentity('unknown_query', catalog)).toBeNull();
    expect(resolveMcpServerIdentity('shared_query', ['shared', 'shared'])).toBeNull();
  });

  it('preserves best-effort config resolution when the engine catalog is unavailable', async () => {
    const listMcp = vi.spyOn(opencodeClient, 'listMcp').mockRejectedValueOnce(new Error('offline'));
    await expect(resolveKnownMcpServerName('gitnexus')).resolves.toEqual({
      serverName: 'gitnexus',
      knownServerNames: [],
    });
    listMcp.mockResolvedValueOnce({});
    await expect(resolveKnownMcpServerName('pco-services')).resolves.toEqual({
      serverName: 'pco-services',
      knownServerNames: [],
    });
    listMcp.mockRestore();
  });
});

describe('exercised telemetry availability', () => {
  it('distinguishes no-attributable-sessions telemetry from postgres-unsupported telemetry', async () => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({ label: 'Empty', icon: 'x' });

    // No session is attributable to this profile at all — the observation
    // window is empty, not zero-use, so this must be unavailable rather than
    // available-empty (see W2 cycle 1: a catalog-present, zero-session
    // profile used to fail open to available-empty).
    const noSessions = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(noSessions).toMatchObject({
      availability: 'unavailable',
      reason: 'no-attributable-sessions',
    });

    const originalDbClient = env.dbClient;
    (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'postgres';
    try {
      const unavailable = await resolveExercisedTools(config.id, undefined, ['rhythm']);
      expect(unavailable).toMatchObject({
        availability: 'unavailable',
        reason: 'postgres-unsupported',
      });
    } finally {
      (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = originalDbClient;
    }
  });

  it('reports database failures as unavailable instead of available-empty', async () => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const db = getDb();
    db.close();

    const result = await resolveExercisedTools('profile-id', undefined, ['rhythm']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'database-error' });
  });

  it('reports malformed persisted parts as unavailable instead of ignoring them', async () => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({ label: 'Malformed', icon: 'x' });
    const sessionsRepo = new AgentSessionsRepository();
    const session = sessionsRepo.insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'malformed telemetry',
      mcpRole: config.id,
    });
    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(
      session.id,
      'malformed-message',
      'output',
      JSON.stringify([toolPart('rhythm_ping')]),
      null,
      null,
    );
    getDb()
      .prepare(`UPDATE agent_session_messages SET parts_json = ? WHERE sdk_message_id = ?`)
      .run('{not-json', 'malformed-message');

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'unreadable-source' });
  });

  it('reports malformed tool parts as unavailable instead of treating them as zero use', async () => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Malformed tool', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'malformed tool telemetry',
      mcpRole: config.id,
    });
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      'malformed-tool-message',
      'output',
      JSON.stringify([{ type: 'tool', state: { status: 'completed' } }]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'unreadable-source' });
  });

  it('reports a missing catalog as unavailable instead of available-empty', async () => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'No catalog', icon: 'x' });

    const result = await resolveExercisedTools(config.id);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'catalog-unavailable' });
  });

  it('reports sessions with zero structured parts rows as unavailable, not empty-available', async () => {
    // Bug this catches: an attributed session existing is not proof that
    // structured telemetry ever captured it — a profile with real sessions
    // but zero readable agent_session_messages rows must not be reported as
    // "available, nothing exercised" (that would look identical to genuine
    // zero use and let a prune guard pass incorrectly).
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'No structured rows', icon: 'x' });
    new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'session with no persisted messages',
      mcpRole: config.id,
    });

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'no-structured-telemetry' });
  });

  it('reports genuine zero use as available-empty when structured coverage is readable', async () => {
    // The positive counterpart to the previous test: once a session
    // contributes an actually-readable structured row (an empty tool-parts
    // array, `parts_json: '[]'`), that IS proof the capture pipeline saw
    // this traffic and recorded no tool use — this must resolve `available`
    // with an empty canonical set, not `unavailable`.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Instrumented zero-use', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'genuinely instrumented session',
      mcpRole: config.id,
    });
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      'zero-use-message',
      'output',
      '[]',
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({
      availability: 'available',
      rawCallableNames: new Set(),
      canonicalServerIds: new Set(),
    });
  });

  it('reports partial structured coverage across attributed sessions as unavailable, not empty-available', async () => {
    // Bug this catches: a profile with two attributed sessions where only
    // one contributed a readable structured row used to be treated as fully
    // observed the moment ANY row existed — the uncovered session's traffic
    // (which could easily be where a tool was actually used) was silently
    // dropped from the observation instead of making the whole window
    // partial. Partial telemetry must never look identical to full coverage.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Partially instrumented', icon: 'x' });
    const sessionsRepo = new AgentSessionsRepository();
    const coveredSession = sessionsRepo.insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'covered session',
      mcpRole: config.id,
    });
    sessionsRepo.insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'uncovered session',
      mcpRole: config.id,
    });
    // Only one of the two attributed sessions ever persisted a structured
    // row; the other has none at all.
    new AgentSessionMessagesRepository().upsertStructured(
      coveredSession.id,
      'zero-use-message',
      'output',
      '[]',
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({
      availability: 'unavailable',
      reason: 'partial-structured-telemetry',
      rawCallableNames: new Set(),
      canonicalServerIds: new Set(),
    });
  });

  it('reports available-empty only once EVERY attributed session has readable structured coverage', async () => {
    // The positive counterpart, generalized to multiple sessions: once every
    // attributed session (not just some of them) contributes a readable
    // empty tool-parts row, the observation window is complete and genuine
    // zero-use is provable — this is the only fixture shape allowed to
    // resolve available-empty with more than one attributed session.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Fully instrumented', icon: 'x' });
    const sessionsRepo = new AgentSessionsRepository();
    const sessionA = sessionsRepo.insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'session a',
      mcpRole: config.id,
    });
    const sessionB = sessionsRepo.insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'session b',
      mcpRole: config.id,
    });
    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(sessionA.id, 'msg-a', 'output', '[]', null, null);
    messagesRepo.upsertStructured(sessionB.id, 'msg-b', 'output', '[]', null, null);

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({
      availability: 'available',
      rawCallableNames: new Set(),
      canonicalServerIds: new Set(),
    });
  });

  it('returns both raw callable names and canonical server ids when available', async () => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Canonical', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'canonical telemetry',
      mcpRole: config.id,
    });
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      'canonical-message',
      'output',
      JSON.stringify([toolPart('pco-services_get_plans'), toolPart('gitnexus_query')]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, [
      'pco-services',
      'gitnexus',
    ]);
    expect(result).toMatchObject({
      availability: 'available',
      rawCallableNames: new Set(['pco-services_get_plans', 'gitnexus_query']),
      canonicalServerIds: new Set(['pco-services', 'gitnexus']),
    });
  });
});

describe('issue-853-c1: a session matched only by mcp_role contributes its tool names', () => {
  it('resolveExercisedTools includes tool names from a session matched only by mcp_role (no scheduled_task_id)', async () => {
    // Bug this catches: prior to #853, this resolver only ever joined via
    // agent_scheduled_tasks.agent_config_id -> agent_sessions.scheduled_task_id.
    // A session with scheduled_task_id = NULL (interactive) but a valid
    // mcp_role pointing at the profile was completely invisible.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({ label: 'Secretary', icon: 'mail' });

    const sessionsRepo = new AgentSessionsRepository();
    const session = sessionsRepo.insert({
      taskId: null,
      taskTitle: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'interactive run',
      mcpRole: config.id,
      // scheduledTaskId intentionally omitted — this is the interactive path.
    });

    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(
      session.id,
      'msg-1',
      'output',
      JSON.stringify([toolPart('rhythm_search_memory'), { type: 'text', text: 'done' }]),
      null,
      null,
    );

    const exercised = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(exercised.has('rhythm_search_memory')).toBe(true);
  });
});

describe('issue-853-c2: a tool used ONLY interactively is no longer wrongly proposed for prune', () => {
  it('a tool used only in an interactive mcp_role session is reported exercised, closing the prior scheduled-task-only gap', async () => {
    // Bug this catches: the exact regression named in the issue — a tool
    // exercised only via an interactive session used to be indistinguishable
    // from a tool that was NEVER exercised, so scope_hygiene_generator's
    // drift signal (fed by the same "what does this profile actually use"
    // question) could target it for removal with no guard to stop it. This
    // test proves the resolver itself now reports it exercised — the
    // necessary precondition for the guard in org_proposal_measure to work.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({ label: 'Worship Planning', icon: 'music' });

    // A scheduled task exists for this profile, but its sessions never call
    // rhythm_pco_list_plans — only an interactive session does.
    const schedRepo = new AgentScheduledTasksRepository();
    const task = await schedRepo.createAsync({
      name: 'Worship Weekly Run',
      scheduleType: 'weekly',
      prompt: 'plan the week',
      agentConfigId: config.id,
    });

    const sessionsRepo = new AgentSessionsRepository();
    const scheduledSession = sessionsRepo.insert({
      taskId: null,
      taskTitle: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'scheduled run',
      scheduledTaskId: task.id,
    });
    const interactiveSession = sessionsRepo.insert({
      taskId: null,
      taskTitle: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'interactive run',
      mcpRole: config.id,
    });

    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(
      scheduledSession.id,
      'msg-1',
      'output',
      JSON.stringify([toolPart('rhythm_pco_list_service_types')]),
      null,
      null,
    );
    messagesRepo.upsertStructured(
      interactiveSession.id,
      'msg-1',
      'output',
      JSON.stringify([toolPart('rhythm_pco_list_plans')]),
      null,
      null,
    );

    const exercised = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    // The scheduled-task-only signal (pre-#853 behavior) already saw this one.
    expect(exercised.has('rhythm_pco_list_service_types')).toBe(true);
    // Pre-#853, this assertion would FAIL: rhythm_pco_list_plans was only
    // ever used in the interactive session, invisible to the old resolver.
    expect(exercised.has('rhythm_pco_list_plans')).toBe(true);
  });
});

describe('issue-853-c3: the #821 functional guard still refuses to keep a prune of a now-exercised tool', () => {
  it('measureProposal reverts a prune-scope proposal when the broadened resolver reports the removed tool as exercised via an interactive mcp_role session', async () => {
    // Bug this catches: if the mcp_role join were reverted (or never added),
    // org_proposal_measure's functional guard would see an EMPTY exercised
    // set for this profile (no scheduled-task sessions exist at all here),
    // conclude "nothing removed was in use", and wrongly KEEP the prune —
    // even though a human is actively using the tool interactively right now.
    const { measureProposal } = await import('../org_proposal_measure');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const sessionsRepo = new AgentSessionsRepository();
    const interactiveSession = sessionsRepo.insert({
      taskId: null,
      taskTitle: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'interactive run',
      mcpRole: config.id,
    });

    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(
      interactiveSession.id,
      'msg-1',
      'output',
      JSON.stringify([toolPart('rhythm_send_email')]),
      null,
      null,
    );

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune unused rhythm from Secretary',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['rhythm'],
      }),
      // Mirrors the real apply step's snapshot shape (org_proposal_apply.ts's
      // applyAgentConfigScopeChange: `{ [field]: priorValue }`) so a revert
      // outcome here has somewhere real to restore to, exactly like the
      // production apply -> measure handoff.
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['rhythm']) }),
      dedupKey: `prune-scope:${config.id}:rhythm_send_email`,
    });

    const ready = vi.spyOn(opencodeClient, 'isReady', 'get').mockReturnValue(true);
    const listMcp = vi
      .spyOn(opencodeClient, 'listMcp')
      .mockResolvedValue({ rhythm: { status: 'connected' } });
    try {
      // No `deps.exercisedTools` override: the default path must fetch the
      // catalog, resolve raw callables canonically, and fail the guard.
      await expect(measureProposal(proposal)).resolves.toBe('reverted');
    } finally {
      ready.mockRestore();
      listMcp.mockRestore();
    }

    const updated = await proposalsRepo.findByIdAsync(proposal.id);
    expect(updated?.status).toBe('reverted');
    expect(updated?.measureReason ?? '').toMatch(/functional guard failed/i);
  });

  it('leaves a scope proposal measuring when exercised telemetry is unavailable', async () => {
    const { measureProposal } = await import('../org_proposal_measure');
    const config = new AgentConfigsRepository().insert({
      label: 'Unavailable',
      icon: 'x',
      allowedMcpsJson: JSON.stringify([]),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune gitnexus',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['gitnexus']) }),
      dedupKey: `prune-scope:${config.id}:gitnexus`,
    });

    const outcome = await measureProposal(proposal, {
      exercisedTools: async () => ({
        availability: 'unavailable' as const,
        reason: 'database-error' as const,
        rawCallableNames: new Set<string>(),
        canonicalServerIds: new Set<string>(),
        has: () => false,
      }),
    });
    expect(outcome).toBe('skipped');
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('measuring');
  });
});

describe('issue-853-c4: window/time-bounding is preserved for the mcp_role join', () => {
  it('an mcp_role-matched session created before sinceIso is excluded from the exercised set', async () => {
    // Bug this catches: adding the mcp_role join without applying the same
    // `created_at >= sinceIso` bound as the scheduled-task join would make
    // "exercised" mean "ever, in all of history" for interactive sessions —
    // silently widening the trailing window the rest of the module (and
    // #821's decision doc) documents as 30 days.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({ label: 'Secretary', icon: 'mail' });

    const sessionsRepo = new AgentSessionsRepository();
    const oldSession = sessionsRepo.insert({
      taskId: null,
      taskTitle: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'old interactive run',
      mcpRole: config.id,
    });

    // Backdate the session's created_at to well before the window cutoff.
    getDb()
      .prepare(`UPDATE agent_sessions SET created_at = ? WHERE id = ?`)
      .run('2000-01-01T00:00:00.000Z', oldSession.id);

    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(
      oldSession.id,
      'msg-1',
      'output',
      JSON.stringify([toolPart('rhythm_delete_task')]),
      null,
      null,
    );

    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const exercised = await resolveExercisedTools(config.id, sinceIso, ['rhythm']);
    expect(exercised.has('rhythm_delete_task')).toBe(false);
  });
});

describe('issue-853-c5: mcp_role is only trusted when it is a real agent_configs.id', () => {
  it('a session whose mcp_role is a legacy role-slug string (not a real agent_configs.id) is ignored by the mcp_role join', async () => {
    // Bug this catches: legacy paths (POST /agent-sessions C1, agent_runner
    // role-slug) can store a `.mcp-roles/<slug>` role NAME in mcp_role
    // instead of a real agent_configs.id (see opencode_stream_bridge.ts's
    // _resolveDeniedAgentConfigId for the precedent). If the mcp_role join
    // trusted any non-null mcp_role string outright, a legacy slug session
    // could be miscounted as belonging to an unrelated profile whose id
    // happens to be requested, corrupting the functional guard's signal.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({ label: 'Secretary', icon: 'mail' });

    const sessionsRepo = new AgentSessionsRepository();
    const legacySlugSession = sessionsRepo.insert({
      taskId: null,
      taskTitle: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'legacy role-slug session',
      // A legacy `.mcp-roles/<slug>` style value — NOT config.id.
      mcpRole: 'church-admin',
    });

    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertStructured(
      legacySlugSession.id,
      'msg-1',
      'output',
      JSON.stringify([toolPart('rhythm_create_reservation')]),
      null,
      null,
    );

    const exercised = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(exercised.has('rhythm_create_reservation')).toBe(false);
  });
});
