import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireApi = createRequire(new URL('../../api_server/package.json', import.meta.url));
const { WebSocket } = requireApi('ws') as typeof import('ws');

test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'E27 requires the existing synthetic sandbox; starts no servers');

test('E27-c7 live: nonce/cwd/resize/interrupt use the real synthetic PTY', async ({ request }) => {
  // Regression: echoed commands can look successful even when no command executes.
  // Nonce formatting and exact subsequent output require a real shell, not command echo.
  const api = 'http://127.0.0.1:4098';
  const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR!);
  expect(sandbox.startsWith('/private/tmp/rhythm-electron-')).toBe(true);
  const token = process.env.E27_AUTH_TOKEN;
  expect(token, 'explicit synthetic fixture token required').toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };
  const health = await request.get(`${api}/opencode/health`, { headers });
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ready' });
  const nonce = randomUUID();
  let sessionId = '';
  let ptyId = '';
  let anonymousPtyId = '';
  const sockets: InstanceType<typeof WebSocket>[] = [];
  try {
    const created = await request.post(`${api}/agent-sessions`, {
      headers, data: { agentId: null, name: `E27-${nonce}`, cwd: sandbox, projectId: null },
    });
    expect(created.status()).toBe(201);
    const session = await created.json();
    sessionId = session.id;
    expect(sessionId).toBeTruthy();
    expect(session.cwd).toBe(sandbox);
    const pty = await request.post(`${api}/agent-sessions/${encodeURIComponent(sessionId)}/pty`, { headers, data: {} });
    expect(pty.status()).toBe(200);
    ptyId = (await pty.json()).ptyId;
    expect(ptyId).toBeTruthy();

    const connect = async (id: string, bearer?: string, rawHeader = false) => {
      const socket = new WebSocket(`ws://127.0.0.1:4098/ws/pty/${encodeURIComponent(id)}`, {
        ...(bearer !== undefined ? { headers: { Authorization: rawHeader ? bearer : `Bearer ${bearer}` } } : {}), handshakeTimeout: 5_000,
      });
      sockets.push(socket);
      let output = '';
      socket.on('message', (data) => { output += data.toString(); });
      const accepted = await new Promise<boolean>((resolve) => {
        socket.once('open', () => resolve(true));
        socket.once('error', () => resolve(false));
        socket.once('unexpected-response', (_req, response) => { response.resume(); socket.terminate(); resolve(false); });
      });
      return { socket, accepted, output: () => output };
    };

    const invalid = await connect(ptyId, `invalid-${nonce}`);
    expect(invalid.accepted).toBe(false);
    const whitespace = await connect(ptyId, '   ', true);
    expect(whitespace.accepted).toBe(false);
    console.log('E27 invalid supplied bearer rejected before PTY bridge');

    const owner = await connect(ptyId, token!);
    expect(owner.accepted).toBe(true);
    // The proxy's frontend upgrade precedes the engine connection; wait for shell output.
    await expect.poll(owner.output, { timeout: 10_000 }).not.toBe('');
    owner.socket.send(`printf '\\nE27_OWNER_%s\\n' '${nonce}'; pwd\r`);
    await expect.poll(owner.output).toContain(`E27_OWNER_${nonce}\r\n${sandbox}`);
    console.log('E27 authorized PTY: nonce executed and cwd matched selected local session');

    const resize = await request.patch(`${api}/pty/${encodeURIComponent(ptyId)}`, { headers, data: { cols: 91, rows: 29 } });
    expect(resize.status()).toBe(200);
    owner.socket.send(`printf '\\nE27_SIZE_%s\\n' '${nonce}'; stty size\r`);
    await expect.poll(owner.output).toContain(`E27_SIZE_${nonce}\r\n29 91\r\n`);
    owner.socket.send(`printf '\\nE27_WAIT_%s\\n' '${nonce}'; sleep 30\r`);
    await expect.poll(owner.output).toContain(`E27_WAIT_${nonce}\r\n`);
    owner.socket.send('\u0003');
    owner.socket.send(`printf '\\nE27_REUSED_%s\\n' '${nonce}'\r`);
    await expect.poll(owner.output, { timeout: 5000 }).toContain(`E27_REUSED_${nonce}\r\n`);
    console.log('E27 real PTY: 29x91 stty size; Ctrl-C interrupted sleep30; same shell executed reuse nonce within5s');

    const anonymousPty = await request.post(`${api}/agent-sessions/${encodeURIComponent(sessionId)}/pty`, { data: {} });
    expect(anonymousPty.status()).toBe(200);
    anonymousPtyId = (await anonymousPty.json()).ptyId;
    const anonymous = await connect(anonymousPtyId);
    expect(anonymous.accepted).toBe(true);
    await expect.poll(anonymous.output, { timeout: 10_000 }).not.toBe('');
    console.log('E27 absent bearer retained local desktop PTY compatibility');
  } finally {
    for (const socket of sockets) socket.terminate();
    if (ptyId) {
      const removed = await request.delete(`${api}/pty/${encodeURIComponent(ptyId)}`, { headers });
      expect([204, 404]).toContain(removed.status());
      console.log(`E27 cleanup: PTY DELETE ${removed.status()}`);
    }
    if (anonymousPtyId) await request.delete(`${api}/pty/${encodeURIComponent(anonymousPtyId)}`);
    if (sessionId) {
      const removed = await request.delete(`${api}/agent-sessions/${encodeURIComponent(sessionId)}`, { headers });
      expect([200, 204]).toContain(removed.status());
      console.log(`E27 cleanup: session DELETE ${removed.status()}`);
    }
  }
});
