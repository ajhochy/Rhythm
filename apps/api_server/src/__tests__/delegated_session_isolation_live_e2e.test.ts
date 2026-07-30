/**
 * Live delegated-session isolation contract.
 *
 * This file is intentionally written but not run by the implementing agent.
 * It requires a rebuilt fork + api_server in the isolated sandbox and proves
 * the real engine session.created event crosses the api_server stream bridge,
 * reaches WebSocket clients, and is classified by the public session API.
 *
 * Command (from apps/api_server):
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
 *   RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
 *   RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox \
 *   npx vitest run src/__tests__/delegated_session_isolation_live_e2e.test.ts
 */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const API = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const ENGINE = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const DB_PATH = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const SANDBOX_DIR = process.env.RHYTHM_SANDBOX_DIR ?? '';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.text();
  expect(response.ok, `${response.status} ${url}: ${body}`).toBe(true);
  return (body ? JSON.parse(body) : {}) as T;
}

function openAgentSocket(): Promise<WebSocket> {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(API.replace(/^http/, 'ws') + '/ws/agents');
    socket.once('open', () => resolveSocket(socket));
    socket.once('error', rejectSocket);
  });
}

function observeCreated(socket: WebSocket): Set<string> {
  const observed = new Set<string>();
  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as {
      type?: string;
      properties?: { info?: { id?: string } };
    };
    const id = frame.properties?.info?.id;
    if (frame.type === 'session.created' && id) observed.add(id);
  });
  return observed;
}

async function waitForCreated(
  observed: Set<string>,
  sdkSessionId: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (observed.has(sdkSessionId)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`timed out waiting for ${sdkSessionId}`);
}

async function pollScope(
  scope: 'chats' | 'scheduled' | 'self_improvement',
  childSdkId: string,
  shouldContain: boolean,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastIds: string[] = [];
  while (Date.now() < deadline) {
    const body = await json<{
      sessions: Array<{ sdkSessionId: string | null }>;
    }>(`${API}/agent-sessions?scope=${scope}`);
    lastIds = body.sessions.flatMap(({ sdkSessionId }) =>
      sdkSessionId ? [sdkSessionId] : [],
    );
    if (lastIds.includes(childSdkId) === shouldContain) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(
    `${childSdkId} containment=${shouldContain} not observed in ${scope}: ${lastIds.join(',')}`,
  );
}

describeLive('delegated-session isolation live E2E', () => {
  it(
    'scheduled and self-improvement engine children stay out of Chats through API + WebSocket',
    async () => {
      if (
        process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
        !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(API) ||
        !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(ENGINE) ||
        new URL(API).port === '4001' ||
        new URL(ENGINE).port === '4096' ||
        !DB_PATH.startsWith('/') ||
        !SANDBOX_DIR.startsWith('/') ||
        resolve(DB_PATH) !== resolve(SANDBOX_DIR, 'rhythm.db') ||
        DB_PATH.includes('/Library/Application Support/Rhythm/')
      ) {
        throw new Error('Live delegated-session test requires the attested isolated sandbox');
      }

      const db = new Database(DB_PATH);
      const runId = randomUUID();
      const scheduledTaskId = `delegated-live-schedule-${runId}`;
      const socket = await openAgentSocket();
      const observedCreated = observeCreated(socket);
      const createdSdkIds: string[] = [];
      const createdLocalIds: string[] = [];
      try {
        db.prepare(
          `INSERT INTO agent_scheduled_tasks (id, name, prompt, enabled)
           VALUES (?, ?, 'Live delegated scope proof', 0)`,
        ).run(scheduledTaskId, `Delegated live ${runId}`);

        const createParent = async (label: string) => {
          const parent = await json<{ id: string; sdkSessionId: string }>(
            `${API}/agent-sessions`,
            {
              method: 'POST',
              body: JSON.stringify({
                agentId: null,
                cwd: SANDBOX_DIR,
                name: `${label} ${runId}`,
              }),
            },
          );
          createdLocalIds.push(parent.id);
          createdSdkIds.push(parent.sdkSessionId);
          return parent;
        };

        const scheduledParent = await createParent('Scheduled parent');
        db.prepare(
          `UPDATE agent_sessions
              SET category = 'scheduled',
                  is_system = 1,
                  scheduled_task_id = ?
            WHERE id = ?`,
        ).run(scheduledTaskId, scheduledParent.id);

        const selfParent = await createParent('Self-improvement parent');
        db.prepare(
          `UPDATE agent_sessions
              SET category = 'self_improvement',
                  is_system = 1
            WHERE id = ?`,
        ).run(selfParent.id);

        const createChild = async (parentSdkId: string, title: string) => {
          const child = await json<{ id: string }>(`${ENGINE}/session`, {
            method: 'POST',
            body: JSON.stringify({
              title,
              parentID: parentSdkId,
              permission: [
                { permission: '*', pattern: '*', action: 'allow' },
              ],
            }),
          });
          createdSdkIds.push(child.id);
          await waitForCreated(observedCreated, child.id);
          return child.id;
        };

        const scheduledChild = await createChild(
          scheduledParent.sdkSessionId,
          `Scheduled child ${runId}`,
        );
        const selfChild = await createChild(
          selfParent.sdkSessionId,
          `Self-improvement child ${runId}`,
        );

        await pollScope('scheduled', scheduledChild, true);
        await pollScope('self_improvement', selfChild, true);
        await pollScope('chats', scheduledChild, false);
        await pollScope('chats', selfChild, false);
      } finally {
        socket.close();
        for (const sdkId of createdSdkIds.reverse()) {
          await fetch(`${ENGINE}/session/${sdkId}`, { method: 'DELETE' }).catch(
            () => undefined,
          );
        }
        if (createdLocalIds.length > 0) {
          const placeholders = createdLocalIds.map(() => '?').join(',');
          db.prepare(
            `DELETE FROM agent_sessions
              WHERE id IN (${placeholders})
                 OR parent_session_id IN (${placeholders})`,
          ).run(...createdLocalIds, ...createdLocalIds);
        }
        db.prepare(`DELETE FROM agent_scheduled_tasks WHERE id = ?`).run(
          scheduledTaskId,
        );
        db.close();
      }
    },
    60_000,
  );
});
