/**
 * Defensive acceptance contract for the loopback agent surface.
 *
 * These tests drive the real Express app and real WebSocket upgrade path over
 * ephemeral loopback listeners. Only the PTY engine bridge, which is outside
 * the surface under test, is replaced with an inert boundary double.
 */

import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import Database from 'better-sqlite3';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

import { parseLocalRendererOrigins } from '../config/env';

const { ptyBridgeSpy } = vi.hoisted(() => ({
  ptyBridgeSpy: vi.fn((socket: WebSocket) => {
    socket.send(JSON.stringify({ v: 1, type: 'pty.ready' }));
  }),
}));

vi.mock('../services/pty_proxy', () => ({
  bridgePty: ptyBridgeSpy,
  ptyEngineUrl: (ptyId: string) => `ws://127.0.0.1/pty/${ptyId}`,
}));

interface HttpObservation {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface UpgradeObservation {
  socket: WebSocket;
  opened: boolean;
  frames: string[];
  rejectionStatus?: number;
}

interface Scenario {
  baseUrl: string;
  wsUrl: string;
  activeSockets: Set<WebSocket>;
  close(): Promise<void>;
}

interface ScenarioOptions {
  agentLocal: boolean;
  allowedOrigins?: string;
  localRendererOrigins?: string[];
  guard?: 'off';
}

async function startScenario(options: ScenarioOptions): Promise<Scenario> {
  vi.resetModules();
  const { env } = await import('../config/env');
  const previousEnv = {
    agentLocal: env.agentLocal,
    agentExecutionEnabled: env.agentExecutionEnabled,
    corsAllowedOrigins: env.corsAllowedOrigins,
    localRendererOrigins: env.localRendererOrigins,
    agentOriginGuardEnabled: env.agentOriginGuardEnabled,
  };
  env.agentLocal = options.agentLocal;
  env.agentExecutionEnabled = true;
  env.corsAllowedOrigins = options.allowedOrigins
    ? [options.allowedOrigins]
    : [];
  env.localRendererOrigins = options.localRendererOrigins ?? [];
  env.agentOriginGuardEnabled = options.guard !== 'off';

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const { createApp } = await import('../app');
  const { attachWsGateway } = await import('../services/ws_gateway');
  const server: Server = http.createServer(createApp());
  server.maxRequestsPerSocket = 1;
  const wss: WebSocketServer = attachWsGateway(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const activeSockets = new Set<WebSocket>();

  return {
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}`,
    activeSockets,
    async close() {
      for (const socket of activeSockets) {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.terminate();
        }
      }
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      db.close();
      env.agentLocal = previousEnv.agentLocal;
      env.agentExecutionEnabled = previousEnv.agentExecutionEnabled;
      env.corsAllowedOrigins = previousEnv.corsAllowedOrigins;
      env.localRendererOrigins = previousEnv.localRendererOrigins;
      env.agentOriginGuardEnabled = previousEnv.agentOriginGuardEnabled;
    },
  };
}

function get(
  scenario: Scenario,
  headers: Record<string, string> = {},
): Promise<HttpObservation> {
  const url = new URL('/health', scenario.baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        headers: {
          Connection: 'close',
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.once('error', reject);
    request.end();
  });
}

function expectConciseForbidden(response: HttpObservation): void {
  expect(response.status).toBe(403);
  expect(response.body).toMatch(/FORBIDDEN/i);
  expect(response.body.length).toBeLessThanOrEqual(256);
}

function observeUpgrade(
  scenario: Scenario,
  path: string,
  headers: Record<string, string> = {},
): Promise<UpgradeObservation> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${scenario.wsUrl}${path}`, { headers });
    scenario.activeSockets.add(socket);
    const frames: string[] = [];
    let opened = false;
    let rejectionStatus: number | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ socket, opened, frames, rejectionStatus });
    };
    const timer = setTimeout(finish, 300);

    socket.on('message', (frame) => {
      frames.push(String(frame));
      finish();
    });
    socket.once('open', () => {
      opened = true;
    });
    socket.once('unexpected-response', (_request, response) => {
      rejectionStatus = response.statusCode;
      response.resume();
      response.once('end', finish);
    });
    socket.once('error', finish);
    socket.once('close', finish);
  });
}

function frameTypes(frames: string[]): string[] {
  return frames.flatMap((frame) => {
    try {
      const parsed = JSON.parse(frame) as { type?: unknown };
      return typeof parsed.type === 'string' ? [parsed.type] : [];
    } catch {
      return [];
    }
  });
}

describe.sequential('local agent surface defensive contract', () => {
  describe('local renderer origin parser', () => {
    it('slice-2-c13: accepts, trims, and deduplicates only exact renderer origins', () => {
      // Regression caught: startup accepts aliases or returns duplicate policy entries.
      expect(parseLocalRendererOrigins).toBeTypeOf('function');
      if (typeof parseLocalRendererOrigins !== 'function') return;
      expect(
        parseLocalRendererOrigins(
          ' http://127.0.0.1:4175, rhythm://app,http://127.0.0.1:4175 ',
        ),
      ).toEqual(['http://127.0.0.1:4175', 'rhythm://app']);
      expect(parseLocalRendererOrigins(undefined)).toEqual([]);
      expect(parseLocalRendererOrigins('')).toEqual([]);
    });

    it.each([
      '*',
      'null',
      'file:///tmp/index.html',
      'https://127.0.0.1:4175',
      'http://localhost:4175',
      'http://0.0.0.0:4175',
      'http://127.0.0.2:4175',
      'http://user@127.0.0.1:4175',
      'http://127.0.0.1',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
      'http://127.0.0.1:4175/path',
      'http://127.0.0.1:4175?query=1',
      'http://127.0.0.1:4175#fragment',
      'http://127.0.0.1:4175.evil.invalid',
      'prefixhttp://127.0.0.1:4175',
      'rhythm://app.evil',
      'rhythm://app/path',
      'not an origin',
    ])('slice-2-c14: rejects unsafe renderer origin %s at startup', (value) => {
      // Regression caught: malformed or lookalike origins enter the privileged allowlist.
      expect(parseLocalRendererOrigins).toBeTypeOf('function');
      if (typeof parseLocalRendererOrigins !== 'function') return;
      expect(() => parseLocalRendererOrigins(value)).toThrow(
        /RHYTHM_LOCAL_RENDERER_ORIGINS/,
      );
    });
  });

  describe('empty hosted allowlist', () => {
    let scenario: Scenario;

    beforeAll(async () => {
      scenario = await startScenario({ agentLocal: false });
    });

    afterAll(async () => {
      await scenario.close();
    });

    it('issue-999999-c1: an empty CORS allowlist withholds authorization from Origin-bearing requests', async () => {
      // Regression caught: an empty configured list echoes an unconfigured Origin.
      const response = await get(scenario, {
        Origin: 'https://unapproved.invalid',
      });

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers.vary ?? '').not.toMatch(/Origin/i);
    });
  });

  describe('agent-local default guard', () => {
    let scenario: Scenario;

    beforeAll(async () => {
      scenario = await startScenario({ agentLocal: true });
    });

    beforeEach(() => {
      ptyBridgeSpy.mockClear();
    });

    afterAll(async () => {
      await scenario.close();
    });

    it('issue-999999-c2: the Flutter-style HTTP path succeeds without browser provenance headers', async () => {
      // Regression caught: the local guard blocks the shipping headerless client.
      const response = await get(scenario);

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ status: 'ok' });
    });

    it('issue-999999-c3: agent-local HTTP rejects every Origin-bearing request', async () => {
      // Regression caught: the agent-local surface still accepts an Origin.
      const response = await get(scenario, {
        Origin: 'https://external.invalid',
      });

      expectConciseForbidden(response);
      expect(response.body).not.toContain('external.invalid');
    });

    it('issue-999999-c4: agent-local HTTP rejects disallowed Sec-Fetch-Site values', async () => {
      // Regression caught: browser site provenance bypasses the local guard.
      const response = await get(scenario, {
        'Sec-Fetch-Site': 'cross-site',
      });

      expectConciseForbidden(response);
    });

    it('issue-999999-c5: agent-local HTTP preserves the allowed Sec-Fetch-Site values', async () => {
      // Regression caught: the defensive allowlist blocks safe local client modes.
      const none = await get(scenario, { 'Sec-Fetch-Site': 'none' });
      const sameOrigin = await get(scenario, {
        'Sec-Fetch-Site': 'same-origin',
      });

      expect(none.status).toBe(200);
      expect(sameOrigin.status).toBe(200);
    });

    it('issue-999999-c6: agent-local HTTP rejects a Host outside the loopback allowlist', async () => {
      // Regression caught: Host validation is omitted from the local surface.
      const response = await get(scenario, { Host: 'unapproved.invalid' });

      expectConciseForbidden(response);
      expect(response.body).not.toContain('unapproved.invalid');
    });

    it('issue-999999-c7: agent-local HTTP accepts both approved loopback Host forms', async () => {
      // Regression caught: host hardening breaks one supported local hostname.
      const port = new URL(scenario.baseUrl).port;
      const ipv4 = await get(scenario, { Host: `127.0.0.1:${port}` });
      const localhost = await get(scenario, { Host: `localhost:${port}` });

      expect(ipv4.status).toBe(200);
      expect(localhost.status).toBe(200);
    });

    it('issue-999999-c8: /ws/agents rejects an Origin before accepting or emitting a session snapshot', async () => {
      // Regression caught: the upgrade succeeds and emits data before rejection.
      const observed = await observeUpgrade(scenario, '/ws/agents', {
        Origin: 'https://external.invalid',
      });

      expect(observed.opened).toBe(false);
      expect(observed.rejectionStatus).toBe(403);
      expect(frameTypes(observed.frames)).not.toContain('sessions.list');
    });

    it('issue-999999-c9: /ws/agents accepts the Flutter-style headerless upgrade', async () => {
      // Regression caught: WebSocket hardening blocks the shipping local client.
      const observed = await observeUpgrade(scenario, '/ws/agents');

      expect(observed.opened).toBe(true);
      expect(frameTypes(observed.frames)).toContain('sessions.list');
    });

    it('issue-999999-c10: the PTY WebSocket rejects an Origin before bridging', async () => {
      // Regression caught: PTY reaches its engine bridge before provenance checks.
      const observed = await observeUpgrade(scenario, '/ws/pty/contract', {
        Origin: 'https://external.invalid',
      });

      expect(observed.opened).toBe(false);
      expect(observed.rejectionStatus).toBe(403);
      expect(ptyBridgeSpy).not.toHaveBeenCalled();
    });

    it('issue-999999-c11: the PTY WebSocket accepts the Flutter-style headerless upgrade', async () => {
      // Regression caught: PTY hardening blocks the shipping local client.
      const observed = await observeUpgrade(scenario, '/ws/pty/contract');

      expect(observed.opened).toBe(true);
      expect(ptyBridgeSpy).toHaveBeenCalledTimes(1);
    });

    it('issue-999999-c16: /ws/agents rejects disallowed Sec-Fetch-Site before acceptance', async () => {
      // Regression caught: the agent upgrade omits fetch-site enforcement.
      const observed = await observeUpgrade(scenario, '/ws/agents', {
        'Sec-Fetch-Site': 'cross-site',
      });

      expect(observed.opened).toBe(false);
      expect(observed.rejectionStatus).toBe(403);
      expect(frameTypes(observed.frames)).not.toContain('sessions.list');
    });

    it('issue-999999-c17: /ws/agents rejects a Host outside the loopback allowlist before acceptance', async () => {
      // Regression caught: the agent upgrade omits Host enforcement.
      const observed = await observeUpgrade(scenario, '/ws/agents', {
        Host: 'unapproved.invalid',
      });

      expect(observed.opened).toBe(false);
      expect(observed.rejectionStatus).toBe(403);
      expect(frameTypes(observed.frames)).not.toContain('sessions.list');
    });

    it('issue-999999-c18: the PTY WebSocket rejects disallowed Sec-Fetch-Site before bridging', async () => {
      // Regression caught: PTY reaches its engine bridge without fetch-site enforcement.
      const observed = await observeUpgrade(scenario, '/ws/pty/contract', {
        'Sec-Fetch-Site': 'cross-site',
      });

      expect(observed.opened).toBe(false);
      expect(observed.rejectionStatus).toBe(403);
      expect(ptyBridgeSpy).not.toHaveBeenCalled();
    });

    it('issue-999999-c19: the PTY WebSocket rejects a Host outside the loopback allowlist before bridging', async () => {
      // Regression caught: PTY reaches its engine bridge without Host enforcement.
      const observed = await observeUpgrade(scenario, '/ws/pty/contract', {
        Host: 'unapproved.invalid',
      });

      expect(observed.opened).toBe(false);
      expect(observed.rejectionStatus).toBe(403);
      expect(ptyBridgeSpy).not.toHaveBeenCalled();
    });
  });

  describe('agent-local configured renderer origin', () => {
    let scenario: Scenario;
    const rendererOrigin = 'http://127.0.0.1:4175';

    beforeAll(async () => {
      scenario = await startScenario({
        agentLocal: true,
        localRendererOrigins: [rendererOrigin],
      });
    });

    beforeEach(() => {
      ptyBridgeSpy.mockClear();
    });

    afterAll(async () => {
      await scenario.close();
    });

    it('slice-2-c15: exact renderer origin receives HTTP 200 and exact ACAO across ports', async () => {
      // Regression caught: the configured renderer remains blocked by Origin or same-site provenance.
      const response = await get(scenario, {
        Origin: rendererOrigin,
        'Sec-Fetch-Site': 'same-site',
      });

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(
        rendererOrigin,
      );
    });

    it('slice-2-c16: exact renderer origin opens agent and PTY WebSockets', async () => {
      // Regression caught: HTTP uses the allowlist but either upgrade path does not.
      const agents = await observeUpgrade(scenario, '/ws/agents', {
        Origin: rendererOrigin,
        'Sec-Fetch-Site': 'cross-site',
      });
      const pty = await observeUpgrade(scenario, '/ws/pty/contract', {
        Origin: rendererOrigin,
        'Sec-Fetch-Site': 'same-site',
      });

      expect(agents.opened).toBe(true);
      expect(frameTypes(agents.frames)).toContain('sessions.list');
      expect(pty.opened).toBe(true);
      expect(ptyBridgeSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      'http://127.0.0.1:4176',
      'http://localhost:4175',
      'http://127.0.0.1:4175.evil.invalid',
      'null',
      '*',
      'https://external.invalid',
    ])('slice-2-c17: rejects similar or arbitrary Origin %s without ACAO', async (origin) => {
      // Regression caught: CORS or the guard reflects a lookalike/unconfigured origin.
      const response = await get(scenario, { Origin: origin });

      expectConciseForbidden(response);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.body).not.toContain(origin);
    });

    it('slice-2-c18: approved Origin still requires a loopback destination Host', async () => {
      // Regression caught: renderer authorization bypasses destination Host validation.
      const response = await get(scenario, {
        Host: 'unapproved.invalid',
        Origin: rendererOrigin,
      });

      expectConciseForbidden(response);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('guard kill-switch', () => {
    let scenario: Scenario;

    beforeAll(async () => {
      scenario = await startScenario({
        agentLocal: true,
        guard: 'off',
      });
    });

    beforeEach(() => {
      ptyBridgeSpy.mockClear();
    });

    afterAll(async () => {
      await scenario.close();
    });

    it('issue-999999-c12: the kill-switch restores prior HTTP compatibility', async () => {
      // Regression caught: the documented emergency switch does not disable HTTP guards.
      const origin = 'https://compatibility.invalid';
      const response = await get(scenario, {
        Host: 'compatibility.invalid',
        Origin: origin,
        'Sec-Fetch-Site': 'cross-site',
      });

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    });

    it('issue-999999-c13: the kill-switch restores prior /ws/agents compatibility', async () => {
      // Regression caught: the switch disables HTTP checks but not agent upgrades.
      const observed = await observeUpgrade(scenario, '/ws/agents', {
        Host: 'compatibility.invalid',
        Origin: 'https://compatibility.invalid',
      });

      expect(observed.opened).toBe(true);
      expect(frameTypes(observed.frames)).toContain('sessions.list');
    });

    it('issue-999999-c14: the kill-switch restores prior PTY WebSocket compatibility', async () => {
      // Regression caught: the switch disables agent upgrades but not PTY upgrades.
      const observed = await observeUpgrade(scenario, '/ws/pty/contract', {
        Host: 'compatibility.invalid',
        Origin: 'https://compatibility.invalid',
      });

      expect(observed.opened).toBe(true);
      expect(ptyBridgeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('hosted configured-origin regression', () => {
    let scenario: Scenario;
    const configuredOrigin = 'https://configured.invalid';

    beforeAll(async () => {
      scenario = await startScenario({
        agentLocal: false,
        allowedOrigins: configuredOrigin,
      });
    });

    afterAll(async () => {
      await scenario.close();
    });

    it('issue-999999-c15: hosted mode preserves configured CORS origins', async () => {
      // Regression caught: local-only hardening overrides hosted CORS configuration.
      const response = await get(scenario, { Origin: configuredOrigin });

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(
        configuredOrigin,
      );
    });
  });
});
