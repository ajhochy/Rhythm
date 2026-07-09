/**
 * CONTRACT TEST for issue #933 — read-only workflow failure signal extractor.
 *
 * Covers:
 *  - issue-933-c1: delegate-result — explicit child error -> 'failed' (high
 *    confidence, fires on a single occurrence).
 *  - issue-933-c2: delegate-result — terminal child with NO recorded output
 *    -> 'transport-empty'; a terminal child WITH real output is a genuine
 *    success and produces NO signal (the "empty parent task_result is not
 *    proof of failure" nuance — ground truth is the CHILD's own evidence).
 *  - issue-933-c3: delegate-result — a stale in-flight child ('incomplete')
 *    only signals once repeated (one-off is suppressed).
 *  - issue-933-c4: retry-loop — a single severely-loopy session signals
 *    alone; a one-off (single session, single phrase) does not; repeated
 *    across sessions signals grouped.
 *  - issue-933-c5: hallucinated-claim — a commit/PR claim later contradicted
 *    by the user, repeated across sessions.
 *  - issue-933-c6: unverified-claim — a "tests pass" claim with no recorded
 *    test/build run; a session that DID run tests is not flagged.
 *  - issue-933-c7: stale-redo — the same issue # worked twice signals when
 *    the latest attempt is still not clean; the #936 stale-fixed safeguard
 *    suppresses it once the latest attempt reached a clean terminal status.
 *  - issue-933-c8: missing-scope — sourced from denied_tool_events
 *    (structured, not regex); suppressed once the tool is already granted
 *    on the live profile (stale-fixed safeguard).
 *  - issue-933-c9: tool-unavailable-attempted — an unavailable tool retried
 *    anyway, repeated across sessions.
 *  - issue-933-c10: repeated-correction — 3+ corrections in one session
 *    signals alone; repeated across sessions signals grouped; a lone
 *    one-off correction does not signal.
 *  - issue-933-c11: output is capped to WORKFLOW_SIGNAL_MAX_PER_RUN.
 *  - issue-933-c12: the extractor performs NO writes to any table.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { DeniedToolEventsRepository } from '../repositories/denied_tool_events_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

/** Raw-SQL helper (mirrors issue_857_contract.test.ts's setDbRawUpdate convention). */
function rawUpdate(table: string, id: string, fields: Record<string, string>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`)
    .run(...Object.values(fields), id);
}

function makeChildSession(
  sessionsRepo: AgentSessionsRepository,
  parentId: string,
  mcpRole: string,
): string {
  const child = sessionsRepo.insert({
    agentKind: 'claude-code',
    taskId: null,
    cwd: '/tmp',
    name: 'child',
    mcpRole,
  });
  rawUpdate('agent_sessions', child.id, { parent_session_id: parentId });
  return child.id;
}

describe('issue-933-c1: delegate-result — explicit child error is a failed signal on a single occurrence', () => {
  it('a delegated child session in status=error produces a high-confidence failed signal', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const parent = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'parent' });
    const childId = makeChildSession(sessionsRepo, parent.id, 'research');
    sessionsRepo.setErrorStatus(childId, 'boom');

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s) => s.category === 'delegate-result' && s.delegateOutcome === 'failed');
    expect(signal).toBeDefined();
    expect(signal?.agentConfigId).toBe('research');
    expect(signal?.confidence).toBe('high');
    expect(signal?.sessionIds).toContain(childId);
  });
});

describe('issue-933-c2: delegate-result — transport-empty vs a genuine success', () => {
  it('a terminal child with NO recorded output is transport-empty', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const parent = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'parent' });
    const childId = makeChildSession(sessionsRepo, parent.id, 'research');
    sessionsRepo.updateStatus(childId, 'idle');

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find(
      (s) => s.category === 'delegate-result' && s.delegateOutcome === 'transport-empty',
    );
    expect(signal).toBeDefined();
  });

  it('a terminal child WITH real recorded output is a genuine success — no signal', async () => {
    // The important nuance from issue #933: an empty PARENT-visible result is
    // not proof the delegated session failed — the child's own evidence is
    // ground truth. Here the child actually did real work, so no failure
    // signal must be produced for it.
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    const parent = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'parent' });
    const childId = makeChildSession(sessionsRepo, parent.id, 'research');
    messagesRepo.append(childId, 'output', 'Here is a full, real, substantive answer to the task.', 'Here is a full, real, substantive answer to the task.');
    sessionsRepo.updateStatus(childId, 'idle');

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s) => s.category === 'delegate-result' && s.sessionIds.includes(childId));
    expect(signal).toBeUndefined();
  });
});

describe('issue-933-c3: delegate-result — a stale in-flight child only signals once repeated', () => {
  it('one stale in-flight child alone does not signal; two do (grouped, low confidence)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const parent = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'parent' });
    const childId = makeChildSession(sessionsRepo, parent.id, 'research');
    const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    rawUpdate('agent_sessions', childId, { last_activity_at: staleTime, status: 'working' });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    let signals = await extractWorkflowFailureSignals();
    expect(signals.some((s) => s.category === 'delegate-result' && s.delegateOutcome === 'incomplete')).toBe(false);

    const child2Id = makeChildSession(sessionsRepo, parent.id, 'research');
    rawUpdate('agent_sessions', child2Id, { last_activity_at: staleTime, status: 'working' });

    signals = await extractWorkflowFailureSignals();
    const signal = signals.find((s) => s.category === 'delegate-result' && s.delegateOutcome === 'incomplete');
    expect(signal).toBeDefined();
    expect(signal?.confidence).toBe('medium');
    expect(signal?.count).toBe(2);
  });
});

describe('issue-933-c4: retry-loop', () => {
  it('a single severely-loopy session signals alone; a one-off elsewhere does not', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    const loopy = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'loopy', mcpRole: 'secretary' });
    const loopText = 'Let me try again. Retrying. One more attempt. Let me try a different approach.';
    messagesRepo.append(loopy.id, 'output', loopText, loopText);

    const oneOff = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'oneoff', mcpRole: 'research' });
    messagesRepo.append(oneOff.id, 'output', 'Retrying once.', 'Retrying once.');

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const severe = signals.find((s) => s.category === 'retry-loop' && s.sessionIds.includes(loopy.id));
    expect(severe).toBeDefined();
    expect(severe?.confidence).toBe('high');

    expect(signals.some((s) => s.category === 'retry-loop' && s.sessionIds.includes(oneOff.id))).toBe(false);
  });

  it('a retry phrase repeated across sessions for the same profile signals grouped', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: `s-${i}`, mcpRole: 'secretary' });
      messagesRepo.append(s.id, 'output', 'Trying again.', 'Trying again.');
      ids.push(s.id);
    }

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const grouped = signals.find(
      (s) => s.category === 'retry-loop' && s.confidence === 'medium' && s.agentConfigId === 'secretary',
    );
    expect(grouped).toBeDefined();
    expect(grouped?.count).toBe(2);
  });
});

describe('issue-933-c5: hallucinated-claim', () => {
  it('a commit/PR claim later contradicted by the user, repeated across sessions, produces a signal', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    for (let i = 0; i < 2; i++) {
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: `s-${i}`, mcpRole: 'secretary' });
      messagesRepo.append(s.id, 'output', 'I pushed it to main, commit abc1234.', 'I pushed it to main, commit abc1234.');
      messagesRepo.append(s.id, 'input', "That commit doesn't exist.", "That commit doesn't exist.");
    }

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s) => s.category === 'hallucinated-claim');
    expect(signal).toBeDefined();
    expect(signal?.count).toBe(2);
  });
});

describe('issue-933-c6: unverified-claim', () => {
  it('a "tests pass" claim with no recorded test/build run, repeated, produces a signal; an actual run suppresses it', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    for (let i = 0; i < 2; i++) {
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: `unverified-${i}`, mcpRole: 'secretary' });
      messagesRepo.append(s.id, 'output', 'All tests are passing now.', 'All tests are passing now.');
    }

    const ranTests = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'ran-tests', mcpRole: 'secretary' });
    messagesRepo.append(ranTests.id, 'output', 'Ran npm test — all tests are passing now.', 'Ran npm test — all tests are passing now.');

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s) => s.category === 'unverified-claim');
    expect(signal).toBeDefined();
    expect(signal?.count).toBe(2);
    expect(signal?.sessionIds).not.toContain(ranTests.id);
  });
});

describe('issue-933-c7: stale-redo (already-fixed issue worked again) + stale-fixed safeguard', () => {
  it('reworking the same issue # signals when the latest attempt is still not clean', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s1 = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, taskTitle: 'Fix bug #42', cwd: '/tmp', name: 's1', mcpRole: 'secretary' });
    sessionsRepo.updateStatus(s1.id, 'closed');
    const s2 = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, taskTitle: 'Fix bug #42 again', cwd: '/tmp', name: 's2', mcpRole: 'secretary' });
    sessionsRepo.setErrorStatus(s2.id, 'still broken');

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s) => s.category === 'stale-redo');
    expect(signal).toBeDefined();
    expect(signal?.confidence).toBe('high');
  });

  it('#936 stale-fixed safeguard: no signal once the LATEST attempt reached a clean terminal status', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s1 = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, taskTitle: 'Fix bug #99', cwd: '/tmp', name: 's1', mcpRole: 'secretary' });
    sessionsRepo.setErrorStatus(s1.id, 'broken');
    // Backdate s1 so it sorts before s2 despite both inserts happening "now".
    rawUpdate('agent_sessions', s1.id, { created_at: new Date(Date.now() - 60_000).toISOString() });
    const s2 = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, taskTitle: 'Fix bug #99 retry', cwd: '/tmp', name: 's2', mcpRole: 'secretary' });
    sessionsRepo.updateStatus(s2.id, 'closed'); // latest attempt succeeded — issue is now fixed

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s) => s.category === 'stale-redo')).toBe(false);
  });
});

describe('issue-933-c8: missing-scope (structured via denied_tool_events) + stale-fixed safeguard', () => {
  it('a denied tool with profile attribution produces a high-confidence signal', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x', allowedMcpsJson: JSON.stringify(['rhythm']) });

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: 'sess-1', agentConfigId: 'secretary', toolName: 'nfl_mcp' });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s) => s.category === 'missing-scope');
    expect(signal).toBeDefined();
    expect(signal?.confidence).toBe('high');
    expect(signal?.agentConfigId).toBe('secretary');
  });

  it('#936 stale-fixed safeguard: no signal once the tool is already granted on the live profile', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm', 'nfl_mcp']), // already granted since the denial
    });

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: 'sess-1', agentConfigId: 'secretary', toolName: 'nfl_mcp' });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s) => s.category === 'missing-scope')).toBe(false);
  });
});

describe('issue-933-c9: tool-unavailable-attempted', () => {
  it('an unavailable tool retried anyway, repeated across sessions, produces a signal', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    for (let i = 0; i < 2; i++) {
      const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: `unavail-${i}`, mcpRole: 'secretary' });
      messagesRepo.append(s.id, 'output', 'The server is unreachable.', 'The server is unreachable.');
      messagesRepo.append(s.id, 'output', "I'll try again anyway.", "I'll try again anyway.");
    }

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s) => s.category === 'tool-unavailable-attempted');
    expect(signal).toBeDefined();
    expect(signal?.count).toBe(2);
  });
});

describe('issue-933-c10: repeated-correction', () => {
  it('3+ corrections in one session signals alone; a lone one-off correction elsewhere does not', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    const heavy = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'heavy', mcpRole: 'secretary' });
    messagesRepo.append(heavy.id, 'input', 'Please do X.', 'Please do X.');
    messagesRepo.append(heavy.id, 'input', "That's not right.", "That's not right.");
    messagesRepo.append(heavy.id, 'input', "Still broken.", "Still broken.");
    messagesRepo.append(heavy.id, 'input', "You're wrong.", "You're wrong.");

    const lone = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'lone', mcpRole: 'research' });
    messagesRepo.append(lone.id, 'input', 'Please do Y.', 'Please do Y.');
    messagesRepo.append(lone.id, 'input', "That's incorrect.", "That's incorrect.");

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const severe = signals.find((s) => s.category === 'repeated-correction' && s.sessionIds.includes(heavy.id));
    expect(severe).toBeDefined();
    expect(severe?.confidence).toBe('high');

    expect(signals.some((s) => s.category === 'repeated-correction' && s.sessionIds.includes(lone.id))).toBe(false);
  });
});

describe('issue-933-c11: output is capped to WORKFLOW_SIGNAL_MAX_PER_RUN', () => {
  it('more than the cap worth of high-confidence signals still returns at most the cap', async () => {
    const { WORKFLOW_SIGNAL_MAX_PER_RUN } = await import('../services/workflow_failure_signal_extractor');

    const configsRepo = new AgentConfigsRepository();
    const deniedRepo = new DeniedToolEventsRepository();
    for (let i = 0; i < WORKFLOW_SIGNAL_MAX_PER_RUN + 5; i++) {
      const id = `profile-${i}`;
      configsRepo.insert({ id, label: id, icon: 'x' });
      await deniedRepo.recordAsync({ sessionId: `sess-${i}`, agentConfigId: id, toolName: 'nfl_mcp' });
    }

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.length).toBeLessThanOrEqual(WORKFLOW_SIGNAL_MAX_PER_RUN);
  });
});

describe('issue-933-c12: the extractor performs no writes to any table', () => {
  it('leaves every relevant table row count unchanged after a full run', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });
    const sessionsRepo = new AgentSessionsRepository();
    sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 's', mcpRole: 'secretary' });
    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: null, agentConfigId: 'secretary', toolName: 'x' });

    const db = getDb();
    const tables = ['agent_configs', 'agent_sessions', 'agent_session_messages', 'denied_tool_events', 'agent_org_proposals'];
    const before: Record<string, number> = {};
    for (const t of tables) before[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    await extractWorkflowFailureSignals();

    const after: Record<string, number> = {};
    for (const t of tables) after[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

    expect(after).toEqual(before);
  });
});
