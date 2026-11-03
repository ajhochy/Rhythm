import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  respondPermissionSpy,
  replyToPermissionSpy,
  sessionMap,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  respondPermissionSpy: vi.fn().mockResolvedValue(true),
  replyToPermissionSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: broadcastSpy,
  broadcastSessionUpdated: broadcastSessionUpdatedSpy,
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    respondPermission: respondPermissionSpy,
    replyToPermission: replyToPermissionSpy,
    listQuestions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/skill_extractor', () => ({
  queueSkillExtraction: vi.fn(),
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import type { PermissionMode } from '../models/agent_session';

const PARENT_SDK_SESSION_ID = 'sdk-session-1156-parent';
const CHILD_SDK_SESSION_ID = 'sdk-session-1156-child';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Build a permission.asked event (the pre-execution gate opencode emits). */
function permissionEvent(
  sdkSessionId: string,
  toolName: string,
  permissionId: string,
  args: Record<string, unknown> = {},
) {
  return {
    type: 'permission.asked',
    properties: {
      permissionID: permissionId,
      sessionID: sdkSessionId,
      toolName,
      summary: `run ${toolName}`,
      args,
    },
  };
}

function acceptCalls() {
  return replyToPermissionSpy.mock.calls.filter((c) => c[1] === 'once');
}

function rejectCalls() {
  return replyToPermissionSpy.mock.calls.filter((c) => c[1] === 'reject');
}

function resolvedFrames(decision: 'accept' | 'deny') {
  return broadcastSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((f) => f.type === 'permission.resolved' && f.decision === decision);
}

function pendingAskFrames() {
  return broadcastSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((f) => f.type === 'permission.asked');
}

function nextAutomaticReplyTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('interactive async child permission requests', () => {
  let bridge: OpencodeStreamBridge;
  let repo: AgentSessionsRepository;
  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSessionsRepository();
    sessionMap.clear();
    vi.clearAllMocks();
    bridge = new OpencodeStreamBridge();
  });
  afterEach(() => vi.restoreAllMocks());
  function child(mode: PermissionMode, recorded = true) {
    const parent = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp/fixture', name: 'parent' });
    repo.setSdkSessionId(parent.id, PARENT_SDK_SESSION_ID);
    const row = repo.upsertChildSession(CHILD_SDK_SESSION_ID, PARENT_SDK_SESSION_ID,
      'Async delegation: specialist (@specialist subagent)', '/tmp/fixture')!;
    repo.updatePermissionMode(row.id, mode);
    sessionMap.set(row.id, CHILD_SDK_SESSION_ID);
    if (recorded) new AgentAsyncDelegationsRepository().create({parentSessionId: parent.id, childSessionId: row.id, targetAgentConfigId: 'specialist'});
    return row;
  }
  function ask(tool: string, args: Record<string, unknown> = {}) {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent(CHILD_SDK_SESSION_ID, tool, 'permission-fixture', args));
  }

  it('keeps a default-mode async external-directory request pending for the user', () => {
    const row = child('default');
    ask('external_directory');
    expect(acceptCalls()).toHaveLength(0);
    expect(rejectCalls()).toHaveLength(0);
    expect(pendingAskFrames()).toEqual([expect.objectContaining({ sessionId: row.id })]);
  });
  it('keeps an async bash approval request pending instead of treating it as unattended', () => {
    child('default');
    ask('bash', { command: 'git push origin main' });
    expect(acceptCalls()).toHaveLength(0);
    expect(rejectCalls()).toHaveLength(0);
    expect(pendingAskFrames()).toHaveLength(1);
  });
  it.each(['echo harmless-permission-probe', 'git push origin main'])('denies plan-mode bash %s with no executed approval', async (command) => {
    child('plan');
    ask('bash', { command });
    expect(acceptCalls()).toHaveLength(0);
    expect(rejectCalls()).toHaveLength(1);
    expect(pendingAskFrames()).toHaveLength(0);
    await nextAutomaticReplyTick();
    expect(resolvedFrames('deny')).toHaveLength(1);
  });
  it('preserves acceptEdits for edit requests', () => {
    child('acceptEdits');
    ask('edit');
    expect(acceptCalls()).toHaveLength(1);
    expect(pendingAskFrames()).toHaveLength(0);
  });
  it('keeps external-directory approval pending even in acceptEdits mode', () => {
    child('acceptEdits');
    ask('external_directory');
    expect(acceptCalls()).toHaveLength(0);
    expect(pendingAskFrames()).toHaveLength(1);
  });
  it('retains explicit bypass and existing legacy-child behavior', () => {
    child('bypassPermissions');
    ask('external_directory');
    expect(acceptCalls()).toHaveLength(1);
  });
  it('keeps the existing unrecorded legacy child behavior', () => {
    child('default', false);
    ask('glob');
    expect(acceptCalls()).toHaveLength(1);
  });
  it('fails closed to a visible request if async provenance cannot be read', () => {
    child('default');
    vi.spyOn(AgentAsyncDelegationsRepository.prototype, 'findByChildSessionId').mockImplementation(() => { throw Error('fixture read unavailable'); });
    ask('external_directory');
    expect(acceptCalls()).toHaveLength(0);
    expect(pendingAskFrames()).toHaveLength(1);
  });
});
