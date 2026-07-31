import { existsSync, readFileSync } from 'fs';
import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { engineState, listAgentsMock, syncProfilesMock } = vi.hoisted(() => ({
  engineState: { isReady: true },
  listAgentsMock: vi.fn(),
  syncProfilesMock: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return engineState.isReady;
    },
    listAgents: listAgentsMock,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/agent_profile_sync', () => ({
  syncOpencodeAgentProfiles: syncProfilesMock,
}));

import { AgentSessionsController } from '../controllers/agent_sessions_controller';

type ResponseState = {
  statusCode: number;
  body: unknown;
};

function responseRecorder(): { res: Response; state: ResponseState } {
  const state: ResponseState = { statusCode: 200, body: null };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
    end() {
      return this;
    },
  } as unknown as Response;
  return { res, state };
}

function nextOrThrow(error?: unknown): void {
  if (error) throw error;
}

function seedSession(messageCount: number): {
  sessionId: string;
  messageIds: number[];
} {
  const session = new AgentSessionsRepository().insert({
    agentKind: 'claude-code',
    taskId: null,
    cwd: '/tmp/r5-contract',
    name: 'R5 transcript',
  });
  const messages = new AgentSessionMessagesRepository();
  const messageIds = Array.from({ length: messageCount }, (_, index) => {
    return messages.append(
      session.id,
      index % 2 === 0 ? 'input' : 'output',
      `message-${index + 1}`,
      `message-${index + 1}`,
    ).id;
  });
  return { sessionId: session.id, messageIds };
}

describe('R5 minimal desktop agent catalog', () => {
  let controller: AgentSessionsController;
  let configs: AgentConfigsRepository;
  const next = nextOrThrow as NextFunction;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    controller = new AgentSessionsController();
    configs = new AgentConfigsRepository();
    engineState.isReady = true;
    listAgentsMock.mockReset();
    syncProfilesMock.mockReset().mockResolvedValue({ synced: 0 });
  });

  it('r5-c1: view=picker returns the MSP-001 vocabulary and excludes raw permissions', async () => {
    // Regression caught: the desktop picker receives the SDK agent object
    // wholesale, including its very large permission map.
    configs.insert({
      id: 'profile-safe',
      label: 'Coding Workflow',
      icon: 'terminal',
      enabled: true,
      isAgent: true,
      sessionSelectable: true,
      ocAgent: 'engine-safe',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      reasoningEffort: 'high',
    });
    listAgentsMock.mockResolvedValue([
      {
        name: 'engine-safe',
        description: 'Build and review code',
        builtIn: false,
        mode: 'primary',
        permission: { secret: 'MUST_NOT_LEAK' },
      },
    ]);

    const { res, state } = responseRecorder();
    await controller.listAgents(
      { query: { view: 'picker' } } as unknown as Request,
      res,
      next,
    );

    expect(state.body).toEqual({
      agents: [
        {
          profileId: 'profile-safe',
          opencodeAgentId: 'engine-safe',
          name: 'Coding Workflow',
          defaults: {
            providerId: 'anthropic',
            modelId: 'claude-sonnet-4-5',
            reasoningEffort: 'high',
            approvalMode: 'default',
          },
          display: {
            icon: 'terminal',
            color: null,
          },
          profileAvailability: 'available',
          builtIn: false,
        },
      ],
    });
    expect(JSON.stringify(state.body)).not.toContain('permission');
    expect(JSON.stringify(state.body)).not.toContain('MUST_NOT_LEAK');
  });

  it('r5-c2: every GET variant is reconciliation-free while full=1 preserves raw consumers', async () => {
    // Regression caught: a read-only picker request starts DB reconciliation
    // and agent-file projection as a fire-and-forget side effect.
    const rawAgent = {
      name: 'build',
      builtIn: true,
      mode: 'primary',
      permission: { edit: 'ask' },
    };
    listAgentsMock.mockResolvedValue([rawAgent]);

    for (const query of [{ view: 'picker' }, { full: '1' }, {}]) {
      const { res, state } = responseRecorder();
      await controller.listAgents(
        { query } as unknown as Request,
        res,
        next,
      );
      if ('full' in query || Object.keys(query).length === 0) {
        expect(state.body).toEqual({ agents: [rawAgent] });
      }
    }

    expect(syncProfilesMock).not.toHaveBeenCalled();
  });

  it('r5-c3: POST refresh is the explicit reconciliation path', async () => {
    // Regression caught: removing reconciliation from GET leaves no explicit
    // way for Agent Designer/config workflows to refresh engine projections.
    const refresh = (
      controller as unknown as {
        refreshAgents?: (
          req: Request,
          res: Response,
          next: NextFunction,
        ) => Promise<void>;
      }
    ).refreshAgents;
    expect(typeof refresh).toBe('function');
    if (!refresh) return;

    listAgentsMock.mockResolvedValue([{ name: 'build', builtIn: true }]);
    const { res, state } = responseRecorder();
    await refresh.call(
      controller,
      { query: {}, body: {} } as unknown as Request,
      res,
      next,
    );

    expect(listAgentsMock).toHaveBeenCalledOnce();
    expect(syncProfilesMock).toHaveBeenCalledOnce();
    expect(state.body).toMatchObject({ refreshed: true });
  });

  it('r5-c4: 39-agent picker catalog stays under the documented 32 KiB budget', async () => {
    // Regression caught: the 39-agent response grows back toward the observed
    // ~1.77 MB because permission/config fields are accidentally reintroduced.
    const permissionBlob = 'x'.repeat(45_000);
    const rawAgents = Array.from({ length: 39 }, (_, index) => ({
      name: `engine-${index}`,
      description: `Agent ${index}`,
      builtIn: index < 2,
      mode: 'subagent',
      permission: { bash: { '*': 'ask' }, payload: permissionBlob },
    }));
    listAgentsMock.mockResolvedValue(rawAgents);

    const { res, state } = responseRecorder();
    await controller.listAgents(
      { query: { view: 'picker' } } as unknown as Request,
      res,
      next,
    );

    const bytes = Buffer.byteLength(JSON.stringify(state.body), 'utf8');
    console.info(`R5 picker payload: ${bytes} bytes for 39 agents`);
    expect(bytes).toBeLessThanOrEqual(32 * 1024);
    expect((state.body as { agents: unknown[] }).agents).toHaveLength(39);
  });
});

describe('R5 transcript cursor windows', () => {
  let controller: AgentSessionsController;
  const next = nextOrThrow as NextFunction;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    controller = new AgentSessionsController();
  });

  it('r5-c5: messages returns latest-first windows in display order with an exclusive before cursor', () => {
    // Regression caught: limit returns the oldest rows, so opening a long
    // transcript hides the current conversation and cannot page backward.
    const { sessionId, messageIds } = seedSession(220);
    const legacy = responseRecorder();
    controller.listMessages(
      {
        params: { id: sessionId },
        query: {},
      } as unknown as Request,
      legacy.res,
      next,
    );
    expect(
      (
        legacy.state.body as {
          messages: Array<{ id: number }>;
        }
      ).messages.map((message) => message.id),
    ).toEqual(messageIds.slice(20));

    const first = responseRecorder();
    controller.listMessages(
      {
        params: { id: sessionId },
        query: { limit: '20' },
      } as unknown as Request,
      first.res,
      next,
    );

    const firstBody = first.state.body as {
      messages: Array<{ id: number }>;
      pageInfo: { nextCursor: string | null; hasMore: boolean };
    };
    expect(firstBody.messages.map((message) => message.id)).toEqual(
      messageIds.slice(200),
    );
    expect(firstBody.pageInfo).toEqual({
      nextCursor: String(messageIds[200]),
      hasMore: true,
    });

    const second = responseRecorder();
    controller.listMessages(
      {
        params: { id: sessionId },
        query: { limit: '20', before: firstBody.pageInfo.nextCursor },
      } as unknown as Request,
      second.res,
      next,
    );
    const secondBody = second.state.body as {
      messages: Array<{ id: number }>;
      pageInfo: { nextCursor: string | null; hasMore: boolean };
    };
    expect(secondBody.messages.map((message) => message.id)).toEqual(
      messageIds.slice(180, 200),
    );
    expect(secondBody.pageInfo).toEqual({
      nextCursor: String(messageIds[180]),
      hasMore: true,
    });
  });

  it('r5-c6: session detail can opt into a bounded recent transcript window', () => {
    // Regression caught: GET session detail serializes hundreds of messages
    // even when the desktop only needs the recent opening window.
    const { sessionId, messageIds } = seedSession(75);
    const { res, state } = responseRecorder();
    controller.getOne(
      {
        params: { id: sessionId },
        query: { transcriptLimit: '25' },
      } as unknown as Request,
      res,
      next,
    );

    const body = state.body as {
      messages: Array<{ id: number }>;
      transcriptPage: { nextCursor: string | null; hasMore: boolean };
    };
    expect(body.messages.map((message) => message.id)).toEqual(
      messageIds.slice(50),
    );
    expect(body.transcriptPage).toEqual({
      nextCursor: String(messageIds[50]),
      hasMore: true,
    });
  });

  it('r5-c7: the documented DTO names, compatibility gate, cursor, and byte budget exist', () => {
    // Regression caught: desktop and mobile silently drift to two meanings for
    // profileId/opencodeAgentId or the payload budget becomes tribal knowledge.
    const docPath =
      '../../docs/ai/contracts/r5-agent-dto-transcript-pagination.md';
    expect(existsSync(docPath)).toBe(true);
    if (!existsSync(docPath)) return;
    const doc = readFileSync(docPath, 'utf8');
    for (const required of [
      'profileId',
      'opencodeAgentId',
      'defaults',
      'profileAvailability',
      'view=picker',
      'full=1',
      '32 KiB',
      'before',
    ]) {
      expect(doc).toContain(required);
    }
  });
});
