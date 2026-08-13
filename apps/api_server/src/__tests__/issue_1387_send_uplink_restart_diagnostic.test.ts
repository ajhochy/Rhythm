/**
 * Contract diagnostic for the physical issue-1387 c19 failure.
 *
 * This intentionally uses the real RelayUplinkClient and RelayUplinkServer.
 * Only the external Cloudflare hop (loopback HTTP/WebSocket listener) and the
 * local OpenCode gateway (loopback HTTP handler) are faked. It establishes
 * two facts used by the mobile c19 contract:
 *
 * 1. A prompt RPC accepted by the local gateway does not itself stop either
 *    real uplink implementation.
 * 2. Replacing the relay instance while that RPC response is in flight yields
 *    the exact physical health gap: macOnline=false and lastUplinkAt=null,
 *    followed by automatic Mac-client reconnection.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { OpencodeEventHub } from '../services/opencode_event_hub';
import { RelayUplinkClient } from '../services/relay_uplink_client';
import {
  MacOfflineError,
  RelayUplinkServer,
} from '../services/relay_uplink_server';

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(message);
}

describe('issue-1387 c19 uplink restart diagnostic', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('distinguishes a relay-instance restart from a prompt/RPC self-disconnect', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    cleanups.push(() => {
      db.close();
    });

    const createUplink = () =>
      new RelayUplinkServer({
        bearerValidator: async (token) =>
          token === 'contract-bearer' ? { userId: 1387 } : null,
      });
    let uplink = createUplink();

    const relayHttp = http.createServer((req, res) => {
      if (req.url === '/relay/health') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          macOnline: uplink.isMacOnline(),
          lastUplinkAt: uplink.getLastUplinkAt(),
        }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    relayHttp.on('upgrade', (request, socket, head) => {
      if (!uplink.handleUpgrade(request, socket, head)) socket.destroy();
    });
    relayHttp.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) =>
      relayHttp.once('listening', () => resolve()),
    );
    cleanups.push(
      () => new Promise<void>((resolve) => relayHttp.close(() => resolve())),
    );

    let acceptedPrompts = 0;
    let restartDuringNextPrompt = false;
    const gatewayHttp = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        if (req.url?.includes('/prompt_async')) {
          acceptedPrompts += 1;
          expect(JSON.parse(body)).toEqual({
            parts: [{ type: 'text', text: 'RELAY_FINAL' }],
          });
          if (restartDuringNextPrompt) {
            restartDuringNextPrompt = false;
            const previous = uplink;
            uplink = createUplink();
            previous.stop();
          }
          res.statusCode = 202;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ accepted: true }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    gatewayHttp.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) =>
      gatewayHttp.once('listening', () => resolve()),
    );
    cleanups.push(
      () => new Promise<void>((resolve) => gatewayHttp.close(() => resolve())),
    );

    const relayPort = (relayHttp.address() as AddressInfo).port;
    const gatewayPort = (gatewayHttp.address() as AddressInfo).port;
    const client = new RelayUplinkClient({
      urls: [`ws://127.0.0.1:${relayPort}/relay/uplink`],
      bearer: 'contract-bearer',
      userId: 1387,
      machineId: 'mac-contract',
      hub: new OpencodeEventHub(),
      healthProvider: async () => ({ status: 'ready' }),
      devicesProvider: async () => ({ devices: [] }),
      dispatchBaseUrl: `http://127.0.0.1:${gatewayPort}`,
      reconnectBaseMs: 20,
      reconnectMaxMs: 40,
    });
    cleanups.push(async () => {
      await client.stop();
      uplink.stop();
    });
    client.start();

    await waitFor(
      () => client.isConnected() && uplink.isMacOnline(),
      'real uplink client/server did not establish',
    );
    expect(uplink.getLastUplinkAt()).not.toBeNull();

    const stableResponse = await uplink.sendRpc({
      method: 'POST',
      path: '/mobile-gateway/opencode/session/ses_1/prompt_async',
      headers: { 'content-type': 'application/json' },
      bodyB64: Buffer.from(JSON.stringify({
        parts: [{ type: 'text', text: 'RELAY_FINAL' }],
      })).toString('base64'),
    });
    expect(stableResponse.status).toBe(202);
    expect(client.isConnected()).toBe(true);
    expect(uplink.isMacOnline()).toBe(true);

    restartDuringNextPrompt = true;
    const interruptedResponse = uplink
      .sendRpc({
        method: 'POST',
        path: '/mobile-gateway/opencode/session/ses_1/prompt_async',
        headers: { 'content-type': 'application/json' },
        bodyB64: Buffer.from(JSON.stringify({
          parts: [{ type: 'text', text: 'RELAY_FINAL' }],
        })).toString('base64'),
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    await waitFor(
      () => acceptedPrompts === 2,
      'local OpenCode boundary did not accept the interrupted prompt',
    );
    expect(await interruptedResponse).toBeInstanceOf(MacOfflineError);

    // Only a fresh relay instance (or a request routed to one) can reset the
    // stored timestamp to null. A plain WebSocket disconnect leaves the old
    // RelayUplinkServer.lastUplinkAt intact.
    expect(uplink.isMacOnline()).toBe(false);
    expect(uplink.getLastUplinkAt()).toBeNull();

    await waitFor(
      () => client.isConnected() && uplink.isMacOnline(),
      'Mac uplink did not reconnect to the replacement relay instance',
    );
    expect(uplink.getLastUplinkAt()).not.toBeNull();
  });
});
