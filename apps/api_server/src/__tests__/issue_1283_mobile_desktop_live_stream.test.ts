import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const expectedApiPort = process.env.RHYTHM_SANDBOX_API_PORT ?? '';
const expectedEnginePort =
  process.env.RHYTHM_SANDBOX_ENGINE_PORT ?? '';
const humanCapability =
  process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';

function gatewayHeaders(
  deviceToken: string,
  projectId: string,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
  };
}

function waitForTranscriptEvent(
  response: Response,
  marker: string,
  onConnected: () => void,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const observedFrames: string[] = [];
  return new Promise((resolveEvent, rejectEvent) => {
    const timer = setTimeout(() => {
      void reader.cancel();
      rejectEvent(new Error(
        `Timed out waiting for live transcript marker ${marker}; observed ${JSON.stringify(observedFrames.slice(-12))}`,
      ));
    }, timeoutMs);
    const pump = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) throw new Error('SSE ended before transcript event');
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
            observedFrames.push(JSON.stringify(parsed).slice(0, 800));
            const payload = (
              parsed.payload &&
              typeof parsed.payload === 'object'
            )
              ? parsed.payload as Record<string, unknown>
              : parsed;
            if (payload.type === 'server.connected') onConnected();
            if (
              payload.type === 'message.part.updated' &&
              JSON.stringify(parsed).includes(marker)
            ) {
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

describeLive('live E2E — desktop-to-mobile transcript stream', () => {
  it(
    'issue-1283-c1 / issue-1285-c21: an already-connected mobile stream receives a projectless desktop session transcript event',
    async () => {
      if (
        process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
        !/^\d{4,5}$/.test(expectedApiPort) ||
        !/^\d{4,5}$/.test(expectedEnginePort) ||
        ['4000', '4001', '4096'].includes(expectedApiPort) ||
        ['4000', '4001', '4096'].includes(expectedEnginePort) ||
        baseUrl !== `http://127.0.0.1:${expectedApiPort}` ||
        engineUrl !== `http://127.0.0.1:${expectedEnginePort}` ||
        expectedApiPort === expectedEnginePort ||
        resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
        dbPath.includes('/Library/Application Support/Rhythm/') ||
        humanCapability.length < 24
      ) {
        throw new Error(
          'Issue #1283 live test requires an attested isolated sandbox',
        );
      }

      const db = new Database(dbPath);
      db.pragma('foreign_keys = ON');
      const runId = randomUUID();
      const userToken = randomUUID();
      const projectId = randomUUID();
      const projectRoot = join(sandboxDir, `issue-1283-${runId}`);
      const desktopAllSessionsRoot = join(
        sandboxDir,
        `issue-1283-all-sessions-${runId}`,
      );
      const transcriptMarker = `issue-1283-live-${runId}`;
      mkdirSync(projectRoot, { recursive: true });
      mkdirSync(desktopAllSessionsRoot, { recursive: true });

      let userId: number | null = null;
      let deviceId: string | null = null;
      let deviceToken = '';
      let desktopLocalId: string | null = null;
      let desktopSdkId: string | null = null;
      const sseAbort = new AbortController();
      const rawSseAbort = new AbortController();
      try {
        userId = Number(db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          'Issue 1283 User',
          `issue-1283-${runId}@example.test`,
          `issue-1283-${runId}`,
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
          'Issue 1283 Project',
          projectRoot,
          new Date().toISOString(),
        );

        const pairingCodeResponse = await fetch(
          `${baseUrl}/mobile-gateway/pairing-codes`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${userToken}`,
              'Content-Type': 'application/json',
              'X-Rhythm-Human-Approval': humanCapability,
            },
            body: '{}',
          },
        );
        expect(pairingCodeResponse.status).toBe(201);
        const pairingCode = await pairingCodeResponse.json() as {
          pairingCode: string;
          hostId: string;
        };
        const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: pairingCode.pairingCode,
            hostId: pairingCode.hostId,
            deviceName: 'Issue 1283 Live iPhone',
          }),
        });
        expect(pairResponse.status).toBe(201);
        const paired = await pairResponse.json() as {
          deviceId: string;
          deviceToken: string;
        };
        deviceId = paired.deviceId;
        deviceToken = paired.deviceToken;

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
        let markConnected!: () => void;
        const connected = new Promise<void>((resolveConnected) => {
          markConnected = resolveConnected;
        });
        const transcriptEvent = waitForTranscriptEvent(
          sseResponse,
          transcriptMarker,
          markConnected,
        );
        void transcriptEvent.catch(() => undefined);
        await connected;

        const rawSseResponse = await fetch(`${engineUrl}/global/event`, {
          headers: { Accept: 'text/event-stream' },
          signal: rawSseAbort.signal,
        });
        expect(rawSseResponse.status).toBe(200);
        let markRawConnected!: () => void;
        const rawConnected = new Promise<void>((resolveConnected) => {
          markRawConnected = resolveConnected;
        });
        const rawTranscriptEvent = waitForTranscriptEvent(
          rawSseResponse,
          transcriptMarker,
          markRawConnected,
        );
        void rawTranscriptEvent.catch(() => undefined);
        await rawConnected;

        // Reproduce the shipping desktop create path only after the mobile
        // event stream is already consuming the engine's global stream.
        const desktopCreate = await fetch(`${baseUrl}/agent-sessions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agentId: null,
            cwd: desktopAllSessionsRoot,
            projectId: null,
            name: `Issue 1283 desktop ${runId}`,
          }),
        });
        expect(desktopCreate.status).toBe(201);
        const desktopSession = await desktopCreate.json() as {
          id: string;
          sdkSessionId: string;
        };
        desktopLocalId = desktopSession.id;
        desktopSdkId = desktopSession.sdkSessionId;
        expect(desktopSdkId).toBeTruthy();
        // Model the already-shipped desktop/legacy sessions fixed for reads
        // by #1279: durable desktop catalog ownership exists, but no explicit
        // mobile claim row does.
        db.prepare(
          `DELETE FROM mobile_opencode_resource_owners
            WHERE resource_kind = 'session'
              AND resource_id = ?`,
        ).run(desktopSdkId);
        expect(
          db.prepare(
            `SELECT 1
               FROM mobile_opencode_resource_owners
              WHERE resource_kind = 'session'
                AND resource_id = ?`,
          ).get(desktopSdkId),
        ).toBeUndefined();

        // Owner-unscoped discovery must already see this All Sessions chat.
        // The criterion below deliberately waits on the independently-open
        // selected-project live event stream.
        const listResponse = await fetch(
          `${baseUrl}/mobile-gateway/opencode/experimental/session`,
          {
            headers: {
              ...gatewayHeaders(deviceToken, projectId),
              'X-Rhythm-Session-Discovery': 'owner-unscoped',
            },
          },
        );
        expect(listResponse.status).toBe(200);
        expect(
          (await listResponse.json() as Array<{ id: string }>)
            .map(({ id }) => id),
        ).toContain(desktopSdkId);

        const promptUrl = new URL(
          `/session/${encodeURIComponent(desktopSdkId)}/prompt_async`,
          engineUrl,
        );
        promptUrl.searchParams.set('directory', desktopAllSessionsRoot);
        const desktopPrompt = await fetch(promptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noReply: true,
            parts: [{ type: 'text', text: transcriptMarker }],
          }),
        });
        expect(desktopPrompt.status).toBe(204);

        const rawDelivered = await rawTranscriptEvent;
        expect(JSON.stringify(rawDelivered)).toContain(transcriptMarker);
        let delivered: Record<string, unknown>;
        try {
          delivered = await transcriptEvent;
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}; raw ${JSON.stringify(rawDelivered).slice(0, 1_500)}`,
          );
        }
        expect(JSON.stringify(delivered)).toContain(desktopSdkId);
        expect(JSON.stringify(delivered)).toContain(transcriptMarker);
      } finally {
        sseAbort.abort();
        rawSseAbort.abort();
        if (desktopLocalId) {
          await fetch(
            `${baseUrl}/agent-sessions/${desktopLocalId}/hard`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${userToken}` },
            },
          ).catch(() => undefined);
        } else if (desktopSdkId) {
          const cleanupUrl = new URL(
            `/session/${encodeURIComponent(desktopSdkId)}`,
            engineUrl,
          );
          cleanupUrl.searchParams.set('directory', desktopAllSessionsRoot);
          await fetch(cleanupUrl, { method: 'DELETE' })
            .catch(() => undefined);
        }
        if (deviceId) {
          db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
        }
        db.prepare(
          `DELETE FROM mobile_opencode_resource_owners
            WHERE project_id = ?`,
        ).run(projectId);
        db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
        db.prepare('DELETE FROM sessions WHERE token = ?').run(userToken);
        if (userId) {
          db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        }
        db.close();
        rmSync(projectRoot, { recursive: true, force: true });
        rmSync(desktopAllSessionsRoot, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
