import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, listMessagesSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  listMessagesSpy: vi.fn(),
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
    listMessages: listMessagesSpy,
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

const SDK_ID = 'sdk-idle-contract';
let localId: string;
let bridge: OpencodeStreamBridge;

function relay(event: Record<string, unknown>): Promise<void> {
  return Promise.resolve(
    (bridge as unknown as { _relayEvent(event: unknown): void | Promise<void> })._relayEvent(event),
  );
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

function idle(): Promise<void> {
  return relay({ type: 'session.idle', properties: { sessionID: SDK_ID } });
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
    listMessagesSpy.mockReset();
    listMessagesSpy.mockResolvedValue([]);
    bridge = new OpencodeStreamBridge();
  });

  it('issue-1456-c1: part.updated-only text finalizes preview and transcript without error', async () => {
    part({ id: 'part-text', type: 'text', text: 'Persisted whole part' });
    await idle();

    expect(frames('error')).toEqual([]);
    expect(frames('transcript.append')).toContainEqual(expect.objectContaining({
      id: localId,
      text: 'Persisted whole part',
    }));
    expect(new AgentSessionsRepository().findById(localId)?.lastPreview)
      .toBe('Persisted whole part');
  });

  it('issue-1456-c2: genuinely empty structured turn still emits an error', async () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'unknown' });
    await idle();

    expect(frames('error')).toHaveLength(1);
    expect(frames('transcript.append')).toEqual([]);
  });

  it('filters user part.updated rows out of assistant transcript finalization', async () => {
    await relay({
      type: 'message.updated',
      properties: {
        sessionID: SDK_ID,
        info: { id: 'msg-user', sessionID: SDK_ID, role: 'user' },
      },
    });
    part({ id: 'part-user', messageID: 'msg-user', type: 'text', text: 'USER PROMPT' });
    await relay({
      type: 'message.updated',
      properties: {
        sessionID: SDK_ID,
        info: { id: 'msg-assistant', sessionID: SDK_ID, role: 'assistant' },
      },
    });
    part({ id: 'part-assistant', type: 'text', text: 'ASSISTANT RESPONSE' });

    await idle();

    expect(frames('transcript.append')).toEqual([expect.objectContaining({
      text: 'ASSISTANT RESPONSE',
    })]);
    expect(new AgentSessionsRepository().findById(localId)?.lastPreview)
      .toBe('ASSISTANT RESPONSE');
  });

  it('a user part without assistant output remains an empty assistant turn', async () => {
    await relay({
      type: 'message.updated',
      properties: {
        sessionID: SDK_ID,
        info: { id: 'msg-user', sessionID: SDK_ID, role: 'user' },
      },
    });
    part({ id: 'part-user', messageID: 'msg-user', type: 'text', text: 'USER ONLY' });

    await idle();

    expect(frames('transcript.append')).toEqual([]);
    expect(frames('error')).toEqual([expect.objectContaining({
      message: 'The model returned an empty response.',
    })]);
  });

  it('finalizes the current structured turn after more than 200 older messages', async () => {
    const messages = new AgentSessionMessagesRepository();
    for (let index = 0; index < 201; index += 1) {
      messages.append(localId, 'input', `old-${index}`, `old-${index}`);
    }
    part({ id: 'part-current', type: 'text', text: 'CURRENT ASSISTANT' });

    await idle();

    expect(frames('transcript.append').at(-1)?.text).toBe('CURRENT ASSISTANT');
    expect(new AgentSessionsRepository().findById(localId)?.lastPreview)
      .toBe('CURRENT ASSISTANT');
  });

  it('issue-1456-c3: structured finalization creates no duplicate legacy row', async () => {
    part({ id: 'part-text', type: 'text', text: 'One structured row' });
    await idle();

    expect(new AgentSessionMessagesRepository().listBySession(localId)).toHaveLength(1);
  });

  it('issue-1456-c4: delta-only and part.updated-only turns both finalize', async () => {
    relay({
      type: 'message.part.delta',
      properties: { part: { sessionID: SDK_ID }, field: 'text', delta: 'delta text' },
    });
    await idle();
    expect(frames('transcript.append').at(-1)?.text).toBe('delta text');

    broadcastSpy.mockClear();
    part({ id: 'part-text-2', type: 'text', text: 'whole text' });
    await idle();
    expect(frames('transcript.append').at(-1)?.text).toBe('whole text');
  });

  it('issue-1455-c1: content-filter stop reason replaces the generic error', async () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'content-filter' });
    await idle();

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
  ])('issue-1455-c2: %s has distinct actionable copy', async (reason, copy) => {
    part({ id: `part-${reason}`, type: 'step-finish', reason });
    await idle();

    expect(frames('error').at(-1)).toEqual(expect.objectContaining({
      stopReason: reason,
      message: expect.stringContaining(copy),
    }));
  });

  it.each([
    ['absent', undefined],
    ['literal unknown', 'unknown'],
  ])('issue-1455-c3: %s stop reason preserves the #636 fallback', async (_label, reason) => {
    if (reason) part({ id: 'part-finish', type: 'step-finish', reason });
    await idle();
    expect(frames('error').at(-1)).toEqual(expect.objectContaining({
      message: 'The model returned an empty response.',
    }));
  });

  it('issue-1455-c4: broadcast exposes the raw stopReason field', async () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'max_tokens' });
    await idle();

    expect(frames('error').at(-1)?.stopReason).toBe('max_tokens');
  });

  it('issue-1455-c5: persisted content-filter part drives the visible failure', async () => {
    part({ id: 'part-finish', type: 'step-finish', reason: 'content-filter' });
    expect(new AgentSessionMessagesRepository().listBySession(localId)[0].partsJson)
      .toContain('content-filter');
    await idle();

    expect(frames('error').at(-1)).toMatchObject({ stopReason: 'content-filter' });
  });

  it('does not await an engine history lookup before finalizing an empty turn', () => {
    listMessagesSpy.mockReturnValue(new Promise(() => {}));
    part({ id: 'part-start', type: 'step-start' });

    const result = (bridge as unknown as { _relayEvent(event: unknown): unknown })._relayEvent({
      type: 'session.idle', properties: { sessionID: SDK_ID },
    });

    expect(result).toBeUndefined();
    expect(frames('error')).toEqual([expect.objectContaining({
      message: 'The model returned an empty response.',
    })]);
    expect(listMessagesSpy).not.toHaveBeenCalled();
  });
});
