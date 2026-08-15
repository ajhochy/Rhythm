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

/** A producer-valid `type:'tool'` part (message-v2.ts ToolPart/ToolStateCompleted shape). */
function toolPart(
  tool: string,
  messageID: string,
  overrides: { mcpResult?: { _meta?: Record<string, unknown>; isError?: boolean } } = {},
) {
  return {
    type: 'tool',
    id: `prt_${tool}`,
    sessionID: 'ses_test_session',
    messageID,
    callID: `call_${tool}`,
    tool,
    state: {
      status: 'completed',
      input: {},
      output: 'ok',
      title: tool,
      metadata: {},
      time: { start: 0, end: 1 },
      ...(overrides.mcpResult ? { mcpResult: overrides.mcpResult } : {}),
    },
  };
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
      'msg_malformed',
      'output',
      JSON.stringify([toolPart('rhythm_ping', 'msg_malformed')]),
      null,
      null,
    );
    getDb()
      .prepare(`UPDATE agent_session_messages SET parts_json = ? WHERE sdk_message_id = ?`)
      .run('{not-json', 'msg_malformed');

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

  it.each([
    ['an empty string', ''],
    ['a parsed non-array', JSON.stringify({ type: 'text' })],
    ['a record without a string type', JSON.stringify([{ text: 'missing type' }])],
  ])('treats %s parts container as unreadable', async (_label, partsJson) => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: `Malformed ${_label}`, icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: `malformed ${_label}`,
      mcpRole: config.id,
    });
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      `msg_malformed_${_label.replace(/[^a-z0-9]+/gi, '_')}`,
      'output',
      partsJson,
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'unreadable-source' });
  });

  it('treats a non-record array entry as unreadable and never lets measurement keep the removal', async () => {
    // Bug this catches: `[null]` used to be treated as a readable row with no
    // tools, turning malformed capture into negative evidence that could keep
    // an already-applied scope removal.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const { measureProposal } = await import('../org_proposal_measure');
    const config = new AgentConfigsRepository().insert({
      label: 'Null part',
      icon: 'x',
      allowedMcpsJson: JSON.stringify([]),
    });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'null part telemetry',
      mcpRole: config.id,
    });
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      'msg_null_part',
      'output',
      '[null]',
      null,
      null,
    );

    const telemetry = await resolveExercisedTools(config.id, undefined, ['gitnexus']);
    expect(telemetry).toMatchObject({ availability: 'unavailable', reason: 'unreadable-source' });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      status: 'measuring',
      title: 'Prune gitnexus under malformed capture',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['gitnexus']) }),
      dedupKey: `prune-scope:${config.id}:gitnexus:null-part`,
    });
    const outcome = await measureProposal(proposal, { exercisedTools: async () => telemetry });
    expect(outcome).toBe('skipped');
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('measuring');
  });

  it('treats one NULL output row plus one readable text output row as unavailable', async () => {
    // Bug this catches: the SQL used to discard NULL output rows and mark a
    // session covered as soon as any other readable row existed.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Partial output row', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'partial output capture',
      mcpRole: config.id,
    });
    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertMessageInfo(session.id, 'msg_missing_parts', 'output', null, null);
    messagesRepo.upsertStructured(
      session.id,
      'msg_text',
      'output',
      JSON.stringify([
        {
          type: 'text',
          text: 'readable non-tool output',
          id: 'prt_text',
          sessionID: 'ses_text',
          messageID: 'msg_text',
        },
      ]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['gitnexus']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'unreadable-source' });
  });

  it('queries output rows only: legacy NULL input/system rows do not cover or poison a session', async () => {
    // Bug this catches: broadening the completeness scan to every message
    // role would let legacy input/system NULL rows poison valid output
    // coverage, or incorrectly count them as output coverage.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Role-filtered coverage', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'legacy non-output rows',
      mcpRole: config.id,
    });
    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.append(session.id, 'input', 'legacy input', 'legacy input');
    messagesRepo.append(session.id, 'system', 'legacy system', 'legacy system');

    const noOutput = await resolveExercisedTools(config.id, undefined, ['gitnexus']);
    expect(noOutput).toMatchObject({
      availability: 'unavailable',
      reason: 'no-structured-telemetry',
    });

    messagesRepo.upsertStructured(session.id, 'msg_empty_output', 'output', '[]', null, null);
    const coveredOutput = await resolveExercisedTools(config.id, undefined, ['gitnexus']);
    expect(coveredOutput).toMatchObject({
      availability: 'available',
      rawCallableNames: new Set(),
      canonicalServerIds: new Set(),
    });
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
      'msg_canonical',
      'output',
      JSON.stringify([
        toolPart('pco-services_get_plans', 'msg_canonical'),
        toolPart('gitnexus_query', 'msg_canonical'),
      ]),
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
      'msg_interactive_one',
      'output',
      JSON.stringify([
        toolPart('rhythm_search_memory', 'msg_interactive_one'),
        {
          type: 'text',
          text: 'done',
          id: 'prt_interactive_text',
          sessionID: 'ses_test_session',
          messageID: 'msg_interactive_one',
        },
      ]),
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
      'msg_scheduled',
      'output',
      JSON.stringify([toolPart('rhythm_pco_list_service_types', 'msg_scheduled')]),
      null,
      null,
    );
    messagesRepo.upsertStructured(
      interactiveSession.id,
      'msg_interactive',
      'output',
      JSON.stringify([toolPart('rhythm_pco_list_plans', 'msg_interactive')]),
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
      'msg_measure_interactive',
      'output',
      JSON.stringify([toolPart('rhythm_send_email', 'msg_measure_interactive')]),
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
        knownServerIds: new Set<string>(),
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
      'msg_old_interactive',
      'output',
      JSON.stringify([toolPart('rhythm_delete_task', 'msg_old_interactive')]),
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
      'msg_legacy_slug',
      'output',
      JSON.stringify([toolPart('rhythm_create_reservation', 'msg_legacy_slug')]),
      null,
      null,
    );

    const exercised = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(exercised.has('rhythm_create_reservation')).toBe(false);
  });
});

describe('W2 P1-4: only a producer-valid completed (non-mcp-error) tool part counts as successful use', () => {
  it('counts ONLY the genuinely-completed-and-non-error call out of a pending/running/error/mcp-error/success status matrix', async () => {
    // Bug this catches: extractToolNamesFromPartsJson used to model only
    // `{type, tool}` and never checked `state.status` at all, so a tool that
    // was merely pending, still running, failed, or MCP-errored looked
    // indistinguishable from a genuinely successful call.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Status Matrix', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'status matrix session',
      mcpRole: config.id,
    });

    const pendingPart = {
      type: 'tool',
      id: 'prt_pending',
      sessionID: 'ses_test_session',
      messageID: 'msg_status_matrix',
      callID: 'call_pending',
      tool: 'rhythm_pending_call',
      state: { status: 'pending', input: {}, raw: 'raw-pending' },
    };
    const runningPart = {
      type: 'tool',
      id: 'prt_running',
      sessionID: 'ses_test_session',
      messageID: 'msg_status_matrix',
      callID: 'call_running',
      tool: 'rhythm_running_call',
      state: { status: 'running', input: {}, time: { start: 0 } },
    };
    const errorPart = {
      type: 'tool',
      id: 'prt_error',
      sessionID: 'ses_test_session',
      messageID: 'msg_status_matrix',
      callID: 'call_error',
      tool: 'rhythm_error_call',
      state: { status: 'error', input: {}, error: 'boom', time: { start: 0, end: 1 } },
    };
    const mcpErrorPart = toolPart('rhythm_mcp_error_call', 'msg_status_matrix', {
      mcpResult: { isError: true },
    });
    const successPart = toolPart('rhythm_success_call', 'msg_status_matrix');

    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      'msg_status_matrix',
      'output',
      JSON.stringify([pendingPart, runningPart, errorPart, mcpErrorPart, successPart]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result.availability).toBe('available');
    expect(result.has('rhythm_pending_call')).toBe(false);
    expect(result.has('rhythm_running_call')).toBe(false);
    expect(result.has('rhythm_error_call')).toBe(false);
    expect(result.has('rhythm_mcp_error_call')).toBe(false);
    expect(result.has('rhythm_success_call')).toBe(true);
  });

  it('reports a structurally-incomplete "completed" tool part as unreadable rather than counting it as success', async () => {
    // Bug this catches: a completed-status part missing the producer's
    // required output/title/metadata/time fields used to still be counted as
    // a successful call, because only `type==='tool'` and a name were ever
    // checked.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Malformed completed', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'malformed completed session',
      mcpRole: config.id,
    });
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      'msg_malformed_completed',
      'output',
      JSON.stringify([
        {
          type: 'tool',
          id: 'prt_incomplete',
          sessionID: 'ses_test_session',
          messageID: 'msg_malformed_completed',
          callID: 'call_incomplete',
          tool: 'rhythm_incomplete_call',
          state: { status: 'completed' }, // missing input/output/title/metadata/time
        },
      ]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'unreadable-source' });
  });

  it.each([
    {
      label: 'missing sessionID/messageID',
      build: (messageID: string) => {
        const { sessionID: _sessionID, messageID: _messageID, ...part } = toolPart(
          'rhythm_invalid_identity',
          messageID,
        );
        return part;
      },
    },
    {
      label: 'messageID differs from persisted sdk_message_id',
      build: () => toolPart('rhythm_mismatched_message', 'msg_different'),
    },
    {
      label: 'tool metadata is not a record',
      build: (messageID: string) => ({ ...toolPart('rhythm_bad_metadata', messageID), metadata: [] }),
    },
    {
      label: 'completed time.compacted is negative',
      build: (messageID: string) => {
        const part = toolPart('rhythm_bad_compacted', messageID);
        return { ...part, state: { ...part.state, time: { ...part.state.time, compacted: -1 } } };
      },
    },
    {
      label: 'mcpResult._meta is not a record',
      build: (messageID: string) => {
        const part = toolPart('rhythm_bad_mcp_meta', messageID);
        return { ...part, state: { ...part.state, mcpResult: { _meta: [], isError: false } } };
      },
    },
    {
      label: 'mcpAppResource is missing required string fields',
      build: (messageID: string) => {
        const part = toolPart('rhythm_bad_app_resource', messageID);
        return {
          ...part,
          state: {
            ...part.state,
            mcpAppResource: {
              sessionID: 'ses_app',
              callID: 'call_app',
              serverName: 'rhythm',
              cwd: '/tmp',
              resourceUri: 'resource://test',
              advertisedAt: '2026-08-14T00:00:00.000Z',
            },
          },
        };
      },
    },
    {
      label: 'attachments is not an array',
      build: (messageID: string) => {
        const part = toolPart('rhythm_bad_attachments', messageID);
        return { ...part, state: { ...part.state, attachments: {} } };
      },
    },
    {
      label: 'attachment source is not producer-shaped',
      build: (messageID: string) => {
        const part = toolPart('rhythm_bad_attachment_source', messageID);
        return {
          ...part,
          state: {
            ...part.state,
            attachments: [
              {
                id: 'prt_attachment',
                sessionID: 'ses_attachment',
                messageID,
                type: 'file',
                mime: 'text/plain',
                url: 'data:text/plain,ok',
                source: { type: 'file', path: '/tmp/a.txt', text: { value: 'x', start: 0 } },
              },
            ],
          },
        };
      },
    },
  ])('reports $label as unreadable producer evidence', async ({ label, build }) => {
    // Bug this catches: a superficially completed tool part could be accepted
    // even though the producer schema cannot emit its identity/nested shape.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label, icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: label,
      mcpRole: config.id,
    });
    const messageID = `msg_${label.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      messageID,
      'output',
      JSON.stringify([build(messageID)]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'unreadable-source' });
    expect(result.rawCallableNames).toEqual(new Set());
  });

  it('counts a producer-valid completed part with every supported optional nested shape', async () => {
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Nested producer success', icon: 'x' });
    const session = new AgentSessionsRepository().insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'nested producer success',
      mcpRole: config.id,
    });
    const messageID = 'msg_nested_success';
    const part = toolPart('rhythm_nested_success', messageID, {
      mcpResult: { _meta: { source: 'producer' }, isError: false },
    });
    new AgentSessionMessagesRepository().upsertStructured(
      session.id,
      messageID,
      'output',
      JSON.stringify([
        {
          ...part,
          metadata: { provider: 'test' },
          state: {
            ...part.state,
            time: { ...part.state.time, compacted: 0 },
            mcpAppResource: {
              sessionID: 'ses_app',
              callID: 'call_app',
              serverName: 'rhythm',
              cwd: '/tmp',
              resourceUri: 'resource://test',
              advertisedAt: '2026-08-14T00:00:00.000Z',
              expiresAt: '2026-08-14T00:05:00.000Z',
            },
            attachments: [
              {
                id: 'prt_file_attachment',
                sessionID: 'ses_attachment',
                messageID,
                type: 'file',
                mime: 'text/plain',
                filename: 'a.txt',
                url: 'data:text/plain,ok',
                source: {
                  type: 'file',
                  path: '/tmp/a.txt',
                  text: { value: 'ok', start: 0, end: 2 },
                },
              },
              {
                id: 'prt_symbol_attachment',
                sessionID: 'ses_attachment',
                messageID,
                type: 'file',
                mime: 'text/plain',
                url: 'file:///tmp/a.ts',
                source: {
                  type: 'symbol',
                  path: '/tmp/a.ts',
                  name: 'value',
                  kind: 12,
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 5 },
                  },
                  text: { value: 'value', start: 0, end: 5 },
                },
              },
              {
                id: 'prt_resource_attachment',
                sessionID: 'ses_attachment',
                messageID,
                type: 'file',
                mime: 'application/json',
                url: 'resource://server/item',
                source: {
                  type: 'resource',
                  clientName: 'test-client',
                  uri: 'resource://server/item',
                  text: { value: '{}', start: 0, end: 2 },
                },
              },
            ],
          },
        },
      ]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['rhythm']);
    expect(result).toMatchObject({
      availability: 'available',
      rawCallableNames: new Set(['rhythm_nested_success']),
      canonicalServerIds: new Set(['rhythm']),
    });
  });
});

describe('W2 P1-2: scheduled ownership beats a conflicting mcp_role', () => {
  it('ten sessions scheduled for profile A but carrying profile B mcp_role contribute telemetry ONLY to A', async () => {
    // Bug this catches: the mcp_role join (#853) trusted ANY session whose
    // mcp_role equalled the profile being resolved, even when that session's
    // scheduled_task_id already durably ties it to a DIFFERENT profile via a
    // stronger FK. A stale/conflicting mcp_role could cross-contaminate a
    // sibling profile's usage telemetry.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');

    const configsRepo = new AgentConfigsRepository();
    const profileA = configsRepo.insert({ label: 'Profile A', icon: 'x' });
    const profileB = configsRepo.insert({ label: 'Profile B', icon: 'x' });

    const schedRepo = new AgentScheduledTasksRepository();
    const task = await schedRepo.createAsync({
      name: 'A Daily Run',
      scheduleType: 'daily',
      prompt: 'do A things',
      agentConfigId: profileA.id,
    });

    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    for (let i = 0; i < 10; i++) {
      const session = sessionsRepo.insert({
        taskId: null,
        agentKind: 'claude-code',
        cwd: '/tmp',
        name: `contaminated-${i}`,
        scheduledTaskId: task.id,
        // Conflicting/stale mcp_role naming the OTHER profile.
        mcpRole: profileB.id,
      });
      messagesRepo.upsertStructured(
        session.id,
        `msg_contaminated_${i}`,
        'output',
        JSON.stringify([toolPart('rhythm_only_a_should_see_this', `msg_contaminated_${i}`)]),
        null,
        null,
      );
    }

    const resultA = await resolveExercisedTools(profileA.id, undefined, ['rhythm']);
    expect(resultA.has('rhythm_only_a_should_see_this')).toBe(true);

    const resultB = await resolveExercisedTools(profileB.id, undefined, ['rhythm']);
    expect(resultB.has('rhythm_only_a_should_see_this')).toBe(false);
    // B has zero genuinely-attributable sessions — must be unavailable, not
    // a false "available, nothing exercised" that a prune guard could pass on.
    expect(resultB).toMatchObject({ availability: 'unavailable', reason: 'no-attributable-sessions' });
  });
});

describe('W2 P1-3: partial coverage preserves an already-proven positive at the resolver level', () => {
  it('a covered successful gitnexus_query session plus an uncovered sibling session still reports gitnexus canonically, under partial-structured-telemetry', async () => {
    // Bug this catches: partial coverage used to discard EVERY already-proven
    // positive by returning a fresh empty Set, even though one attributed
    // session had already contributed real, readable, successful telemetry.
    const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
    const config = new AgentConfigsRepository().insert({ label: 'Partial positive', icon: 'x' });
    const sessionsRepo = new AgentSessionsRepository();
    const coveredSession = sessionsRepo.insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'covered successful session',
      mcpRole: config.id,
    });
    sessionsRepo.insert({
      taskId: null,
      agentKind: 'claude-code',
      cwd: '/tmp',
      name: 'uncovered sibling session',
      mcpRole: config.id,
    });
    new AgentSessionMessagesRepository().upsertStructured(
      coveredSession.id,
      'msg_gitnexus_use',
      'output',
      JSON.stringify([toolPart('gitnexus_query', 'msg_gitnexus_use')]),
      null,
      null,
    );

    const result = await resolveExercisedTools(config.id, undefined, ['gitnexus']);
    expect(result).toMatchObject({ availability: 'unavailable', reason: 'partial-structured-telemetry' });
    expect(result.canonicalServerIds.has('gitnexus')).toBe(true);
    expect(result.has('gitnexus')).toBe(true);
  });

  it.each(['unreadable-before-success', 'success-before-unreadable'] as const)(
    '%s retains the successful gitnexus call and measurement reverts the removal',
    async (order) => {
      // Bug this catches: returning on the first unreadable row made positive
      // evidence depend on persistence order. A defect may block negative
      // inference, but it may never erase a successful call in another row.
      const { resolveExercisedTools } = await import('../org_exercised_tools_resolver');
      const { measureProposal } = await import('../org_proposal_measure');
      const config = new AgentConfigsRepository().insert({
        label: `Ordered evidence ${order}`,
        icon: 'x',
        allowedMcpsJson: JSON.stringify([]),
      });
      const session = new AgentSessionsRepository().insert({
        taskId: null,
        agentKind: 'claude-code',
        cwd: '/tmp',
        name: order,
        mcpRole: config.id,
      });
      const messagesRepo = new AgentSessionMessagesRepository();
      const successMessageId = `msg_success_${order}`;
      const insertUnreadable = () =>
        messagesRepo.upsertStructured(
          session.id,
          `msg_unreadable_${order}`,
          'output',
          '{not-json',
          null,
          null,
        );
      const insertSuccess = () =>
        messagesRepo.upsertStructured(
          session.id,
          successMessageId,
          'output',
          JSON.stringify([
            {
              type: 'tool',
              id: `prt_success_${order}`,
              sessionID: `ses_success_${order}`,
              messageID: successMessageId,
              callID: `call_success_${order}`,
              tool: 'gitnexus_query',
              state: {
                status: 'completed',
                input: {},
                output: 'ok',
                title: 'gitnexus_query',
                metadata: {},
                time: { start: 0, end: 1 },
              },
            },
          ]),
          null,
          null,
        );
      if (order === 'unreadable-before-success') {
        insertUnreadable();
        insertSuccess();
      } else {
        insertSuccess();
        insertUnreadable();
      }

      const telemetry = await resolveExercisedTools(config.id, undefined, ['gitnexus']);
      expect(telemetry).toMatchObject({
        availability: 'unavailable',
        reason: 'unreadable-source',
        rawCallableNames: new Set(['gitnexus_query']),
        canonicalServerIds: new Set(['gitnexus']),
      });

      const proposalsRepo = new AgentOrgProposalsRepository();
      const proposal = await proposalsRepo.createAsync({
        kind: 'prune-scope',
        risk: 'low',
        status: 'measuring',
        title: `Prune gitnexus with ${order}`,
        targetRef: `agent_config:${config.id}`,
        changeJson: JSON.stringify({
          agentConfigId: config.id,
          field: 'allowedMcpsJson',
          remove: ['gitnexus'],
        }),
        beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['gitnexus']) }),
        dedupKey: `prune-scope:${config.id}:gitnexus:${order}`,
      });
      const outcome = await measureProposal(proposal, { exercisedTools: async () => telemetry });
      expect(outcome).toBe('reverted');
      expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('reverted');
      expect(JSON.parse(new AgentConfigsRepository().getById(config.id)!.allowedMcpsJson!)).toEqual([
        'gitnexus',
      ]);
    },
  );
});
