/**
 * A background session (a coordinator run or a specialist it delegated to)
 * that starts waiting on the user raises a bell notification tagged with that
 * session; the desktop's own request banner covers the macOS side, so the tag
 * lets the renderer skip a duplicate banner. A root chat gets no bell entry:
 * its request card is already in front of the user.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, sessionMap } = vi.hoisted(() => ({ broadcastSpy: vi.fn(), sessionMap: new Map<string, string>() }));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: vi.fn(),
}));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { subscribeToEvents: vi.fn().mockResolvedValue(null) },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

function questionAsked(sdkId: string, id: string) {
  return {
    type: 'question.asked',
    properties: {
      id, sessionID: sdkId,
      questions: [{ header: 'Branch', question: 'Which branch?', options: [{ label: 'main', description: 'main' }] }],
      tool: { messageID: 'msg_1', callID: `toolu_${id}` },
    },
  };
}

describe('coordinator-workflow-runs-c8: a background session waiting on the user notifies', () => {
  let relay: (event: Record<string, unknown>) => void;
  let rootId: string;
  let runId: string;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    const bridge = new OpencodeStreamBridge();
    relay = (event) => (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
    const repo = new AgentSessionsRepository();
    rootId = repo.insert({ agentKind: 'secretary' as never, taskId: null, cwd: '/tmp', name: 'Rhythm Coordinator' }).id;
    repo.setSdkSessionId(rootId, 'sdk-root');
    const run = repo.upsertChildSession('sdk-run', 'sdk-root', 'Async delegation: Workflow Orchestrator', '/wt')!;
    runId = run.id;
    sessionMap.set(rootId, 'sdk-root');
    sessionMap.set(runId, 'sdk-run');
  });

  const pushes = () => broadcastSpy.mock.calls.map((call) => call[0] as Record<string, unknown>)
    .filter((message) => message.type === 'notification.push');

  it('a run asking a question pushes one bell notice tagged with the run session', () => {
    // Regression caught: a background run silently waits for an answer the user never sees.
    relay(questionAsked('sdk-run', 'que_run'));
    relay(questionAsked('sdk-run', 'que_run'));
    expect(pushes()).toEqual([expect.objectContaining({
      title: 'Rhythm needs you', sessionId: runId,
      body: 'Async delegation: Workflow Orchestrator is waiting for your answer.',
    })]);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM agent_notifications').get()).toEqual({ n: 1 });
  });

  it('the root chat the user is typing in gets no bell notice', () => {
    relay(questionAsked('sdk-root', 'que_root'));
    expect(pushes()).toEqual([]);
  });
});
