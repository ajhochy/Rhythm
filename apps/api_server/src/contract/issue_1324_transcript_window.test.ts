import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionsController } from '../controllers/agent_sessions_controller';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { assertLiveE2EIsolation } from '../__tests__/_live_e2e_guard';

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

type ResponseState = { body: unknown };

function responseRecorder(): { res: Response; state: ResponseState } {
  const state: ResponseState = { body: null };
  const res = {
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, state };
}

function nextOrThrow(error?: unknown): void {
  if (error) throw error;
}

describe('issue #1324 transcript window contract', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
  });

  it('issue-1324-c1: non-paged session detail returns the newest 200 messages in ascending order', () => {
    // Regression caught: ASC + LIMIT 200 returns message-1..message-200 and
    // silently drops the five newest messages from a 205-message transcript.
    const session = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/issue-1324',
      name: 'Long transcript',
    });
    const messages = new AgentSessionMessagesRepository();
    for (let index = 1; index <= 205; index += 1) {
      messages.append(
        session.id,
        index % 2 === 0 ? 'output' : 'input',
        `message-${index}`,
        `message-${index}`,
      );
    }

    const { res, state } = responseRecorder();
    new AgentSessionsController().getOne(
      {
        params: { id: session.id },
        query: {},
      } as unknown as Request,
      res,
      nextOrThrow as NextFunction,
    );

    const body = state.body as { messages: Array<{ rawText: string }> };
    expect(body.messages).toHaveLength(200);
    expect(body.messages[0]?.rawText).toBe('message-6');
    expect(body.messages.at(-1)?.rawText).toBe('message-205');
  });
});

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const LIVE_BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const LIVE_SESSION_ID = process.env.RHYTHM_LIVE_R5_SESSION_ID;
const describeLive = LIVE ? describe : describe.skip;

describeLive('issue #1324 live non-paged transcript window', () => {
  beforeAll(() => {
    assertLiveE2EIsolation();
    if (!LIVE_SESSION_ID) {
      throw new Error('RHYTHM_LIVE_R5_SESSION_ID must name a sandbox session with more than 200 messages');
    }
  });

  it('issue-1324-c1-live: non-paged detail matches the newest 200-message page', async () => {
    const pagedResponse = await fetch(
      `${LIVE_BASE}/agent-sessions/${LIVE_SESSION_ID}?transcriptLimit=200`,
    );
    const nonPagedResponse = await fetch(
      `${LIVE_BASE}/agent-sessions/${LIVE_SESSION_ID}`,
    );
    expect(pagedResponse.status).toBe(200);
    expect(nonPagedResponse.status).toBe(200);

    const paged = await pagedResponse.json() as {
      messages: Array<{ id: number }>;
      transcriptPage: { hasMore: boolean };
    };
    const nonPaged = await nonPagedResponse.json() as {
      messages: Array<{ id: number }>;
    };
    expect(paged.transcriptPage.hasMore).toBe(true);
    expect(nonPaged.messages.map((message) => message.id)).toEqual(
      paged.messages.map((message) => message.id),
    );
  });
});
