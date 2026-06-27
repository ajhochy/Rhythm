/**
 * Regression: the agent "ask question" tool hangs forever when the
 * `question.asked` SSE event is missed.
 *
 * `question.asked` is a BusEvent and the bridge already replies correctly via
 * POST /question/{id}/reply (see opc_question_handshake.test.ts). But if the
 * live event is never delivered — a race between the engine asking and the
 * bridge's session-id reverse-map being populated, a child/subagent session,
 * or the engine dropping the event — no card is ever broadcast, so the user
 * cannot answer and opencode keeps the `question` tool blocked forever.
 *
 * opencode's own CLI transport recovers from this by polling `question.list`.
 * The bridge does the same: recoverPendingQuestions() reads GET /question,
 * reverse-maps each pending question to a local session, and surfaces any it is
 * not already tracking. These tests drive that recovery directly.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, sessionMap, listQuestionsSpy } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  listQuestionsSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    listQuestions: (dir?: string) => listQuestionsSpy(dir),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Real-shape entry from GET /question (the QuestionRequest list). */
function listEntry(sdkId: string) {
  return {
    id: 'que_recovered',
    sessionID: sdkId,
    questions: [
      {
        header: 'Recovered question',
        question: 'Which option do you prefer?',
        options: [
          { label: 'Option A', description: 'first' },
          { label: 'Option B', description: 'second' },
        ],
      },
    ],
    tool: { messageID: 'msg_1', callID: 'toolu_recovered' },
  };
}

function askedFrames() {
  return broadcastSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((m) => m.type === 'question.asked');
}

describe('OpencodeStreamBridge — missed question.asked recovery via question.list', () => {
  let bridge: OpencodeStreamBridge;
  const SDK_ID = 'sdk-recover-1';
  const DIR = '/tmp';
  let localId: string;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    listQuestionsSpy.mockReset();

    bridge = new OpencodeStreamBridge();

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: DIR,
      name: 'recover-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
  });

  it('surfaces a pending question the SSE stream never delivered', async () => {
    listQuestionsSpy.mockResolvedValue([listEntry(SDK_ID)]);

    await bridge.recoverPendingQuestions(DIR);

    const frames = askedFrames();
    expect(frames, 'a missed question must be recovered as a question.asked card').toHaveLength(1);
    expect(frames[0].sessionId).toBe(localId);
    expect(frames[0].requestId).toBe('que_recovered');
    expect(frames[0].callId).toBe('toolu_recovered');
    expect(Array.isArray(frames[0].questions)).toBe(true);
    // And it must be answerable by callId afterwards.
    const pending = bridge.getPendingQuestionByCallId(localId, 'toolu_recovered');
    expect(pending?.requestId).toBe('que_recovered');
  });

  it('is idempotent — a question already surfaced does not re-broadcast', async () => {
    listQuestionsSpy.mockResolvedValue([listEntry(SDK_ID)]);

    await bridge.recoverPendingQuestions(DIR);
    await bridge.recoverPendingQuestions(DIR);

    expect(askedFrames(), 'recovery must not double-broadcast the same question').toHaveLength(1);
  });

  it('does not resurface a question for a stopped session', async () => {
    listQuestionsSpy.mockResolvedValue([listEntry(SDK_ID)]);
    bridge.stopStream(localId);

    await bridge.recoverPendingQuestions(DIR);

    expect(askedFrames()).toHaveLength(0);
  });

  it('ignores questions whose SDK session id is not mapped locally', async () => {
    listQuestionsSpy.mockResolvedValue([listEntry('sdk-unknown')]);

    await bridge.recoverPendingQuestions(DIR);

    expect(askedFrames()).toHaveLength(0);
  });

  it('tolerates an empty list and a failing endpoint', async () => {
    listQuestionsSpy.mockResolvedValueOnce([]);
    await bridge.recoverPendingQuestions(DIR);
    expect(askedFrames()).toHaveLength(0);

    listQuestionsSpy.mockRejectedValueOnce(new Error('engine down'));
    await expect(bridge.recoverPendingQuestions(DIR)).resolves.toBeUndefined();
    expect(askedFrames()).toHaveLength(0);
  });
});
