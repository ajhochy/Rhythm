import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, listQuestionsSpy, rejectQuestionSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  listQuestionsSpy: vi.fn().mockResolvedValue([]),
  rejectQuestionSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: broadcastSpy,
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    listQuestions: listQuestionsSpy,
    rejectQuestion: rejectQuestionSpy,
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/skill_extractor', () => ({ queueSkillExtraction: vi.fn() }));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

function frames(type: string): Array<Record<string, unknown>> {
  return broadcastSpy.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((frame) => frame.type === type);
}

describe('#1382-G — unattended questions auto-resolve', () => {
  let bridge: OpencodeStreamBridge;
  let db: Database.Database;
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new AgentSessionsRepository();
    sessionMap.clear();
    broadcastSpy.mockClear();
    listQuestionsSpy.mockReset().mockResolvedValue([]);
    rejectQuestionSpy.mockReset().mockResolvedValue(true);
    bridge = new OpencodeStreamBridge();
  });

  function seed(input: {
    sdkId: string;
    isSystem?: boolean;
    scheduledTaskId?: string;
  }) {
    if (input.scheduledTaskId) {
      db.prepare('INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)')
        .run(input.scheduledTaskId, input.scheduledTaskId, 'scheduled prompt');
    }
    const row = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/questions-1382',
      name: input.sdkId,
      isSystem: input.isSystem,
      scheduledTaskId: input.scheduledTaskId,
    });
    repo.setSdkSessionId(row.id, input.sdkId);
    sessionMap.set(row.id, input.sdkId);
    return row;
  }

  function question(sdkId: string, requestId: string) {
    return {
      type: 'question.asked',
      properties: {
        id: requestId,
        sessionID: sdkId,
        questions: [{ header: 'Input', question: 'Continue?', options: [] }],
        tool: { callID: `call-${requestId}` },
      },
    };
  }

  function relay(event: unknown): void {
    (bridge as unknown as { _relayEvent(event: unknown): void })._relayEvent(event);
  }

  it('1382:G:1 rejects a live scheduled-system question without broadcasting an ask', () => {
    const session = seed({
      sdkId: 'sdk-scheduled-question',
      isSystem: true,
      scheduledTaskId: 'scheduled-question-1382',
    });

    relay(question('sdk-scheduled-question', 'que-scheduled'));

    expect(rejectQuestionSpy).toHaveBeenCalledOnce();
    expect(rejectQuestionSpy).toHaveBeenCalledWith('que-scheduled', '/tmp/questions-1382');
    expect(frames('question.resolved')).toContainEqual(expect.objectContaining({
      sessionId: session.id,
      requestId: 'que-scheduled',
      rejected: true,
    }));
    expect(frames('question.asked')).toHaveLength(0);
  });

  it('1382:G:2 keeps delegated-child questions answerable because the desktop can open child sessions', () => {
    const parent = seed({ sdkId: 'sdk-question-parent' });
    const child = repo.upsertChildSession(
      'sdk-question-child', 'sdk-question-parent', 'Question child', '/tmp/questions-1382',
    );
    expect(child?.parentSessionId).toBe(parent.id);
    sessionMap.set(child!.id, 'sdk-question-child');

    relay(question('sdk-question-child', 'que-child'));

    expect(rejectQuestionSpy).not.toHaveBeenCalled();
    expect(frames('question.asked')).toContainEqual(expect.objectContaining({
      sessionId: child!.id,
      requestId: 'que-child',
    }));
    expect(bridge.getPendingQuestion(child!.id, 'que-child')).toBeDefined();
  });

  it('1382:G:3 keeps an interactive root question visible and answerable', () => {
    const session = seed({ sdkId: 'sdk-interactive-question' });

    relay(question('sdk-interactive-question', 'que-interactive'));

    expect(rejectQuestionSpy).not.toHaveBeenCalled();
    expect(frames('question.asked')).toContainEqual(expect.objectContaining({
      sessionId: session.id,
      requestId: 'que-interactive',
    }));
    expect(bridge.getPendingQuestion(session.id, 'que-interactive')).toBeDefined();
  });

  it('1382:G:4 applies the same unattended rule during recovery', async () => {
    const session = seed({
      sdkId: 'sdk-recovered-question',
      isSystem: true,
      scheduledTaskId: 'recovered-question-1382',
    });
    listQuestionsSpy.mockResolvedValue([
      (question('sdk-recovered-question', 'que-recovered') as { properties: unknown }).properties,
    ]);

    await bridge.recoverPendingQuestions('/tmp/questions-1382');

    expect(rejectQuestionSpy).toHaveBeenCalledWith('que-recovered', '/tmp/questions-1382');
    expect(frames('question.resolved')).toContainEqual(expect.objectContaining({
      sessionId: session.id,
      requestId: 'que-recovered',
      rejected: true,
    }));
    expect(frames('question.asked')).toHaveLength(0);
  });

  it('1382:G:5 never rejects a recovered question for a stopped scheduled session', async () => {
    const session = seed({
      sdkId: 'sdk-stopped-question',
      isSystem: true,
      scheduledTaskId: 'stopped-question-1382',
    });
    bridge.stopStream(session.id);
    listQuestionsSpy.mockResolvedValue([
      (question('sdk-stopped-question', 'que-stopped') as { properties: unknown }).properties,
    ]);

    await bridge.recoverPendingQuestions('/tmp/questions-1382');

    expect(rejectQuestionSpy).not.toHaveBeenCalled();
    expect(frames('question.resolved')).toHaveLength(0);
    expect(frames('question.asked')).toHaveLength(0);
  });

  it('1382:G:6 rejects a live and recovered scheduled question only once', async () => {
    seed({
      sdkId: 'sdk-question-race',
      isSystem: true,
      scheduledTaskId: 'question-race-1382',
    });
    const event = question('sdk-question-race', 'que-race');
    listQuestionsSpy.mockResolvedValue([
      (event as { properties: unknown }).properties,
    ]);

    relay(event);
    await bridge.recoverPendingQuestions('/tmp/questions-1382');
    await Promise.resolve();

    expect(rejectQuestionSpy).toHaveBeenCalledTimes(1);
    expect(frames('question.resolved')).toHaveLength(1);
  });
});
