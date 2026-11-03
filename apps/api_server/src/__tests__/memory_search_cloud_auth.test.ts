import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { errorHandler } from '../middleware/error_handler';
import { createAgentMemoryRouter } from '../routes/agentMemoryRoutes';
import { ManagedMemorySearchService } from '../services/managed_workstream_evidence_capture';

const identity = vi.hoisted(() => ({
  local: vi.fn(), cloud: vi.fn(),
}));
vi.mock('../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env')>();
  return { ...actual, env: { ...actual.env, agentLocal: true } };
});
vi.mock('../services/auth_service', () => ({
  AuthService: class { getUserForSessionToken = identity.local; },
}));
vi.mock('../services/mobile_cloud_identity_service', () => ({
  MobileCloudIdentityService: class { authenticateBearerToken = identity.cloud; },
}));

// Reuse the existing local_agent_cloud_token_auth contract's in-process HTTP
// pattern. This starts no API server, engine, socket listener, or scheduler.
async function request(app: express.Express, route: string, token?: string, body: unknown = {}) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  }) as unknown as Socket;
  const req = new IncomingMessage(socket);
  req.method = 'POST';
  req.url = route;
  const payload = JSON.stringify(body);
  req.headers = {
    'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)),
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  };
  req.push(payload);
  req.push(null);
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let settled = false;
    let bodyText = '';
    res.once('error', reject);
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve({ status: res.statusCode, body: bodyText ? JSON.parse(bodyText) : null });
    };
    res.once('finish', settle);
    const end = res.end.bind(res);
    res.end = ((...args: Parameters<ServerResponse['end']>) => {
      if (typeof args[0] === 'string' || Buffer.isBuffer(args[0])) bodyText += args[0].toString();
      const result = end(...args);
      queueMicrotask(settle);
      return result;
    }) as ServerResponse['end'];
    app(req, res);
  });
}

const owner = { id: 41, email: 'owner@example.test' } as AuthContext['user'];

function appWith(service?: ManagedMemorySearchService) {
  const app = express();
  app.use(express.json());
  app.use('/memory', createAgentMemoryRouter({ managedMemorySearch: service }));
  app.use(errorHandler);
  return app;
}

describe('memory search route bearer authentication', () => {
  beforeEach(() => {
    identity.local.mockReset().mockImplementation(async (token: string) => token === 'local-owner' ? owner : null);
    identity.cloud.mockReset().mockImplementation(async (token: string) => token.startsWith('cloud-owner-') ? owner : null);
  });

  for (const route of ['search-select', 'search-managed']) {
    for (const provider of ['local', 'cloud']) {
      it(`${route} accepts ${provider} identity before signed-call admission`, async () => {
        const admitted = vi.fn(async (auth: AuthContext) => {
          expect(auth.user.id).toBe(owner.id);
          return { schemaVersion: 1, mode: 'ordinary' };
        });
        const service = { select: admitted, search: admitted } as unknown as ManagedMemorySearchService;
        const token = provider === 'local' ? 'local-owner' : `cloud-owner-${route}`;
        const response = await request(appWith(service), `/memory/${route}`, token);
        expect(response.status).toBe(200);
        expect(admitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user: owner, sessionToken: token }), {});
      });
    }

    for (const token of [undefined, 'invalid-token']) {
      it(`${route} refuses ${token === undefined ? 'missing' : 'invalid'} bearer before admission`, async () => {
        const admitted = vi.fn();
        const service = { select: admitted, search: admitted } as unknown as ManagedMemorySearchService;
        expect((await request(appWith(service), `/memory/${route}`, token)).status).toBe(401);
        expect(admitted).not.toHaveBeenCalled();
      });
    }

    it(`${route} keeps real signed-call validation after Cloud authentication`, async () => {
      const verify = vi.fn(async () => { throw new Error('invalid signature'); });
      const unreachable = vi.fn(() => { throw new Error('must not reach evidence storage'); });
      const service = new ManagedMemorySearchService({
        db: { prepare: unreachable } as never,
        records: { read: unreachable, append: unreachable, markUnsafe: unreachable },
        engine: { getManagedActiveToolCall: unreachable },
        policy: { enabled: () => true, dbClient: 'sqlite', role: 'local', currentHostEpoch: () => 'epoch', rhythmMcpServerName: 'rhythm' },
        verify,
      });
      const response = await request(appWith(service), `/memory/${route}`, `cloud-owner-proof-${route}`, { trustedCall: { forged: true } });
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Managed memory search refused' } });
      expect(verify).toHaveBeenCalledOnce();
      expect(unreachable).not.toHaveBeenCalled();
    });
  }

  it('keeps the managed route hidden when no managed service is composed', async () => {
    expect((await request(appWith(), '/memory/search-managed', 'cloud-owner-disabled')).status).toBe(404);
    expect(identity.local).not.toHaveBeenCalled();
    expect(identity.cloud).not.toHaveBeenCalled();
  });

  it('allows authenticated ordinary selection when the coordinator is disabled', async () => {
    const response = await request(appWith(), '/memory/search-select', 'cloud-owner-ordinary');
    expect(response).toEqual({ status: 200, body: { schemaVersion: 1, mode: 'ordinary' } });
  });

  it('preserves locally issued bearer requirements outside local-desktop mode', async () => {
    env.agentLocal = false;
    try {
      const response = await request(appWith(), '/memory/search-select', 'cloud-owner-hosted');
      expect(response.status).toBe(401);
      expect(identity.cloud).not.toHaveBeenCalled();
    } finally {
      env.agentLocal = true;
    }
  });
});
