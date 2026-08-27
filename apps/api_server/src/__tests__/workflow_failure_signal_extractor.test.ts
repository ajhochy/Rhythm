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
 *  - issue-933-c4: retry-loop (W3, self-improvement-engine-foundation) —
 *    evidence comes ONLY from structured, persisted tool-call parts (tool
 *    name + callID + state.status + state.input), never from lexical
 *    "retry"/"try again" prose. A single failed-then-retried-then-completed
 *    tool is a recovered signal; a failed-then-retried-and-still-failing
 *    tool is an unresolved (higher confidence) signal; a lone (non-repeated)
 *    failure is not a retry loop; and tool parts missing call identity/state
 *    are suppressed rather than falling back to scanning message text.
 *    Grouping requires MATERIALLY EQUIVALENT input: the same tool called
 *    with a genuinely different input is a different operation, not a
 *    retry, even within the same session — equivalence is decided by a
 *    canonical (recursively key-sorted) hash of `state.input`, so object
 *    key-order differences never split one retry pattern into two, and a
 *    part with no recorded input is suppressed rather than guessed. A
 *    duplicate persisted record of the SAME call (callID) is also collapsed
 *    to one final representation before classifying, so a repeat write of
 *    one call can never look like a second attempt.
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

/**
 * W3 — persist a structured `type: 'tool'` message part, in a PRODUCER-VALID
 * shape matching the actual schema at
 * apps/opencode_fork/packages/opencode/src/session/message-v2.ts:251-338
 * (ToolPart / ToolStatePending / ToolStateRunning / ToolStateCompleted /
 * ToolStateError). Each call uses its own sdkMessageId so ordering across
 * attempts is unambiguous.
 */
function seedToolAttempt(
  sessionId: string,
  sdkMessageId: string,
  opts: {
    callId: string;
    tool: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    startedAt?: number;
    /** Overrides the default `startedAt + 1000` end time (completed/error only). */
    endedAt?: number;
    /** state.input — omit to simulate a part with no recorded input at all. */
    input?: Record<string, unknown>;
    /** Overrides the default `id` (used to simulate a duplicate persisted part for the SAME callID). */
    partId?: string;
    /** completed-only: sets `state.mcpResult.isError` — a completed MCP call that itself failed. */
    mcpIsError?: boolean;
  },
): void {
  const messagesRepo = new AgentSessionMessagesRepository();
  const state: Record<string, unknown> = { status: opts.status };
  if (opts.input !== undefined) state.input = opts.input;

  if (opts.status === 'pending') {
    state.raw = 'raw-tool-call-text';
  }
  if (opts.status === 'running' && opts.startedAt !== undefined) {
    state.time = { start: opts.startedAt };
  }
  if (opts.status === 'completed' || opts.status === 'error') {
    if (opts.startedAt !== undefined) {
      state.time = { start: opts.startedAt, end: opts.endedAt ?? opts.startedAt + 1000 };
    }
  }
  if (opts.status === 'error') state.error = 'boom';
  if (opts.status === 'completed') {
    state.output = 'ok';
    state.title = 'Tool result';
    state.metadata = {};
    if (opts.mcpIsError !== undefined) state.mcpResult = { isError: opts.mcpIsError };
  }
  messagesRepo.upsertPart(sessionId, sdkMessageId, {
    // Producer-shaped identity throughout: `raw.sessionID` is the OpenCode
    // engine's own session id — structurally valid ("ses..."), but NEVER the
    // Rhythm local session UUID (`sessionId` here is only the DB row key used
    // to route the upsert, never compared against `raw.sessionID`).
    id: opts.partId ?? `prt-${opts.callId}`,
    type: 'tool',
    sessionID: 'ses-test-session',
    messageID: sdkMessageId,
    callID: opts.callId,
    tool: opts.tool,
    state,
  });
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

describe('issue-933-c4: retry-loop (structured tool attempts only, W3)', () => {
  it('never fires from retry/resume prose alone — no tool parts at all means no signal', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    const prosey = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'prosey', mcpRole: 'secretary' });
    const loopText =
      'Let me try again. Retrying. One more attempt. Let me try a different approach. ' +
      'Our retry policy resumes automatically after a transient failure.';
    messagesRepo.append(prosey.id, 'output', loopText, loopText);

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s) => s.category === 'retry-loop')).toBe(false);
  });

  it('a failed tool call retried and then completed is a recovered signal (medium confidence)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'recovered', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: t0 + 5_000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('recovered');
    expect(signal?.confidence).toBe('medium');
    expect(signal?.agentConfigId).toBe('secretary');
  });

  it('a failed tool call retried and still failing is an unresolved signal (high confidence)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'unresolved', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'error', startedAt: t0 + 5_000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('unresolved');
    expect(signal?.confidence).toBe('high');
  });

  it('a tool stuck "running" long past its start time counts as a timed-out attempt', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'timedout', mcpRole: 'secretary' });
    const staleStart = Date.now() - 60 * 60 * 1000; // 1h ago — well past any reasonable tool duration
    const input = { url: 'https://example.com' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'web_fetch', status: 'running', startedAt: staleStart, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'web_fetch', status: 'error', startedAt: Date.now(), input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('unresolved');
    expect(signal?.count).toBe(2); // both the stale timeout and the explicit error count as "bad"
  });

  it('a single (non-repeated) tool failure is not a retry loop', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'lone-failure', mcpRole: 'secretary' });
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: Date.now(), input: { cmd: 'npm test' } });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('a tool retried twice with no failure/timeout in between is not a retry loop', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'clean-repeat', mcpRole: 'secretary' });
    const t0 = Date.now() - 10_000;
    const input = { cmd: 'ls' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'completed', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: t0 + 2_000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('suppresses the signal (no fallback to prose) when tool parts are missing call identity or state', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'malformed', mcpRole: 'secretary' });

    // Two "tool" parts repeated, but missing callID (no call identity) — must
    // be suppressed rather than counted as a retry loop.
    messagesRepo.upsertPart(s.id, 'msg-1', { id: 'part-1', type: 'tool', tool: 'bash', state: { status: 'error' } });
    messagesRepo.upsertPart(s.id, 'msg-2', { id: 'part-2', type: 'tool', tool: 'bash', state: { status: 'error' } });
    // Also seed prose that would have tripped the old lexical detector, to
    // prove there is no fallback path.
    const proseText = 'Let me try again. Retrying. One more attempt. Different approach.';
    messagesRepo.append(s.id, 'output', proseText, proseText);

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('a failed tool call followed by a call to the SAME tool with a DIFFERENT input is not a retry loop', async () => {
    // Read-only audit finding: grouping by tool name alone flagged 700
    // same-session/tool groups, but only 36 had a later exact-input retry —
    // 664 were the same tool invoked with materially different input, which
    // is a different operation, not a retry.
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'different-input', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input: { cmd: 'npm test' } });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: t0 + 5_000, input: { cmd: 'npm run build' } });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('object key-order differences in input normalize to the same input identity (still a retry)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'key-order', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    seedToolAttempt(s.id, 'msg-1', {
      callId: 'call-1',
      tool: 'bash',
      status: 'error',
      startedAt: t0,
      input: { cmd: 'npm test', cwd: '/tmp', flags: { verbose: true, ci: false } },
    });
    seedToolAttempt(s.id, 'msg-2', {
      callId: 'call-2',
      tool: 'bash',
      status: 'completed',
      startedAt: t0 + 5_000,
      // Same values, keys (including nested) in a different order.
      input: { flags: { ci: false, verbose: true }, cwd: '/tmp', cmd: 'npm test' },
    });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('recovered');
  });

  it('suppresses the signal when a repeated tool part carries no recorded input at all', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'no-input', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    // Both parts otherwise carry full call identity + a recognized status,
    // but neither state carries an `input` field at all.
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0 });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: t0 + 5_000 });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('a completed tool call followed by a later error is NOT a retry loop — no retry happened after the failure', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'completed-then-error', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'completed', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'error', startedAt: t0 + 5_000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('a failed tool call followed by a non-stale in-flight (running) retry is inconclusive — no signal yet', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'error-then-running', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'running', startedAt: Date.now(), input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('a failed tool call followed by a non-stale pending retry is inconclusive — no signal yet', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'error-then-pending', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'pending', startedAt: Date.now(), input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('a repeated candidate group with a missing start time is suppressed — fails closed on ambiguous chronology', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'missing-start', mcpRole: 'secretary' });
    const input = { cmd: 'npm test' };
    // First attempt carries no state.time at all; second is finite. Sorting
    // these against each other cannot be trusted, so the whole group must be
    // suppressed rather than guessing an order.
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: Date.now(), input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('exposes stable recurrence identity with profile, tool, and FULL input hash', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'full-hash-dedup', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'error', startedAt: t0 + 5_000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal).toMatchObject({ agentConfigId: 'secretary', retryTool: 'bash' });
    const inputHashInEvidence = /inputHash=([0-9a-f]+)/.exec(signal!.evidence)?.[1];
    expect(inputHashInEvidence).toBeDefined();
    expect(inputHashInEvidence!.length).toBeLessThanOrEqual(12);

    const dedupSuffix = signal!.dedupToken.slice(`${s.id}:bash:`.length);
    expect(dedupSuffix.length).toBe(64); // full sha256 hex digest, not the 12-char evidence prefix
    expect(dedupSuffix.startsWith(inputHashInEvidence!)).toBe(true);
    expect(signal!.retryInputHash).toBe(dedupSuffix);
  });

  it('a duplicate persisted record of the SAME call (callID) is deduped to one attempt, not counted as a retry', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'dup-record', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    // Same callID persisted twice under two DIFFERENT message rows (as could
    // happen on a reconnect/replay), with distinct part ids so the per-row
    // upsert dedup does not collapse them itself.
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input, partId: 'prt-a' });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, input, partId: 'prt-b' });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });
});

describe('W3 final review corrective (slice B) — producer-valid tool state validation', () => {
  // extractToolAttempts must drop a part whose `state` deviates from the
  // producer schema OUTRIGHT (not coerce/guess/partially trust it) — asserted
  // directly against the exported parser so a would-be malformed attempt can
  // never hide behind a grouping-key coincidence with a valid one.
  const rejectsMalformedState = (label: string, badState: Record<string, unknown>) => {
    it(`rejects: ${label}`, async () => {
      const { extractToolAttempts } = await import('../services/workflow_failure_signal_extractor');
      // Producer-VALID identity throughout (sessionID/messageID/id all
      // properly prefixed, messageID matching the row's sdkMessageId) so the
      // ONLY thing under test is the `state` shape itself — an identity gap
      // must never be what causes rejection here.
      const message = {
        role: 'output',
        strippedText: '',
        sdkMessageId: 'msg-1',
        partsJson: JSON.stringify([
          { id: 'prt-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'bash', state: badState },
        ]),
      } as unknown as import('../models/agent_session').AgentSessionMessage;

      expect(extractToolAttempts([message])).toHaveLength(0);
    });
  };

  rejectsMalformedState('null input', {
    status: 'error', input: null, error: 'boom', time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
  });
  rejectsMalformedState('array input (not a record)', {
    status: 'error', input: [], error: 'boom', time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
  });
  rejectsMalformedState('scalar input', {
    status: 'error', input: 'not-an-object', error: 'boom', time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
  });
  rejectsMalformedState('negative time.start', {
    status: 'error', input: { cmd: 'x' }, error: 'boom', time: { start: -5, end: 10 },
  });
  rejectsMalformedState('fractional time.start', {
    status: 'error', input: { cmd: 'x' }, error: 'boom', time: { start: 1.5, end: 10 },
  });
  rejectsMalformedState('nonfinite time.start', {
    status: 'error', input: { cmd: 'x' }, error: 'boom', time: { start: Infinity, end: Infinity },
  });
  rejectsMalformedState('impossible state: time.end before time.start', {
    status: 'error', input: { cmd: 'x' }, error: 'boom', time: { start: 100, end: 50 },
  });
  rejectsMalformedState('error status missing the error string', {
    status: 'error', input: { cmd: 'x' }, time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
  });
  rejectsMalformedState('completed status missing output', {
    status: 'completed', input: { cmd: 'x' }, title: 't', metadata: {}, time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
  });
  rejectsMalformedState('completed status missing title', {
    status: 'completed', input: { cmd: 'x' }, output: 'ok', metadata: {}, time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
  });
  rejectsMalformedState('completed status missing metadata', {
    status: 'completed', input: { cmd: 'x' }, output: 'ok', title: 't', time: { start: Date.now() - 60_000, end: Date.now() - 59_000 },
  });
  rejectsMalformedState('completed status with end < start', {
    status: 'completed', input: { cmd: 'x' }, output: 'ok', title: 't', metadata: {}, time: { start: 100, end: 50 },
  });
  rejectsMalformedState('pending status missing raw', {
    status: 'pending', input: { cmd: 'x' },
  });
  rejectsMalformedState('running status missing time.start', {
    status: 'running', input: { cmd: 'x' },
  });
  rejectsMalformedState('completed status with a non-object mcpResult', {
    status: 'completed', input: { cmd: 'x' }, output: 'ok', title: 't', metadata: {},
    time: { start: Date.now() - 60_000, end: Date.now() - 59_000 }, mcpResult: 'oops',
  });
  rejectsMalformedState('completed status with mcpResult.isError not a boolean', {
    status: 'completed', input: { cmd: 'x' }, output: 'ok', title: 't', metadata: {},
    time: { start: Date.now() - 60_000, end: Date.now() - 59_000 }, mcpResult: { isError: 'true' },
  });
  rejectsMalformedState('an impossible/unrecognized status', {
    status: 'succeeded', input: { cmd: 'x' },
  });

  it('a completed state with mcpResult.isError===true is FAILED, not a recovered success', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'mcp-error', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'call_tool' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'mcp_tool', status: 'error', startedAt: t0, input });
    // Looks like a "completed" retry on its face, but the MCP result itself
    // reports failure — must be classified as still-failing, not recovered.
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'mcp_tool', status: 'completed', startedAt: t0 + 5_000, input, mcpIsError: true });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('unresolved');
  });

  it('accepts a producer-valid completed state with mcpResult.isError===false as a genuine recovery', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'mcp-ok', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'call_tool' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'mcp_tool', status: 'error', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'mcp_tool', status: 'completed', startedAt: t0 + 5_000, input, mcpIsError: false });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('recovered');
  });
});

describe('W3 final review corrective (slice B) — strict retry chronology', () => {
  it('RED: an overlapping "retry" that started before the prior failure settled is NOT evidence', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'overlap', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    // Failure settles (time.end) at t0+1000. The second attempt started at
    // t0+500 — BEFORE that settlement — so it was already in flight before
    // the failure was even known, not a sequential retry of it.
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, endedAt: t0 + 1000, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: t0 + 500, endedAt: t0 + 1500, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('RED: an attempt with the EXACT same start time as the failure is NOT evidence of a retry', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'equal-starts', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, endedAt: t0 + 1000, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: t0, endedAt: t0 + 1000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('GREEN: a failure that settled, followed by a LATER attempt starting after settlement, IS a retry', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'settled-then-later', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    // Failure settles at t0+1000; the retry starts at t0+1001 — strictly
    // after settlement.
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'bash', status: 'error', startedAt: t0, endedAt: t0 + 1000, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'bash', status: 'completed', startedAt: t0 + 1001, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('recovered');
  });

  it('RED: a retry started BEFORE the stale-running timeout threshold was crossed is NOT evidence', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'timeout-before-threshold', mcpRole: 'secretary' });
    // Stale by "now" (started 20 minutes ago, well past STUCK_TOOL_RUNNING_MS
    // = 10 minutes), but the second attempt started only 5 minutes after the
    // first — well BEFORE the 10-minute timeout threshold was crossed, so at
    // the time it started this was not yet a known failure.
    const t0 = Date.now() - 20 * 60 * 1000;
    const input = { url: 'https://example.com' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'web_fetch', status: 'running', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'web_fetch', status: 'completed', startedAt: t0 + 5 * 60 * 1000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id))).toBe(false);
  });

  it('GREEN: a retry started AFTER the stale-running timeout threshold was crossed IS evidence', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'timeout-after-threshold', mcpRole: 'secretary' });
    // Same stale first attempt, but this time the retry starts 11 minutes
    // after t0 — strictly after the 10-minute timeout threshold.
    const t0 = Date.now() - 20 * 60 * 1000;
    const input = { url: 'https://example.com' };
    seedToolAttempt(s.id, 'msg-1', { callId: 'call-1', tool: 'web_fetch', status: 'running', startedAt: t0, input });
    seedToolAttempt(s.id, 'msg-2', { callId: 'call-2', tool: 'web_fetch', status: 'completed', startedAt: t0 + 11 * 60 * 1000, input });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    const signal = signals.find((s2) => s2.category === 'retry-loop' && s2.sessionIds.includes(s.id));
    expect(signal).toBeDefined();
    expect(signal?.retryOutcome).toBe('recovered');
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

describe('W3 FINAL ARCHITECTURAL CORRECTIVE — RED probes against producer-invalid evidence', () => {
  it('RED: two distinct calls sharing one part ID must never emit retry-loop evidence', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'dup-part-id', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    const state1: Record<string, unknown> = {
      status: 'error', input, error: 'boom', time: { start: t0, end: t0 + 1000 },
    };
    const state2: Record<string, unknown> = {
      status: 'completed', input, output: 'ok', title: 't', metadata: {}, time: { start: t0 + 5000, end: t0 + 6000 },
    };
    const messagesRepo = new AgentSessionMessagesRepository();
    // NOTE: missing sessionID/messageID entirely (no producer identity at all)
    // AND both records share the SAME part id despite being two DIFFERENT calls.
    messagesRepo.upsertPart(s.id, 'msg-1', { id: 'part-shared', type: 'tool', callID: 'call-1', tool: 'bash', state: state1 });
    messagesRepo.upsertPart(s.id, 'msg-2', { id: 'part-shared', type: 'tool', callID: 'call-2', tool: 'bash', state: state2 });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();

    expect(signals.some((sig) => sig.category === 'retry-loop' && sig.sessionIds.includes(s.id))).toBe(false);
  });

  it('RED: mcpResult._meta must be a plain record, and time.compacted must be a non-negative integer', async () => {
    const { extractToolAttempts } = await import('../services/workflow_failure_signal_extractor');
    const badMeta = {
      role: 'output',
      strippedText: '',
      sdkMessageId: 'msg-1',
      partsJson: JSON.stringify([
        {
          id: 'prt-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'bash',
          state: {
            status: 'completed', input: {}, output: 'ok', title: 't', metadata: {},
            time: { start: 0, end: 1 }, mcpResult: { _meta: 'not-a-record' },
          },
        },
      ]),
    } as unknown as import('../models/agent_session').AgentSessionMessage;
    expect(extractToolAttempts([badMeta])).toHaveLength(0);

    const badCompacted = {
      role: 'output',
      strippedText: '',
      sdkMessageId: 'msg-2',
      partsJson: JSON.stringify([
        {
          id: 'prt-2', type: 'tool', sessionID: 'ses-test', messageID: 'msg-2', callID: 'call-2', tool: 'bash',
          state: {
            status: 'completed', input: {}, output: 'ok', title: 't', metadata: {},
            time: { start: 0, end: 1, compacted: -1 },
          },
        },
      ]),
    } as unknown as import('../models/agent_session').AgentSessionMessage;
    expect(extractToolAttempts([badCompacted])).toHaveLength(0);
  });

  it('RED: a tool part missing producer sessionID/messageID identity must be rejected outright', async () => {
    const { extractToolAttempts } = await import('../services/workflow_failure_signal_extractor');
    const message = {
      role: 'output',
      strippedText: '',
      sdkMessageId: 'msg-1',
      partsJson: JSON.stringify([
        {
          // no sessionID, no messageID at all
          id: 'prt-1', type: 'tool', callID: 'call-1', tool: 'bash',
          state: {
            status: 'completed', input: {}, output: 'ok', title: 't', metadata: {}, time: { start: 0, end: 1 },
          },
        },
      ]),
    } as unknown as import('../models/agent_session').AgentSessionMessage;
    expect(extractToolAttempts([message])).toHaveLength(0);
  });

  it('RED: messageID must equal the persisted row sdkMessageId exactly', async () => {
    const { extractToolAttempts } = await import('../services/workflow_failure_signal_extractor');
    const message = {
      role: 'output',
      strippedText: '',
      sdkMessageId: 'msg-real',
      partsJson: JSON.stringify([
        {
          id: 'prt-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-different', callID: 'call-1', tool: 'bash',
          state: {
            status: 'completed', input: {}, output: 'ok', title: 't', metadata: {}, time: { start: 0, end: 1 },
          },
        },
      ]),
    } as unknown as import('../models/agent_session').AgentSessionMessage;
    expect(extractToolAttempts([message])).toHaveLength(0);
  });
});

describe('W3 FINAL ARCHITECTURAL CORRECTIVE — RED probes for strict chronology', () => {
  it('RED: stale-running settles AT the exact threshold (>=), not only strictly past it — deterministic explicit `now`', async () => {
    const { classifyToolAttempt, STUCK_TOOL_RUNNING_MS } = await import('../services/workflow_failure_signal_extractor');
    const start = 1_000_000;
    const attempt = {
      partId: 'prt-1',
      tool: 'web_fetch',
      callId: 'call-1',
      status: 'running' as const,
      startedAt: start,
      endedAt: null,
      mcpIsError: false,
      inputHash: 'hash',
    };
    // `now` is EXACTLY start + STUCK_TOOL_RUNNING_MS — the boundary itself must
    // already count as timed out (>=), not remain 'in-flight' until strictly past it.
    expect(classifyToolAttempt(attempt, start + STUCK_TOOL_RUNNING_MS)).toBe('timeout');
  });

  it('RED: equal-start attempts must never signal, regardless of persistence order (order A)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'equal-order-a', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertPart(s.id, 'msg-1', {
      id: 'prt-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'bash',
      state: { status: 'error', input, error: 'boom', time: { start: t0, end: t0 + 1000 } },
    });
    messagesRepo.upsertPart(s.id, 'msg-2', {
      id: 'prt-2', type: 'tool', sessionID: 'ses-test', messageID: 'msg-2', callID: 'call-2', tool: 'bash',
      state: { status: 'completed', input, output: 'ok', title: 't', metadata: {}, time: { start: t0, end: t0 + 1000 } },
    });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();
    expect(signals.some((sig) => sig.category === 'retry-loop' && sig.sessionIds.includes(s.id))).toBe(false);
  });

  it('RED: equal-start attempts must never signal, regardless of persistence order (order B, reversed insert)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'equal-order-b', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    const messagesRepo = new AgentSessionMessagesRepository();
    // Same two records, inserted in the OPPOSITE order.
    messagesRepo.upsertPart(s.id, 'msg-2', {
      id: 'prt-2', type: 'tool', sessionID: 'ses-test', messageID: 'msg-2', callID: 'call-2', tool: 'bash',
      state: { status: 'completed', input, output: 'ok', title: 't', metadata: {}, time: { start: t0, end: t0 + 1000 } },
    });
    messagesRepo.upsertPart(s.id, 'msg-1', {
      id: 'prt-1', type: 'tool', sessionID: 'ses-test', messageID: 'msg-1', callID: 'call-1', tool: 'bash',
      state: { status: 'error', input, error: 'boom', time: { start: t0, end: t0 + 1000 } },
    });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();
    expect(signals.some((sig) => sig.category === 'retry-loop' && sig.sessionIds.includes(s.id))).toBe(false);
  });

  it('RED: a long-running failure that settles AFTER a later-starting success must never be recovered (order A)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'overlap-long-a', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    const messagesRepo = new AgentSessionMessagesRepository();
    // A: fails but settles late (long-running failure, ends at t0+10000).
    messagesRepo.upsertPart(s.id, 'msg-a', {
      id: 'prt-a', type: 'tool', sessionID: 'ses-test', messageID: 'msg-a', callID: 'call-a', tool: 'bash',
      state: { status: 'error', input, error: 'boom', time: { start: t0, end: t0 + 10_000 } },
    });
    // B: a SECOND failure that starts before A settles (overlapping with A) — must not be usable as
    // a "prior failure" basis for a later success, since B itself overlapped an unsettled A.
    messagesRepo.upsertPart(s.id, 'msg-b', {
      id: 'prt-b', type: 'tool', sessionID: 'ses-test', messageID: 'msg-b', callID: 'call-b', tool: 'bash',
      state: { status: 'error', input, error: 'boom', time: { start: t0 + 50, end: t0 + 150 } },
    });
    // C: succeeds, starting after B settled but still WELL BEFORE A (the long-running failure) settles.
    messagesRepo.upsertPart(s.id, 'msg-c', {
      id: 'prt-c', type: 'tool', sessionID: 'ses-test', messageID: 'msg-c', callID: 'call-c', tool: 'bash',
      state: { status: 'completed', input, output: 'ok', title: 't', metadata: {}, time: { start: t0 + 200, end: t0 + 300 } },
    });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();
    const signal = signals.find((sig) => sig.category === 'retry-loop' && sig.sessionIds.includes(s.id));
    expect(signal?.retryOutcome).not.toBe('recovered');
  });

  it('RED: a long-running failure that settles AFTER a later-starting success must never be recovered (order B, reversed insert)', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'overlap-long-b', mcpRole: 'secretary' });
    const t0 = Date.now() - 60_000;
    const input = { cmd: 'npm test' };
    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.upsertPart(s.id, 'msg-c', {
      id: 'prt-c', type: 'tool', sessionID: 'ses-test', messageID: 'msg-c', callID: 'call-c', tool: 'bash',
      state: { status: 'completed', input, output: 'ok', title: 't', metadata: {}, time: { start: t0 + 200, end: t0 + 300 } },
    });
    messagesRepo.upsertPart(s.id, 'msg-b', {
      id: 'prt-b', type: 'tool', sessionID: 'ses-test', messageID: 'msg-b', callID: 'call-b', tool: 'bash',
      state: { status: 'error', input, error: 'boom', time: { start: t0 + 50, end: t0 + 150 } },
    });
    messagesRepo.upsertPart(s.id, 'msg-a', {
      id: 'prt-a', type: 'tool', sessionID: 'ses-test', messageID: 'msg-a', callID: 'call-a', tool: 'bash',
      state: { status: 'error', input, error: 'boom', time: { start: t0, end: t0 + 10_000 } },
    });

    const { extractWorkflowFailureSignals } = await import('../services/workflow_failure_signal_extractor');
    const signals = await extractWorkflowFailureSignals();
    const signal = signals.find((sig) => sig.category === 'retry-loop' && sig.sessionIds.includes(s.id));
    expect(signal?.retryOutcome).not.toBe('recovered');
  });
});
