import Database from 'better-sqlite3';
import {
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import type express from 'express';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { User } from '../models/user';

const cloudBaseUrl = 'https://cloud-auth.contract.example';
const positiveCacheCapacity = 256;

const engine = vi.hoisted(() => ({
  sessionMap: new Map<string, string>(),
  client: {
    isReady: true,
    statusMessage: 'contract fake ready',
    createSession: vi.fn(async () => ({ id: crypto.randomUUID() })),
    listAgents: vi.fn(async () => []),
    listAuthedProviders: vi.fn(async () => []),
    getVcs: vi.fn(async () => ({ branch: null })),
    getVcsStatus: vi.fn(async () => []),
  },
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: engine.client,
  opencodeSessionMap: engine.sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn(async () => undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    clearPendingPermission: vi.fn(),
    getPendingPermission: vi.fn(),
  },
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

vi.mock('../services/anthropic_accounts_service', () => ({
  anthropicAccountsService: {
    defaultAccount: vi.fn(() => null),
    getAccount: vi.fn(() => null),
    setRouting: vi.fn(),
  },
}));

interface HttpResult {
  status: number;
  body: unknown;
}

interface TestContext {
  db: Database.Database;
  request: (
    path: string,
    token?: string,
    options?: RequestInit,
  ) => Promise<HttpResult>;
  owner: User;
  other: User;
  ownedSessionId: string;
  cloudHits: Map<string, number>;
  cloudUrls: string[];
}

let context: TestContext;

function cloudUserFor(localUser: User, cloudId: number): User {
  return {
    ...localUser,
    id: cloudId,
  };
}

async function dispatchExpress(
  app: ReturnType<typeof express>,
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<HttpResult> {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  }) as unknown as Socket;
  const request = new IncomingMessage(socket);
  request.method = options.method ?? 'GET';
  request.url = path;
  const headers = new Headers(options.headers);
  if (token !== undefined) headers.set('Authorization', `Bearer ${token}`);
  const body = typeof options.body === 'string' ? options.body : '';
  if (body) {
    headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json');
    headers.set('Content-Length', String(Buffer.byteLength(body)));
  }
  request.headers = Object.fromEntries(
    [...headers.entries()].map(([name, value]) => [name.toLowerCase(), value]),
  );
  request.push(body || null);
  if (body) request.push(null);

  const response = new ServerResponse(request);
  response.assignSocket(socket);
  return new Promise<HttpResult>((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks);
      const separator = raw.indexOf('\r\n\r\n');
      const responseBody = separator >= 0
        ? raw.subarray(separator + 4).toString('utf8')
        : '';
      resolve({
        status: response.statusCode,
        body: responseBody ? JSON.parse(responseBody) as unknown : null,
      });
    };
    response.once('error', reject);
    response.once('finish', settle);
    const originalEnd = response.end.bind(response);
    response.end = ((...args: Parameters<ServerResponse['end']>) => {
      const result = originalEnd(...args);
      queueMicrotask(settle);
      return result;
    }) as ServerResponse['end'];
    (
      app as unknown as {
        handle: (req: IncomingMessage, res: ServerResponse) => void;
      }
    ).handle(request, response);
  });
}

describe('local agent Cloud bearer authentication contract', () => {
  beforeAll(async () => {
    vi.stubEnv('AGENT_LOCAL', 'true');
    vi.stubEnv('RHYTHM_ROLE', 'local');
    vi.stubEnv('DB_CLIENT', 'sqlite');
    vi.stubEnv('RHYTHM_CLOUD_API_URL', `${cloudBaseUrl}/`);
    vi.stubEnv('PROD_API_URL', 'https://must-not-be-used.contract.example');
    engine.sessionMap.clear();
    vi.clearAllMocks();

    const cloudHits = new Map<string, number>();
    const cloudUrls: string[] = [];
    let owner: User;
    let other: User;

    const fetchStub = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input);
      if (url !== `${cloudBaseUrl}/auth/me`) {
        throw new Error(`Unexpected network request in contract: ${url}`);
      }

      cloudUrls.push(url);
      const authorization = new Headers(init?.headers).get('Authorization') ?? '';
      const token = authorization.replace(/^Bearer\s+/i, '');
      cloudHits.set(token, (cloudHits.get(token) ?? 0) + 1);

      if (token.startsWith('unreachable-cloud-token')) {
        throw new Error('contract cloud is offline');
      }
      if (token.startsWith('invalid-cloud-token')) {
        return new Response(null, { status: 401 });
      }

      const localUser = token === 'valid-other-cloud-token' ? other : owner;
      const cloudId = localUser === owner ? 91_001 : 91_002;
      return Response.json({
        user: cloudUserFor(localUser, cloudId),
        workspace: null,
      });
    });
    vi.stubGlobal('fetch', fetchStub);

    const [{ setDb }, { runMigrations }, { UsersRepository }, {
      AgentSessionsRepository,
    }] = await Promise.all([
      import('../database/db'),
      import('../database/migrations'),
      import('../repositories/users_repository'),
      import('../repositories/agent_sessions_repository'),
    ]);
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const users = new UsersRepository();
    owner = users.create({
      name: 'Cloud Owner',
      email: 'cloud-owner@example.com',
      googleSub: 'google-cloud-owner',
    });
    other = users.create({
      name: 'Cloud Other',
      email: 'cloud-other@example.com',
      googleSub: 'google-cloud-other',
    });
    const ownedSession = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: process.cwd(),
      name: 'Owner private session',
      ownerUserId: owner.id,
    });

    const [{ default: expressModule }, { agentSessionsRouter }, {
      errorHandler,
    }] = await Promise.all([
      import('express'),
      import('../routes/agent_sessions_routes'),
      import('../middleware/error_handler'),
    ]);
    const app: ReturnType<typeof express> = expressModule();
    app.use(expressModule.json());
    app.use('/agent-sessions', agentSessionsRouter);
    app.use(errorHandler);

    context = {
      db,
      owner,
      other,
      ownedSessionId: ownedSession.id,
      cloudHits,
      cloudUrls,
      request: (path, token, options) =>
        dispatchExpress(app, path, token, options),
    };
  });

  afterAll(() => {
    context?.db.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('local-agent-cloud-token-auth-c1: accepts a Cloud-only bearer and writes the Google-subject-matched local owner', async () => {
    // Regression caught: requireAuth checks only local sessions, so the POST
    // returns 401 and cannot stamp owner_user_id from the Cloud identity.
    const token = 'valid-owner-cloud-token';
    const localSessionCount = context.db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE token = ?')
      .get(token) as { count: number };
    expect(localSessionCount.count).toBe(0);

    const response = await context.request('/agent-sessions', token, {
      method: 'POST',
      body: JSON.stringify({
        agentId: null,
        cwd: process.cwd(),
        name: 'Cloud-authenticated creation',
      }),
    });

    expect(response.status).toBe(201);
    expect(
      context.db
        .prepare(
          'SELECT owner_user_id FROM agent_sessions WHERE name = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get('Cloud-authenticated creation'),
    ).toEqual({ owner_user_id: context.owner.id });
  });

  it('local-agent-cloud-token-auth-c2: one positive Cloud verification covers at least twenty desktop fan-out requests', async () => {
    // Regression caught: every list/detail/todo/provenance/VCS request calls
    // Cloud independently, creating the desktop request storm.
    const token = 'valid-fanout-cloud-token';
    const paths = [
      '/agent-sessions?scope=chats',
      `/agent-sessions/${context.ownedSessionId}`,
      `/agent-sessions/${context.ownedSessionId}/todo`,
      `/agent-sessions/${context.ownedSessionId}/memory-provenance`,
      `/agent-sessions/${context.ownedSessionId}/vcs`,
      `/agent-sessions/${context.ownedSessionId}/vcs/status`,
      '/agent-sessions/agents',
    ];

    for (let index = 0; index < 21; index += 1) {
      const response = await context.request(paths[index % paths.length], token);
      expect(response.status).toBe(200);
    }
    expect(context.cloudHits.get(token)).toBe(1);
  });

  it('local-agent-cloud-token-auth-c3: a positive cache entry expires after five minutes', async () => {
    // Regression caught: an unbounded-duration positive cache continues to
    // authorize a revoked Cloud token indefinitely.
    const token = 'valid-ttl-cloud-token';
    let now = new Date('2026-07-30T12:00:00.000Z').getTime();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      expect((await context.request('/agent-sessions?scope=chats', token)).status).toBe(200);
      now += 5 * 60_000 - 1;
      expect((await context.request('/agent-sessions?scope=chats', token)).status).toBe(200);
      expect(context.cloudHits.get(token)).toBe(1);

      now += 2;
      expect((await context.request('/agent-sessions?scope=chats', token)).status).toBe(200);
      expect(context.cloudHits.get(token)).toBe(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('local-agent-cloud-token-auth-c4: the positive cache evicts its oldest entry at its bound', async () => {
    // Regression caught: a process receiving many distinct valid tokens grows
    // the positive cache without limit.
    for (let index = 0; index <= positiveCacheCapacity; index += 1) {
      const response = await context.request(
        '/agent-sessions?scope=chats',
        `valid-bounded-cloud-token-${index}`,
      );
      expect(response.status).toBe(200);
    }
    const oldest = 'valid-bounded-cloud-token-0';
    expect(context.cloudHits.get(oldest)).toBe(1);

    expect((await context.request('/agent-sessions?scope=chats', oldest)).status).toBe(200);
    expect(context.cloudHits.get(oldest)).toBe(2);
  });

  it('local-agent-cloud-token-auth-c5: invalid Cloud tokens fail 401 and are never cached', async () => {
    // Regression caught: an unknown bearer falls through to the tokenless
    // AGENT_LOCAL bypass, or a negative result suppresses a later re-check.
    const token = 'invalid-cloud-token-contract';
    expect((await context.request('/agent-sessions?scope=chats', token)).status).toBe(401);
    expect((await context.request('/agent-sessions?scope=chats', token)).status).toBe(401);
    expect(context.cloudHits.get(token)).toBe(2);
  });

  it('local-agent-cloud-token-auth-c6: unreachable Cloud fails 503 AUTH_UNAVAILABLE and is never cached', async () => {
    // Regression caught: a network failure is converted to a local bypass or
    // a cached denial instead of propagating the service's availability error.
    const token = 'unreachable-cloud-token-contract';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await context.request('/agent-sessions?scope=chats', token);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'Rhythm Cloud authentication is unavailable',
        },
      });
    }
    expect(context.cloudHits.get(token)).toBe(2);
  });

  it('local-agent-cloud-token-auth-c7: a different Cloud-mapped user cannot read the owner session', async () => {
    // Regression caught: accepting Cloud identity without applying its local
    // owner id allows any signed-in user to read another user's transcript.
    const response = await context.request(
      `/agent-sessions/${context.ownedSessionId}`,
      'valid-other-cloud-token',
    );
    expect([403, 404]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toContain('Owner private session');
  });

  it('local-agent-cloud-token-auth-c8: Cloud verification URL comes from env, not request input', async () => {
    // Regression caught: a client-controlled header redirects bearer
    // verification and leaks the token to an attacker-controlled server.
    const urlsBefore = context.cloudUrls.length;
    const response = await context.request(
      '/agent-sessions?scope=chats',
      'valid-env-url-cloud-token',
      {
        headers: {
          'X-Rhythm-Cloud-API-URL': 'https://attacker.invalid',
          'X-Server-URL': 'https://attacker.invalid',
        },
      },
    );
    expect(response.status).toBe(200);
    expect(context.cloudUrls.slice(urlsBefore)).toEqual([
      `${cloudBaseUrl}/auth/me`,
    ]);
  });

  it('local-agent-cloud-token-auth-c9: authentication logs contain no bearer or distinctive token fragment', async () => {
    // Regression caught: authorization failure logging includes the raw bearer
    // or a stable fragment that can be used to recover it.
    const token = 'invalid-cloud-token-do-not-log-this-fragment';
    const captured: unknown[][] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => captured.push(args));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => captured.push(args));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => captured.push(args));
    try {
      expect((await context.request('/agent-sessions?scope=chats', token)).status).toBe(401);

      const logs = JSON.stringify(captured);
      expect(logs).not.toContain(token);
      expect(logs).not.toContain('do-not-log-this-fragment');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('local-agent-cloud-token-auth-c10: absent Authorization keeps the existing AGENT_LOCAL bypass', async () => {
    // Regression caught: adding Cloud verification accidentally removes the
    // separately owned tokenless local compatibility path.
    const urlsBefore = context.cloudUrls.length;
    const response = await context.request('/agent-sessions?scope=chats');
    expect(response.status).toBe(200);
    expect(context.cloudUrls).toHaveLength(urlsBefore);
  });
});
