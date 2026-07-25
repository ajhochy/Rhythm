import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';

function gatewayHeaders(
  deviceToken: string,
  projectId: string,
  contentType = false,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

function readSseEvent(
  response: Response,
  eventType: string,
  onConnected?: () => void,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return new Promise((resolveEvent, rejectEvent) => {
    const timer = setTimeout(() => {
      void reader.cancel();
      rejectEvent(new Error(`Timed out waiting for SSE ${eventType}`));
    }, timeoutMs);
    const pump = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) throw new Error('SSE ended before expected event');
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (!data) continue;
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const payload = (
              parsed.payload &&
              typeof parsed.payload === 'object'
            )
              ? parsed.payload as Record<string, unknown>
              : parsed;
            if (payload.type === 'server.connected') onConnected?.();
            if (payload.type === eventType) {
              clearTimeout(timer);
              await reader.cancel();
              resolveEvent(parsed);
              return;
            }
          }
        }
      } catch (error) {
        clearTimeout(timer);
        rejectEvent(error);
      }
    };
    void pump();
  });
}

function websocketUpgradeStatus(
  url: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      ws.terminate();
      rejectStatus(new Error('PTY WebSocket rejection timeout'));
    }, 10_000);
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolveStatus(response.statusCode ?? 0);
    });
    ws.once('open', () => {
      clearTimeout(timer);
      ws.close();
      rejectStatus(new Error('Revoked device unexpectedly upgraded'));
    });
    ws.once('error', () => undefined);
  });
}

function openPty(
  url: string,
  headers: Record<string, string>,
): Promise<WebSocket> {
  return new Promise((resolveSocket, rejectSocket) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      ws.terminate();
      rejectSocket(new Error('PTY WebSocket open timeout'));
    }, 10_000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolveSocket(ws);
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      rejectSocket(error);
    });
  });
}

describeLive('live E2E — issue #1170 mobile realtime proxy', () => {
  it('issue-1170-c5: live harness refuses installed-app ports and requires sandbox attestation', () => {
    const api = new URL(baseUrl);
    const engine = new URL(engineUrl);
    expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
    expect(api.hostname).toBe('127.0.0.1');
    expect(engine.hostname).toBe('127.0.0.1');
    expect(api.port).not.toBe('4001');
    expect(engine.port).not.toBe('4096');
    expect(api.port).not.toBe(engine.port);
    expect(resolve(dbPath)).toBe(resolve(sandboxDir, 'rhythm.db'));
    expect(dbPath).not.toContain('/Library/Application Support/Rhythm/');
  });

  it('issue-1170-c4: live sandbox emits real global and session-scoped SSE and propagates PTY data and closure', async () => {
    const db = new Database(dbPath);
    const runId = randomUUID();
    const userToken = randomUUID();
    const projectId = randomUUID();
    const boundary = join(sandboxDir, `issue-1170-${runId}`);
    const projectRoot = join(boundary, 'project');
    mkdirSync(projectRoot, { recursive: true });

    let userId: number | null = null;
    let deviceId: string | null = null;
    let deviceToken: string | null = null;
    let sessionId: string | null = null;
    let ptyId: string | null = null;
    let ptySocket: WebSocket | null = null;
    let sessionSseAbort: AbortController | null = null;
    try {
      userId = Number(db.prepare(
        `INSERT INTO users (name, email, google_sub)
         VALUES (?, ?, ?)`,
      ).run(
        'Issue 1170 User',
        `issue-1170-${runId}@example.com`,
        `issue-1170-${runId}`,
      ).lastInsertRowid);
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(
        userToken,
        userId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );
      db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(
        projectId,
        'Issue 1170 Live',
        projectRoot,
        new Date().toISOString(),
      );

      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as { pairingCode: string };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          deviceName: 'Issue 1170 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;

      const sseAbort = new AbortController();
      const sseResponse = await fetch(
        `${baseUrl}/mobile-gateway/events`,
        {
          headers: gatewayHeaders(deviceToken, projectId),
          signal: sseAbort.signal,
        },
      );
      expect(sseResponse.status).toBe(200);
      expect(sseResponse.headers.get('content-type'))
        .toContain('text/event-stream');
      let markSseConnected!: () => void;
      const sseConnected = new Promise<void>((resolveConnected) => {
        markSseConnected = resolveConnected;
      });
      const sessionCreatedEvent = readSseEvent(
        sseResponse,
        'session.created',
        markSseConnected,
      );
      await sseConnected;

      const created = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session`,
        {
          method: 'POST',
          headers: gatewayHeaders(deviceToken, projectId, true),
          body: JSON.stringify({ title: `Issue 1170 ${runId}` }),
        },
      );
      expect(created.status).toBe(200);
      const session = (await created.json()) as { id: string };
      sessionId = session.id;
      const event = await sessionCreatedEvent;
      expect(JSON.stringify(event)).toContain(sessionId);
      sseAbort.abort();

      sessionSseAbort = new AbortController();
      const sessionSseResponse = await fetch(
        `${baseUrl}/mobile-gateway/sessions/${encodeURIComponent(sessionId)}/events`,
        {
          headers: gatewayHeaders(deviceToken, projectId),
          signal: sessionSseAbort.signal,
        },
      );
      expect(sessionSseResponse.status).toBe(200);
      let markSessionSseConnected!: () => void;
      const sessionSseConnected = new Promise<void>((resolveConnected) => {
        markSessionSseConnected = resolveConnected;
      });
      const sessionUpdatedEvent = readSseEvent(
        sessionSseResponse,
        'session.updated',
        markSessionSseConnected,
      );
      await sessionSseConnected;
      const updatedTitle = `Issue 1170 scoped ${runId}`;
      const updated = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}`,
        {
          method: 'PATCH',
          headers: gatewayHeaders(deviceToken, projectId, true),
          body: JSON.stringify({ title: updatedTitle }),
        },
      );
      expect(updated.status).toBe(200);
      const scopedEvent = await sessionUpdatedEvent;
      expect(JSON.stringify(scopedEvent)).toContain(sessionId);
      expect(JSON.stringify(scopedEvent)).toContain(updatedTitle);
      sessionSseAbort.abort();
      sessionSseAbort = null;

      const createdPty = await fetch(
        `${baseUrl}/mobile-gateway/opencode/pty`,
        {
          method: 'POST',
          headers: gatewayHeaders(deviceToken, projectId, true),
          body: JSON.stringify({ command: 'cat' }),
        },
      );
      expect(createdPty.status).toBe(200);
      const pty = (await createdPty.json()) as { id: string };
      ptyId = pty.id;

      const ticketResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/pty/${encodeURIComponent(ptyId)}/connect-token`,
        {
          method: 'POST',
          headers: gatewayHeaders(deviceToken, projectId),
        },
      );
      expect(ticketResponse.status).toBe(200);
      const ticketBody = (await ticketResponse.json()) as {
        ticket: string;
      };
      expect(ticketBody.ticket).toBeTruthy();

      const wsUrl = new URL(
        `/mobile-gateway/pty/${encodeURIComponent(ptyId)}/connect`,
        baseUrl,
      );
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.searchParams.set('ticket', ticketBody.ticket);
      ptySocket = await openPty(wsUrl.toString(), gatewayHeaders(
        deviceToken,
        projectId,
      ));
      const textMarker = `TEXT-${runId}\n`;
      const binaryMarker = Buffer.from(`BINARY-${runId}\n`);
      const received: Array<{ data: Buffer; binary: boolean }> = [];
      ptySocket.on('message', (data, binary) => {
        received.push({
          data: Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer),
          binary,
        });
      });
      ptySocket.send(textMarker);
      ptySocket.send(binaryMarker, { binary: true });
      await expect.poll(
        () => received.map((frame) => frame.data.toString()).join(''),
        { timeout: 10_000 },
      ).toContain(textMarker.trim());
      expect(received.some((frame) =>
        frame.data.toString().includes(binaryMarker.toString().trim()),
      )).toBe(true);

      const ptyClosed = new Promise<{ code: number; reason: string }>(
        (resolveClose, rejectClose) => {
          const timer = setTimeout(() => {
            rejectClose(new Error('PTY upstream close propagation timeout'));
          }, 10_000);
          ptySocket!.once('close', (code, reason) => {
            clearTimeout(timer);
            resolveClose({ code, reason: reason.toString() });
          });
        },
      );
      const deletePty = await fetch(
        `${baseUrl}/mobile-gateway/opencode/pty/${encodeURIComponent(ptyId)}`,
        {
          method: 'DELETE',
          headers: gatewayHeaders(deviceToken, projectId),
        },
      );
      expect(deletePty.status).toBe(200);
      ptyId = null;
      const propagatedClose = await ptyClosed;
      expect(propagatedClose.code).not.toBe(1006);
      expect(ptySocket.readyState).toBe(WebSocket.CLOSED);
      ptySocket = null;
      const deleteSession = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}`,
        {
          method: 'DELETE',
          headers: gatewayHeaders(deviceToken, projectId),
        },
      );
      expect(deleteSession.status).toBe(200);
      sessionId = null;

      db.prepare(
        'UPDATE mobile_devices SET revoked_at = ? WHERE id = ?',
      ).run(new Date().toISOString(), deviceId);
      const revokedSse = await fetch(
        `${baseUrl}/mobile-gateway/events`,
        { headers: gatewayHeaders(deviceToken, projectId) },
      );
      expect(revokedSse.status).toBe(401);
      const revokedPtyUrl = new URL(
        '/mobile-gateway/pty/pty-revoked/connect',
        baseUrl,
      );
      revokedPtyUrl.protocol =
        revokedPtyUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      revokedPtyUrl.searchParams.set('ticket', 'ticket-revoked-contract');
      expect(await websocketUpgradeStatus(
        revokedPtyUrl.toString(),
        gatewayHeaders(deviceToken, projectId),
      )).toBe(401);
    } finally {
      sessionSseAbort?.abort();
      ptySocket?.close();
      if (ptyId && deviceToken) {
        await fetch(
          `${baseUrl}/mobile-gateway/opencode/pty/${encodeURIComponent(ptyId)}`,
          {
            method: 'DELETE',
            headers: gatewayHeaders(deviceToken, projectId),
          },
        ).catch(() => undefined);
      }
      if (sessionId && deviceToken) {
        await fetch(
          `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}`,
          {
            method: 'DELETE',
            headers: gatewayHeaders(deviceToken, projectId),
          },
        ).catch(() => undefined);
      }
      const mobileTablesPresent = db.prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('mobile_devices', 'mobile_pairing_codes')`,
      ).get() as { count: number };
      if (deviceId !== null && mobileTablesPresent.count === 2) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      if (mobileTablesPresent.count === 2) {
        db.prepare(
          'DELETE FROM mobile_pairing_codes WHERE user_id = ?',
        ).run(userId);
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(userToken);
      if (userId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
      if (dirname(boundary) === resolve(sandboxDir)) {
        rmSync(boundary, { recursive: true, force: true });
      }
    }
  });
});
