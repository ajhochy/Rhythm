import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = live ? describe : describe.skip;
const api = process.env.RHYTHM_LIVE_URL ?? '';
const engine = process.env.RHYTHM_LIVE_ENGINE_URL ?? '';
const relay = process.env.RHYTHM_LIVE_RELAY_URL ?? '';
const sandbox = process.env.RHYTHM_SANDBOX_DIR ?? '';
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const deviceToken = process.env.RHYTHM_LIVE_DEVICE_TOKEN ?? '';

function headers(projectId: string, token = deviceToken): Record<string, string> {
  return {
    Authorization: `Device ${token}`,
    'X-Rhythm-Project-ID': projectId,
  };
}

async function connect(
  ptyId: string,
  projectId: string,
  ticket: string,
  token = deviceToken,
): Promise<WebSocket> {
  const url = new URL(`/relay/mobile-gateway/pty/${encodeURIComponent(ptyId)}/connect`, relay);
  url.protocol = 'ws:';
  url.searchParams.set('ticket', ticket);
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url, { headers: headers(projectId, token) });
    const timer = setTimeout(() => {
      socket.terminate();
      rejectSocket(new Error('relay PTY upgrade timed out'));
    }, 10_000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolveSocket(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      rejectSocket(error);
    });
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolveCode, rejectCode) => {
    const timer = setTimeout(() => {
      socket.terminate();
      rejectCode(new Error('relay PTY close timed out'));
    }, 10_000);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolveCode(code);
    });
  });
}

async function ticket(ptyId: string, projectId: string): Promise<string> {
  const response = await fetch(
    `${relay}/relay/mobile-gateway/opencode/pty/${encodeURIComponent(ptyId)}/connect-token`,
    { method: 'POST', headers: headers(projectId) },
  );
  expect(response.status).toBe(200);
  const body = await response.json() as { ticket: string };
  expect(body.ticket.length).toBeGreaterThan(16);
  return body.ticket;
}

describeLive('live E2E — issue #1373 relay PTY', () => {
  it('relays real engine PTY output and denies another project and user', async () => {
    expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
    expect(api).toBe('http://127.0.0.1:4198');
    expect(engine).toBe('http://127.0.0.1:4197');
    expect(relay).toBe('http://127.0.0.1:4200');
    expect(resolve(dbPath)).toBe(resolve(sandbox, 'rhythm.db'));
    expect(deviceToken.length).toBeGreaterThanOrEqual(32);

    const health = await fetch(`${relay}/relay/mobile-gateway/health`);
    expect(health.status).toBe(200);
    expect((await health.json() as { macOnline: boolean }).macOnline).toBe(true);

    const runId = randomUUID();
    const marker = `MEGA-SMOKE-2026-09-18-${runId}`;
    const projectId = randomUUID();
    const projectRoot = join(sandbox, marker);
    mkdirSync(projectRoot, { recursive: true });
    const macDb = new Database(dbPath);
    const relayDb = new Database(join(sandbox, 'relay', 'rhythm.db'));
    let ptyId: string | null = null;
    let phone: WebSocket | null = null;
    let wrongProjectPhone: WebSocket | null = null;
    let secondUserDeviceId: string | null = null;
    try {
      macDb.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(projectId, marker, projectRoot, new Date().toISOString());

      const create = await fetch(`${relay}/relay/mobile-gateway/opencode/pty`, {
        method: 'POST',
        headers: { ...headers(projectId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'cat' }),
      });
      expect(create.status).toBe(200);
      ptyId = (await create.json() as { id: string }).id;
      const validTicket = await ticket(ptyId, projectId);
      phone = await connect(ptyId, projectId, validTicket);

      const output = new Promise<string>((resolveOutput, rejectOutput) => {
        const timeout = setTimeout(() => rejectOutput(new Error('relay PTY echo timed out')), 10_000);
        phone!.on('message', (data) => {
          const value = data.toString();
          if (value.includes(marker)) {
            clearTimeout(timeout);
            resolveOutput(value);
          }
        });
      });
      phone.send(`${marker}\n`);
      expect(await output).toContain(marker);
      phone.close(1000);
      await closed(phone);
      phone = null;

      // A valid ticket is still scoped to the project that issued it.
      wrongProjectPhone = await connect(ptyId, randomUUID(), await ticket(ptyId, projectId));
      const deniedProject = await closed(wrongProjectPhone);
      expect(deniedProject).toBe(4403);
      wrongProjectPhone = null;

      // Relay checks the active uplink user before forwarding a second user's
      // otherwise valid device credential or any terminal bytes to the Mac.
      const secondToken = randomBytes(32).toString('base64url');
      secondUserDeviceId = randomUUID();
      const hostId = (macDb.prepare(
        'SELECT host_id AS hostId FROM mobile_devices LIMIT 1',
      ).get() as { hostId: string }).hostId;
      relayDb.prepare(
        `INSERT INTO mobile_devices
           (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
         VALUES (?, ?, 2, ?, ?, NULL, ?)`,
      ).run(
        secondUserDeviceId,
        hostId,
        marker,
        createHash('sha256').update(secondToken).digest('hex'),
        new Date().toISOString(),
      );
      const secondUrl = new URL(
        `/relay/mobile-gateway/pty/${encodeURIComponent(ptyId)}/connect`, relay,
      );
      secondUrl.protocol = 'ws:';
      secondUrl.searchParams.set('ticket', await ticket(ptyId, projectId));
      const deniedUser = await new Promise<number>((resolveStatus, rejectStatus) => {
        const socket = new WebSocket(secondUrl, { headers: headers(projectId, secondToken) });
        const timeout = setTimeout(() => {
          socket.terminate();
          rejectStatus(new Error('second-user denial timed out'));
        }, 10_000);
        socket.once('unexpected-response', (_request, response) => {
          clearTimeout(timeout);
          response.resume();
          resolveStatus(response.statusCode ?? 0);
        });
        socket.once('open', () => {
          clearTimeout(timeout);
          socket.close();
          rejectStatus(new Error('second user reached PTY'));
        });
        socket.once('error', () => undefined);
      });
      expect(deniedUser).toBe(503);

      phone = await connect(ptyId, projectId, await ticket(ptyId, projectId));
      const revokedClose = closed(phone);
      const pairedDeviceId = (relayDb.prepare(
        'SELECT id FROM mobile_devices WHERE user_id = 1 LIMIT 1',
      ).get() as { id: string }).id;
      relayDb.prepare('UPDATE mobile_devices SET revoked_at = ? WHERE id = ?')
        .run(new Date().toISOString(), pairedDeviceId);
      expect(await revokedClose).toBe(4401);
      phone = null;
    } finally {
      phone?.terminate();
      wrongProjectPhone?.terminate();
      if (ptyId) {
        const url = new URL(`/pty/${encodeURIComponent(ptyId)}`, engine);
        url.searchParams.set('directory', projectRoot);
        await fetch(url, { method: 'DELETE' }).catch(() => undefined);
      }
      if (secondUserDeviceId) relayDb.prepare('DELETE FROM mobile_devices WHERE id = ?').run(secondUserDeviceId);
      relayDb.close();
      macDb.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      macDb.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
