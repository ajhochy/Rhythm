/**
 * CONTRACT TEST for issue #865 (agent run QUALITY scorecard).
 *
 * Covers:
 *  - issue-865-c1: rollup reports completion vs escalation counts/rates per
 *    agent-run group (agent_kind), token waste, and user corrections.
 *  - issue-865-c2: token waste is computed DISTINCTLY from raw spend — an
 *    agent whose runs all completed cleanly has wastedTokens=0 even though
 *    totalTokens (spend) is > 0.
 *  - issue-865-c3: thin history (< MIN_RUNS_FOR_SIGNAL measurable runs) is
 *    reported as notEnoughData=true with null rates, never a misleading
 *    0%/100%.
 *  - issue-865-c4: a run whose outcome can't be classified (non-terminal,
 *    unrecognized status) is counted in unmeasuredRuns, not dropped and not
 *    folded into completed.
 *  - issue-865-c5: repeated escalation reasons (2+ occurrences) are surfaced
 *    as repeatedMistakes; a one-off failure is not.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { getRunQualityRollup, MIN_RUNS_FOR_SIGNAL } from './run_quality_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function insertSession(
  db: Database.Database,
  opts: {
    id: string;
    agentKind: string;
    status: string;
    statusMessage?: string | null;
    createdAt?: string;
  },
) {
  const now = opts.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_sessions
       (id, task_id, task_title, agent_kind, status, status_message, cwd, name, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, ?, ?, '/tmp', 'test session', ?, ?)`,
  ).run(opts.id, opts.agentKind, opts.status, opts.statusMessage ?? null, now, now);
}

let msgSeq = 0;
function insertMessage(
  db: Database.Database,
  sessionId: string,
  role: 'input' | 'output' | 'system',
  tokens: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } } | null,
) {
  msgSeq++;
  const sdkMessageId = `msg-${sessionId}-${msgSeq}`;
  const tokensJson = tokens
    ? JSON.stringify({
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning ?? 0,
        cache: tokens.cache ?? { read: 0, write: 0 },
      })
    : null;
  db.prepare(
    `INSERT INTO agent_session_messages
       (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, tokens_json, cost)
     VALUES (?, ?, '', '', ?, '[]', ?, NULL)`,
  ).run(sessionId, role, sdkMessageId, tokensJson);
}

describe('run_quality_service (#865)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    setDb(db);
    msgSeq = 0;
  });

  it('issue-865-c1: reports completion vs escalation, token waste, and corrections per agent', () => {
    // 6 completed runs, 2 escalated runs -> measurable = 8 >= MIN_RUNS_FOR_SIGNAL.
    for (let i = 0; i < 6; i++) {
      const id = `completed-${i}`;
      insertSession(db, { id, agentKind: 'claude-code', status: 'closed' });
      insertMessage(db, id, 'input', { input: 100, output: 0 });
      insertMessage(db, id, 'output', { input: 0, output: 200 });
    }
    for (let i = 0; i < 2; i++) {
      const id = `escalated-${i}`;
      insertSession(db, {
        id,
        agentKind: 'claude-code',
        status: 'error',
        statusMessage: 'tool call failed: permission denied',
      });
      insertMessage(db, id, 'input', { input: 50, output: 0 });
      insertMessage(db, id, 'input', { input: 50, output: 0 }); // 1 correction
      insertMessage(db, id, 'output', { input: 0, output: 50 });
    }

    const rollup = getRunQualityRollup({}, { db });
    expect(rollup.agents).toHaveLength(1);
    const agent = rollup.agents[0];

    expect(agent.agentKind).toBe('claude-code');
    expect(agent.totalRuns).toBe(8);
    expect(agent.completedRuns).toBe(6);
    expect(agent.escalatedRuns).toBe(2);
    expect(agent.notEnoughData).toBe(false);
    expect(agent.completionRate).toBeCloseTo(6 / 8);
    expect(agent.escalationRate).toBeCloseTo(2 / 8);
    expect(agent.totalUserCorrections).toBe(2); // 1 correction per escalated run
    expect(agent.wastedTokens).toBeGreaterThan(0);
  });

  it('issue-865-c2: token waste is distinct from raw spend — all-clean agent has zero waste despite nonzero spend', () => {
    for (let i = 0; i < MIN_RUNS_FOR_SIGNAL; i++) {
      const id = `clean-${i}`;
      insertSession(db, { id, agentKind: 'codex', status: 'closed' });
      insertMessage(db, id, 'input', { input: 100, output: 0 });
      insertMessage(db, id, 'output', { input: 0, output: 300 });
    }

    const rollup = getRunQualityRollup({}, { db });
    const agent = rollup.agents.find((a) => a.agentKind === 'codex')!;

    expect(agent.totalTokens).toBeGreaterThan(0);
    expect(agent.wastedTokens).toBe(0);
    expect(agent.wastePercentOfSpend).toBe(0);
  });

  it('issue-865-c3: thin history reports notEnoughData=true with null rates, not a misleading 0%/100%', () => {
    // Only 2 measurable runs — below MIN_RUNS_FOR_SIGNAL.
    insertSession(db, { id: 'thin-1', agentKind: 'gemini-cli', status: 'closed' });
    insertSession(db, { id: 'thin-2', agentKind: 'gemini-cli', status: 'error', statusMessage: 'oops' });

    const rollup = getRunQualityRollup({}, { db });
    const agent = rollup.agents.find((a) => a.agentKind === 'gemini-cli')!;

    expect(agent.notEnoughData).toBe(true);
    expect(agent.completionRate).toBeNull();
    expect(agent.escalationRate).toBeNull();
    expect(agent.avgCorrectionsPerRun).toBeNull();
  });

  it('issue-865-c4: a run with an unrecognized non-terminal status is counted as unmeasured, not dropped or completed', () => {
    for (let i = 0; i < MIN_RUNS_FOR_SIGNAL; i++) {
      const id = `ok-${i}`;
      insertSession(db, { id, agentKind: 'claude-code', status: 'closed' });
    }
    // A row with a status this service doesn't recognize as terminal or live.
    insertSession(db, { id: 'weird-1', agentKind: 'claude-code', status: 'quarantined' });

    const rollup = getRunQualityRollup({}, { db });
    const agent = rollup.agents.find((a) => a.agentKind === 'claude-code')!;

    expect(agent.unmeasuredRuns).toBe(1);
    expect(agent.totalRuns).toBe(MIN_RUNS_FOR_SIGNAL + 1);
    // The unmeasured run must not be silently counted as completed.
    expect(agent.completedRuns).toBe(MIN_RUNS_FOR_SIGNAL);
  });

  it('issue-865-c5: escalation reasons recurring 2+ times are surfaced as repeated mistakes; one-offs are not', () => {
    for (let i = 0; i < MIN_RUNS_FOR_SIGNAL; i++) {
      const id = `filler-${i}`;
      insertSession(db, { id, agentKind: 'claude-code', status: 'closed' });
    }
    insertSession(db, {
      id: 'err-a',
      agentKind: 'claude-code',
      status: 'error',
      statusMessage: 'tool call failed: permission denied for session abc-123',
    });
    insertSession(db, {
      id: 'err-b',
      agentKind: 'claude-code',
      status: 'error',
      statusMessage: 'tool call failed: permission denied for session xyz-789',
    });
    insertSession(db, {
      id: 'err-c',
      agentKind: 'claude-code',
      status: 'error',
      statusMessage: 'network timeout contacting provider',
    });

    const rollup = getRunQualityRollup({}, { db });
    const agent = rollup.agents.find((a) => a.agentKind === 'claude-code')!;

    expect(agent.repeatedMistakes.length).toBe(1);
    expect(agent.repeatedMistakes[0].count).toBe(2);
    expect(agent.repeatedMistakes[0].message).toContain('permission denied');
  });

  it('respects the windowDays lookback — sessions outside the window are excluded', () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    insertSession(db, { id: 'old-1', agentKind: 'claude-code', status: 'closed', createdAt: old });

    const rollup = getRunQualityRollup({ windowDays: 30 }, { db });
    expect(rollup.agents).toHaveLength(0);
  });

  it('excludes system/background sessions (is_system=1)', () => {
    insertSession(db, { id: 'sys-1', agentKind: 'claude-code', status: 'closed' });
    db.prepare(`UPDATE agent_sessions SET is_system = 1 WHERE id = 'sys-1'`).run();

    const rollup = getRunQualityRollup({}, { db });
    expect(rollup.agents).toHaveLength(0);
  });

  it('returns an empty agents array when there are no sessions at all', () => {
    const rollup = getRunQualityRollup({}, { db: getDb() });
    expect(rollup.agents).toEqual([]);
  });
});
