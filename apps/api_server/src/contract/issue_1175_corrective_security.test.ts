import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { errorHandler } from '../middleware/error_handler';
import {
  initializeMobileOpenCodeOwnershipSchema,
  MobileOpenCodeOwnershipRepository,
} from '../repositories/mobile_opencode_ownership_repository';
import {
  initializeMobilePairingSchema,
} from '../repositories/mobile_devices_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  GoogleAccountAuthorizationService,
} from '../services/google_account_authorization_service';
import { AuthService, type GoogleIdentity } from '../services/auth_service';
import { resetMobileGatewayRuntimeForTest } from '../services/mobile_gateway_runtime';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import { MobilePtyProxy } from '../services/mobile_pty_proxy';
import { MobileSseProxy } from '../services/mobile_sse_proxy';
import { createMobileGatewayRouter } from '../routes/mobile_gateway_routes';
import {
  installHumanApprovalTestCredentials,
} from '../__tests__/helpers/human_approval_test_credentials';
import { startTestServer } from '../__tests__/helpers/real_server';

const project = {
  id: 'corrective-project',
  root: '/sandbox/corrective-project',
  name: 'Corrective project',
};

function responseSink(): PassThrough & {
  statusCode: number;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
} {
  const stream = new PassThrough() as ReturnType<typeof responseSink>;
  stream.statusCode = 200;
  stream.headers = {};
  stream.setHeader = (name: string, value: string) => {
    stream.headers[name.toLowerCase()] = value;
  };
  stream.flushHeaders = vi.fn();
  return stream;
}

describe('issue #1175 corrective security acceptance contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    initializeMobilePairingSchema(db);
    initializeMobileOpenCodeOwnershipSchema(db);
  });

  afterEach(() => {
    resetMobileGatewayRuntimeForTest();
    db.close();
    vi.restoreAllMocks();
  });

  it('issue-1175-c26: two paired users cannot cross HTTP SSE or PTY ownership boundaries', async () => {
    const users = new UsersRepository();
    const alice = users.create({
      name: 'Alice',
      email: 'alice-c26@example.com',
    });
    const bob = users.create({
      name: 'Bob',
      email: 'bob-c26@example.com',
    });
    const owners = new MobileOpenCodeOwnershipRepository(db);
    expect(
      owners.claimResource('session', 'ses-alice', alice.id, project.id),
    ).toBe(true);
    expect(
      owners.claimResource('session', 'ses-bob', bob.id, project.id),
    ).toBe(true);
    expect(
      owners.claimResource('pty', 'pty-alice', alice.id, project.id),
    ).toBe(true);

    const sessions = [
      {
        id: 'ses-alice',
        directory: project.root,
        title: 'Alice private',
      },
      {
        id: 'ses-bob',
        directory: project.root,
        title: 'Bob private',
      },
      {
        id: 'ses-legacy',
        directory: project.root,
        title: 'Unowned legacy',
      },
    ];
    let mutationCount = 0;
    const fetchFn = vi.fn(async (
      input: string | URL | Request,
    ): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname === '/session') {
        return Response.json(sessions);
      }
      if (url.pathname === '/session/status') {
        return Response.json({
          'ses-alice': { type: 'idle' },
          'ses-bob': { type: 'idle' },
          'ses-legacy': { type: 'idle' },
        });
      }
      mutationCount += 1;
      return Response.json(true);
    });
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4097',
      fetchFn,
      ownershipRepository: owners,
    });
    const aliceList = await proxy.forward({
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project,
      userId: alice.id,
    });
    expect(JSON.parse(Buffer.from(aliceList.body).toString('utf8'))).toEqual([
      expect.objectContaining({ id: 'ses-alice' }),
    ]);
    await expect(proxy.forward({
      method: 'POST',
      path: '/session/ses-alice/abort',
      query: new URLSearchParams(),
      project,
      userId: bob.id,
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(proxy.forward({
      method: 'POST',
      path: '/session/ses-legacy/abort',
      query: new URLSearchParams(),
      project,
      userId: alice.id,
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(mutationCount).toBe(0);

    const request = new EventEmitter();
    const response = responseSink();
    let sseFetches = 0;
    const frames = [
      {
        directory: project.root,
        payload: {
          id: 'event-alice',
          type: 'session.updated',
          properties: {
            info: { id: 'ses-alice', directory: project.root },
          },
        },
      },
      {
        directory: project.root,
        payload: {
          id: 'event-bob',
          type: 'session.updated',
          properties: {
            info: { id: 'ses-bob', directory: project.root },
          },
        },
      },
      {
        directory: project.root,
        payload: {
          id: 'event-legacy',
          type: 'session.updated',
          properties: {
            info: { id: 'ses-legacy', directory: project.root },
          },
        },
      },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
    const sse = new MobileSseProxy({
      ownershipRepository: owners,
      reconnectBaseMs: 1,
      reconnectMaxMs: 1,
      fetchFn: vi.fn(async () => {
        sseFetches += 1;
        if (sseFetches > 1) {
          request.emit('close');
          throw new Error('closed');
        }
        return new Response(frames, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    });
    let streamed = '';
    response.on('data', (chunk) => {
      streamed += chunk.toString();
    });
    await sse.stream({
      request: request as never,
      response: response as never,
      project,
      userId: alice.id,
      isDeviceActive: () => true,
    });
    expect(streamed).toContain('event-alice');
    expect(streamed).not.toContain('event-bob');
    expect(streamed).not.toContain('event-legacy');

    const engineFactory = vi.fn();
    const pty = new MobilePtyProxy({
      ownershipRepository: owners,
      authenticateDevice: vi.fn(() => ({
        id: 'device-bob',
        hostId: 'host-c26',
        userId: bob.id,
        name: 'Bob iPhone',
        revokedAt: null,
        createdAt: new Date().toISOString(),
      })),
      resolveProject: vi.fn(() => project),
      engineFactory,
    });
    const socket = new PassThrough();
    expect(pty.handleUpgrade({
      url:
        '/mobile-gateway/pty/pty-alice/connect' +
        '?ticket=corrective-ticket-123',
      headers: {
        authorization: 'Device bob-token',
        'x-rhythm-project-id': project.id,
      },
    } as never, socket, Buffer.alloc(0))).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(socket.read()?.toString()).toContain('404 Not Found');
    expect(engineFactory).not.toHaveBeenCalled();
    pty.close();
  });

  it('issue-1175-c27: bearer credentials cannot administer mobile access and Device self-revoke remains scoped', async () => {
    const credentials = installHumanApprovalTestCredentials();
    const user = new UsersRepository().create({
      name: 'Desktop human',
      email: 'desktop-human-c27@example.com',
    });
    const session = new SessionsRepository().create(user.id);
    const bearerHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };
    const app = express();
    app.use(express.json());
    app.use('/mobile-gateway', createMobileGatewayRouter());
    app.use(errorHandler);
    const server = await startTestServer(app);
    try {
      for (const [method, path] of [
        ['POST', '/mobile-gateway/pairing-codes'],
        ['GET', '/mobile-gateway/access'],
        ['POST', '/mobile-gateway/access/enable'],
        ['GET', '/mobile-gateway/devices'],
      ] as const) {
        const denied = await fetch(`${server.baseUrl}${path}`, {
          method,
          headers: bearerHeaders,
          ...(method === 'POST' ? { body: '{}' } : {}),
        });
        expect(denied.status, `${method} ${path}`).toBe(403);
      }
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM mobile_pairing_codes')
          .get(),
      ).toEqual({ count: 0 });

      const codeResponse = await fetch(
        `${server.baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            ...bearerHeaders,
            ...credentials.capabilityHeader,
          },
          body: '{}',
        },
      );
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as {
        pairingCode: string;
        hostId: string;
      };
      const pairResponse = await fetch(
        `${server.baseUrl}/mobile-gateway/pair`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: code.pairingCode,
            hostId: code.hostId,
            deviceName: 'Self-revoking iPhone',
          }),
        },
      );
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };

      const bearerRevoke = await fetch(
        `${server.baseUrl}/mobile-gateway/devices/${paired.deviceId}`,
        { method: 'DELETE', headers: bearerHeaders },
      );
      expect(bearerRevoke.status).toBe(403);
      expect(
        db.prepare(
          'SELECT revoked_at FROM mobile_devices WHERE id = ?',
        ).get(paired.deviceId),
      ).toEqual({ revoked_at: null });

      const selfRevoke = await fetch(
        `${server.baseUrl}/mobile-gateway/devices/${paired.deviceId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Device ${paired.deviceToken}` },
        },
      );
      expect(selfRevoke.status).toBe(204);
      expect(
        db.prepare(
          'SELECT revoked_at FROM mobile_devices WHERE id = ?',
        ).get(paired.deviceId),
      ).toMatchObject({ revoked_at: expect.any(String) });
    } finally {
      await server.close();
    }
  });

  it('issue-1175-c28: unauthorized Google identities are rejected before all persistence paths', async () => {
    const users = new UsersRepository();
    const sessions = new SessionsRepository();
    const external: GoogleIdentity = {
      sub: 'external-google-sub',
      email: 'outsider@gmail.com',
      name: 'External verified user',
      picture: null,
      hostedDomain: null,
    };
    const authorization = new GoogleAccountAuthorizationService({
      allowedEmails: ['invited@example.com'],
      allowedHostedDomains: ['visaliacrc.com'],
    });
    const auth = new AuthService(
      users,
      sessions,
      { verifyIdToken: async () => external } as never,
      authorization,
    );

    await expect(
      auth.loginWithGoogleIdToken('verified-but-external'),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(auth.loginWithGoogleProfile({
      googleSub: external.sub,
      email: external.email,
      name: external.name,
      photoUrl: null,
      hostedDomain: null,
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get())
      .toEqual({ count: 0 });

    const workspaceIdentity = {
      googleSub: 'workspace-google-sub',
      email: 'staff@visaliacrc.com',
      name: 'Workspace staff',
      photoUrl: null,
      hostedDomain: 'visaliacrc.com',
    };
    const domainSession = await auth.loginWithGoogleProfile(workspaceIdentity);
    expect(domainSession.user.email).toBe(workspaceIdentity.email);

    const preprovisioned = users.create({
      name: 'Preprovisioned',
      email: 'preprovisioned@outside.example',
    });
    const preprovisionedSession = await auth.loginWithGoogleProfile({
      googleSub: 'preprovisioned-google-sub',
      email: preprovisioned.email,
      name: preprovisioned.name,
      photoUrl: null,
      hostedDomain: null,
    });
    expect(preprovisionedSession.user.id).toBe(preprovisioned.id);

    const invitedSession = await auth.loginWithGoogleProfile({
      googleSub: 'invited-google-sub',
      email: 'invited@example.com',
      name: 'Explicit invite',
      photoUrl: null,
      hostedDomain: null,
    });
    expect(invitedSession.user.email).toBe('invited@example.com');
  });
});
