/**
 * issue-1387-c23 acceptance contract — native Cloud Gateway Terminal PTY.
 *
 * This contract drives the production mobile URL builder, the real relay
 * HTTP/WebSocket surface, and the real Mac<->relay uplink. Only the local
 * Mac mobile-gateway PTY is faked; it is the true boundary outside the relay
 * transport under test.
 */
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';
import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { errorHandler } from '../middleware/error_handler';
import { createRelayGatewayRouter } from '../routes/relay_gateway_routes';
import { OpencodeEventHub } from '../services/opencode_event_hub';
import { RelayUplinkClient } from '../services/relay_uplink_client';
import { RelayUplinkServer } from '../services/relay_uplink_server';

const DIRECT_TSNET = 'https://rhythm-mac.tail1234.ts.net';
const DEVICE_TOKEN = 'issue-1387-c23-device-token';
const PROJECT_ID = 'issue-1387-c23-project';
const PTY_ID = 'pty_issue_1387_c23';
const MAC_BEARER = 'issue-1387-c23-mac-bearer';

async function listen(server: http.Server): Promise<http.Server> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

function portOf(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP listener address');
  }
  return (address as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function terminalRoundTrip(
  url: string,
  headers: Record<string, string>,
): Promise<{ connected: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    let settled = false;
    const settle = (result: {
      connected: boolean;
      output: string;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.terminate();
      } catch {
        // Already closed by the rejected relay upgrade.
      }
      resolve(result);
    };
    const timer = setTimeout(
      () => settle({ connected: false, output: '', error: 'timeout' }),
      5_000,
    );
    socket.once('open', () => socket.send('printf cloud-gateway-pty'));
    socket.once('message', (data) =>
      settle({ connected: true, output: String(data) }),
    );
    socket.once('unexpected-response', (_request, response) =>
      settle({
        connected: false,
        output: '',
        error: `HTTP ${response.statusCode}`,
      }),
    );
    socket.once('error', (error) =>
      settle({ connected: false, output: '', error: error.message }),
    );
    socket.once('close', (code, reason) =>
      settle({
        connected: false,
        output: '',
        error: `closed ${code}: ${String(reason)}`,
      }),
    );
  });
}

describe('issue #1387 native Cloud Gateway Terminal PTY contract', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
    vi.unstubAllEnvs();
  });

  it('issue-1387-c23: Terminal PTY uses the configured Cloud Gateway relay end to end', async () => {
    // Regression caught: PairedMacClient preferred directBaseUrl (.ts.net),
    // while the relay rejected its PTY path with pty_requires_direct_connection.
    // The relay-origin assertion and terminal-byte assertion both fail for
    // that exact broken implementation.
    vi.stubEnv('RHYTHM_ROLE', 'relay');

    const db = new Database(':memory:');
    cleanup.push(() => {
      db.close();
    });
    runMigrations(db);
    setDb(db);

    const deviceRow = {
      id: randomUUID(),
      host_id: randomUUID(),
      user_id: 23,
      name: 'c23 contract iPhone',
      token_verifier: createHash('sha256')
        .update(DEVICE_TOKEN)
        .digest('hex'),
      revoked_at: null,
      created_at: new Date().toISOString(),
    };

    let observedMacPath = '';
    let observedMacAuthorization = '';
    let observedMacProject = '';
    let resolveMacPtyClosed: (() => void) | null = null;
    const macPtyClosed = new Promise<void>((resolve) => {
      resolveMacPtyClosed = resolve;
    });
    const macHttp = http.createServer((_request, response) => {
      response.statusCode = 426;
      response.end('WebSocket upgrade required');
    });
    const macWss = new WebSocketServer({ noServer: true });
    cleanup.push(async () => {
      macWss.close();
      await close(macHttp);
    });
    macHttp.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://mac.local');
      if (
        url.pathname !==
        `/mobile-gateway/pty/${encodeURIComponent(PTY_ID)}/connect`
      ) {
        socket.destroy();
        return;
      }
      observedMacPath = `${url.pathname}${url.search}`;
      observedMacAuthorization = String(request.headers.authorization ?? '');
      observedMacProject = String(
        request.headers['x-rhythm-project-id'] ?? '',
      );
      macWss.handleUpgrade(request, socket, head, (ptySocket) => {
        ptySocket.once('close', () => resolveMacPtyClosed?.());
        ptySocket.once('message', () =>
          ptySocket.send('cloud-gateway-pty-output'),
        );
      });
    });
    const listeningMac = await listen(macHttp);
    const macBaseUrl = `http://127.0.0.1:${portOf(listeningMac)}`;

    const uplinkServer = new RelayUplinkServer({
      bearerValidator: async (token) =>
        token === MAC_BEARER ? { userId: 23 } : null,
    });
    cleanup.push(() => uplinkServer.stop());

    const relayApp = express();
    relayApp.use(express.json());
    relayApp.use(
      '/relay',
      createRelayGatewayRouter({ uplink: uplinkServer }),
    );
    relayApp.use(errorHandler);
    const relayHttp = http.createServer(relayApp);
    relayHttp.on('upgrade', (request, socket, head) => {
      if (!uplinkServer.handleUpgrade(request, socket, head)) socket.destroy();
    });
    cleanup.push(() => close(relayHttp));
    const listeningRelay = await listen(relayHttp);
    const relayHttpBase = `http://127.0.0.1:${portOf(listeningRelay)}/relay`;
    const relayWsBase = relayHttpBase.replace(/^http:/, 'ws:');

    const uplinkClient = new RelayUplinkClient({
      urls: [`${relayWsBase}/uplink`],
      bearer: MAC_BEARER,
      userId: 23,
      machineId: 'issue-1387-c23-mac',
      hub: new OpencodeEventHub(),
      healthProvider: async () => ({ status: 'ready' }),
      devicesProvider: async () => ({ devices: [deviceRow] }),
      dispatchBaseUrl: macBaseUrl,
      reconnectBaseMs: 25,
      reconnectMaxMs: 50,
    });
    cleanup.push(() => uplinkClient.stop());
    uplinkClient.start();

    expect(
      await waitFor(
        () => uplinkClient.isConnected() && uplinkServer.isMacOnline(),
      ),
      'Mac uplink never became ready',
    ).toBe(true);
    expect(
      await waitFor(async () => {
        const response = await fetch(
          `${relayHttpBase}/mobile-gateway/pty/${PTY_ID}/connect`,
          { headers: { Authorization: `Device ${DEVICE_TOKEN}` } },
        );
        return response.status !== 401;
      }),
      'replicated device never authenticated at the relay',
    ).toBe(true);

    // Keep the production mobile module outside api_server's TypeScript
    // rootDir while still loading its real runtime implementation in Vitest.
    const mobileClientModule = pathToFileURL(
      resolve(
        __dirname,
        '../../../mobile/lib/transport/paired-mac-client.ts',
      ),
    ).href;
    const { PairedMacClient } = await import(
      /* @vite-ignore */ mobileClientModule
    );
    const mobileClient = new PairedMacClient({
      baseUrl: relayHttpBase,
      directBaseUrl: DIRECT_TSNET,
      getDeviceToken: async () => DEVICE_TOKEN,
    });
    const connection = await mobileClient.ptyConnection(PTY_ID, PROJECT_ID, {
      ticket: 'ticket-c23',
      cursor: '7',
    });
    const expectedUrl =
      `${relayWsBase}/mobile-gateway/pty/${PTY_ID}/connect` +
      '?ticket=ticket-c23&cursor=7';

    expect.soft(connection.url).toBe(expectedUrl);
    expect.soft(connection.url).not.toContain('.ts.net');
    expect(connection.headers).toEqual({
      Authorization: `Device ${DEVICE_TOKEN}`,
      'X-Rhythm-Project-ID': PROJECT_ID,
    });

    // Use the required relay URL even when the current mobile URL assertion
    // is red, so this one run also proves the relay-side PTY gap.
    const roundTrip = await terminalRoundTrip(expectedUrl, connection.headers);
    expect(roundTrip).toEqual({
      connected: true,
      output: 'cloud-gateway-pty-output',
    });
    expect(observedMacPath).toBe(
      `/mobile-gateway/pty/${PTY_ID}/connect?ticket=ticket-c23&cursor=7`,
    );
    expect(observedMacAuthorization).toBe(`Device ${DEVICE_TOKEN}`);
    expect(observedMacProject).toBe(PROJECT_ID);
    await expect(
      Promise.race([
        macPtyClosed.then(() => 'closed'),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('timeout'), 2_000),
        ),
      ]),
    ).resolves.toBe('closed');
  }, 20_000);
});
