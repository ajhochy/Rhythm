import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import { bridgePty } from '../services/pty_proxy';

let engine: WebSocketServer; let enginePort: number;
beforeAll(async () => {
  engine = new WebSocketServer({ port: 0 });
  engine.on('connection', (ws) => {
    ws.send(Buffer.from([0x00, ...Buffer.from('{"cursor":0}')]), { binary: true });
    ws.on('message', (d: Buffer, isBin: boolean) => { if (!isBin) ws.send('OUT:' + d.toString()); });
  });
  await new Promise<void>((r) => engine.on('listening', () => r()));
  enginePort = (engine.address() as AddressInfo).port;
});
afterAll(() => engine.close());

describe('bridgePty', () => {
  it('pipes client→engine (stdin), engine→client (stdout), swallows binary cursor frame', async () => {
    const clientHost = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => clientHost.on('listening', () => r()));
    const cport = (clientHost.address() as AddressInfo).port;
    const received: string[] = [];
    const clientConn = new WebSocket(`ws://127.0.0.1:${cport}`);
    clientConn.on('message', (d: Buffer, isBin: boolean) => { if (!isBin) received.push(d.toString()); });
    const serverSideClient: WebSocket = await new Promise((r) => clientHost.on('connection', (ws) => r(ws)));

    bridgePty(serverSideClient, `ws://127.0.0.1:${enginePort}/pty/pty_x/connect`);

    await new Promise((r) => setTimeout(r, 120));
    clientConn.send('hello\n');
    await new Promise((r) => setTimeout(r, 150));

    expect(received.join('')).toContain('OUT:hello\n');
    expect(received.join('')).not.toContain('cursor');
    clientConn.close(); clientHost.close();
  });

  it('closing the client tears down the engine socket', async () => {
    const clientHost = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => clientHost.on('listening', () => r()));
    const cport = (clientHost.address() as AddressInfo).port;
    const clientConn = new WebSocket(`ws://127.0.0.1:${cport}`);
    const serverSideClient: WebSocket = await new Promise((r) => clientHost.on('connection', (ws) => r(ws)));
    let engineClosed = false;
    engine.once('connection', (ws) => ws.on('close', () => { engineClosed = true; }));
    bridgePty(serverSideClient, `ws://127.0.0.1:${enginePort}/pty/pty_y/connect`);
    await new Promise((r) => setTimeout(r, 120));
    serverSideClient.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(engineClosed).toBe(true);
    clientConn.close(); clientHost.close();
  });
});
