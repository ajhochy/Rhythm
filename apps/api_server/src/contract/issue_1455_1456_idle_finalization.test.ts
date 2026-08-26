import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (message: unknown) => broadcastSpy(message),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    listPermissions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

const SDK_ID = 'sdk-idle-contract';
let localId: string;
let bridge: OpencodeStreamBridge;

function relay(event: Record<string, unknown>): void {
  (bridge as unknown as { _relayEvent(event: unknown): void })._relayEvent(event);
}

function part(part: Record<string, unknown>): void {
  relay({
    type: 'message.part.updated',
    properties: {
      sessionID: SDK_ID,
      part: { messageID: 'msg-assistant', sessionID: SDK_ID, ...part },
    },
  });
}

function idle(): void {
  relay({ type: 'session.idle', properties: { sessionID: SDK_ID } });
}

function frames(type: string): Array<Record<string, unknown>> {
  return broadcastSpy.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((frame) => frame.type === type);
}

describe('issues #1455/#1456 idle finalization contract', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const session = new AgentSessionsRepository().insert({
      agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'idle contract',
    });
    localId = session.id;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);
    broadcastSpy.mockClear();
    bridge = new OpencodeStreamBridge();
  });

  it('issue-1456-c1: part.updated-only text finalizes preview and transcript without error', () => {
    part({ id: 'part-text', type: 'text', text: 'Persisted whole part' });
    idle();

    expect(frames('error')).toEqual([]);
    expect(frames('transcript.append')).toContainEqual(expect.objectContaining({
      id: localId,
      text: 'Persisted whole part',
    }));
    expect(new AgentSessionsRepository().findById(localId)?.lastPreview)
      .toBe('Persisted whole part');
  });

  it('issue-1456-c2: genuinely empty structured turn still emits an error', () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'unknown' });
    idle();

    expect(frames('error')).toHaveLength(1);
    expect(frames('transcript.append')).toEqual([]);
  });

  it('issue-1456-c3: structured finalization creates no duplicate legacy row', () => {
    part({ id: 'part-text', type: 'text', text: 'One structured row' });
    idle();

    expect(new AgentSessionMessagesRepository().listBySession(localId)).toHaveLength(1);
  });

  it('issue-1456-c4: delta-only and part.updated-only turns both finalize', () => {
    relay({
      type: 'message.part.delta',
      properties: { part: { sessionID: SDK_ID }, field: 'text', delta: 'delta text' },
    });
    idle();
    expect(frames('transcript.append').at(-1)?.text).toBe('delta text');

    broadcastSpy.mockClear();
    part({ id: 'part-text-2', type: 'text', text: 'whole text' });
    idle();
    expect(frames('transcript.append').at(-1)?.text).toBe('whole text');
  });

  it('issue-1455-c1: content-filter stop reason replaces the generic error', () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'content-filter' });
    idle();

    expect(frames('error')).toContainEqual(expect.objectContaining({
      stopReason: 'content-filter',
      message: expect.stringContaining('content filter'),
    }));
    expect(frames('error')[0].message).not.toBe('The model returned an empty response.');
  });

  it.each([
    ['aborted', 'aborted'],
    ['abort', 'aborted'],
    ['length', 'token'],
    ['max_tokens', 'token'],
    ['error', 'error'],
  ])('issue-1455-c2: %s has distinct actionable copy', (reason, copy) => {
    part({ id: `part-${reason}`, type: 'step-finish', reason });
    idle();

    expect(frames('error').at(-1)).toEqual(expect.objectContaining({
      stopReason: reason,
      message: expect.stringContaining(copy),
    }));
  });

  it.each([
    ['absent', undefined],
    ['literal unknown', 'unknown'],
  ])('issue-1455-c3: %s stop reason preserves the #636 fallback', (_label, reason) => {
    if (reason) part({ id: 'part-finish', type: 'step-finish', reason });
    idle();
    expect(frames('error').at(-1)).toEqual(expect.objectContaining({
      message: 'The model returned an empty response.',
    }));
  });

  it('issue-1455-c4: broadcast exposes the raw stopReason field', () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'max_tokens' });
    idle();

    expect(frames('error').at(-1)?.stopReason).toBe('max_tokens');
  });

  it('issue-1455-c5: persisted content-filter part drives the visible failure', () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'content-filter' });
    expect(new AgentSessionMessagesRepository().listBySession(localId)[0].partsJson)
      .toContain('content-filter');
    idle();

    expect(frames('error').at(-1)).toMatchObject({ stopReason: 'content-filter' });
  });
});
