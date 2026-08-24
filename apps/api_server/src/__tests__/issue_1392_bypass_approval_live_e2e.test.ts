/**
 * Live behavioral coverage for #1392 interactive approval bypass.
 *
 * Build and launch only through the isolated sandbox, then run:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   npx vitest run src/__tests__/issue_1392_bypass_approval_live_e2e.test.ts
 */
import {
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { canonicalHumanApprovalDecision } from '../security/human_approval_security';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const DB_PATH = process.env.DB_PATH ?? '';
const createdSessionIds: string[] = [];
const HUMAN_CAPABILITY = 'rhythm-live-e2e-capability';

// Public, deterministic test key: scalar 1 on P-256 (the standard generator).
// It has no production value and is accepted only when the sandbox is launched
// with its matching public key and capability digest.
function liveTestPrivateKey(): KeyObject {
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY',
      y: 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
      d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
    },
    format: 'jwk',
  });
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function createInteractiveSession(
  permissionMode: 'default' | 'bypassPermissions',
): Promise<{ id: string; sdkSessionId: string; approvalBypassExplicit: boolean }> {
  const session = await json<{
    id: string;
    sdkSessionId: string;
    approvalBypassExplicit: boolean;
  }>('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({
      agentId: null,
      cwd: '/tmp',
      name: `#1392 live ${permissionMode}`,
      permissionMode,
    }),
  });
  createdSessionIds.push(session.id);
  return session;
}

function armTaint(
  db: Database.Database,
  session: { id: string; sdkSessionId: string },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_external_taint_state
       (session_id, sdk_session_id, taint_id, latest_event_id,
        tainted_turn_id, tainted_agent, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.sdkSessionId,
    randomUUID(),
    randomUUID(),
    `turn-${session.id}`,
    'manager',
    'gmail.search',
    now,
  );
}

async function requestApproval(session: {
  sdkSessionId: string;
}): Promise<{ status: string; reason?: string; id?: string }> {
  return json('/agent-approvals', {
    method: 'POST',
    body: JSON.stringify({
      action: 'Delegate live verification',
      security: {
        context: {
          sdkSessionId: session.sdkSessionId,
          turnId: `turn-${session.sdkSessionId}`,
          agentName: 'manager',
          toolCallId: `call-${session.sdkSessionId}`,
        },
        action: 'delegation.start-async',
        payload: {
          targetAgentConfigId: 'failure-triage',
          prompt: 'Run the isolated live check.',
        },
      },
    }),
  });
}

async function waitForTranscriptMarker(
  sessionId: string,
  marker: string,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let transcript = '';
  while (Date.now() < deadline) {
    const messages = await json<{ messages: unknown[] }>(
      `/agent-sessions/${sessionId}/messages`,
    );
    transcript = JSON.stringify(messages);
    if (transcript.includes(marker)) return transcript;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return transcript;
}

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) {
    await fetch(`${BASE}/agent-sessions/${id}`, { method: 'DELETE' }).catch(
      () => {},
    );
  }
});

describeLive('live E2E — #1392 interactive approval bypass', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`sandbox is not reachable at ${BASE}`);
  });

  it('stamps explicit bypass at the real session API and suppresses only its approval card', async () => {
    const db = new Database(DB_PATH);
    try {
      const bypass = await createInteractiveSession('bypassPermissions');
      const normal = await createInteractiveSession('default');

      // If the controller stops owning this provenance marker, this assertion
      // fails before the gate can silently trust an operational child mode.
      expect(bypass.approvalBypassExplicit).toBe(true);
      expect(normal.approvalBypassExplicit).toBe(false);

      armTaint(db, bypass);
      armTaint(db, normal);

      const bypassResult = await requestApproval(bypass);
      expect(bypassResult).toEqual({
        status: 'not_required',
        reason: 'permission_mode_bypass',
      });

      const defaultResult = await requestApproval(normal);
      expect(defaultResult.status).toBe('pending');
      expect(defaultResult.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const pending = db
        .prepare(
          `SELECT session_id FROM agent_approvals
           WHERE status = 'pending' AND session_id IN (?, ?)
           ORDER BY session_id`,
        )
        .all(bypass.id, normal.id) as Array<{ session_id: string }>;
      expect(pending).toEqual([{ session_id: normal.id }]);
    } finally {
      db.close();
    }
  }, 60_000);

  it('delivers an approved decision into the exact real engine session without a user retry', async () => {
    const db = new Database(DB_PATH);
    const approvalId = randomUUID();
    try {
      const session = await createInteractiveSession('default');
      db.prepare(
        `UPDATE agent_sessions SET status = 'idle' WHERE id = ?`,
      ).run(session.id);

      const decisionNonce = randomUUID();
      const payloadDigest = 'b'.repeat(64);
      db.prepare(
        `INSERT INTO agent_approvals
           (id, session_id, action, preview, consequence, status,
            payload_digest, decision_nonce)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        approvalId,
        session.id,
        'Authorize notification.send',
        '{"title":"#1392 live continuation"}',
        'Sends one harmless notification',
        payloadDigest,
        decisionNonce,
      );

      const signature = sign(
        'sha256',
        Buffer.from(
          canonicalHumanApprovalDecision({
            approvalId,
            status: 'approved',
            decisionNonce,
            payloadDigest,
          }),
        ),
        liveTestPrivateKey(),
      ).toString('base64');
      const bearer = (
        db
          .prepare(
            `SELECT token FROM sessions
             WHERE expires_at IS NULL OR expires_at > datetime('now')
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get() as { token: string }
      ).token;

      const response = await fetch(`${BASE}/agent-approvals/${approvalId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'X-Rhythm-Human-Approval': HUMAN_CAPABILITY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'approved', signature }),
      });
      expect(response.status, await response.text()).toBe(200);

      const row = db
        .prepare(
          `SELECT status, continuation_state FROM agent_approvals WHERE id = ?`,
        )
        .get(approvalId) as {
        status: string;
        continuation_state: string | null;
      };
      expect(row).toEqual({
        status: 'approved',
        continuation_state: 'delivered',
      });

      const transcript = await waitForTranscriptMarker(
        session.id,
        `rhythm-approval-continuation:${approvalId}`,
      );
      expect(transcript).toContain(
        `rhythm-approval-continuation:${approvalId}`,
      );
      expect(transcript).toContain(`approval_id: ${approvalId}`);
    } finally {
      db.prepare('DELETE FROM agent_approvals WHERE id = ?').run(approvalId);
      db.close();
    }
  }, 60_000);
});
