/**
 * CONTRACT — requesting a security-bound approval on a CLEAN session reports
 * "not required" rather than failing.
 *
 * Found by live smoke, 2026-08-04. Once first-party reads stopped arming the
 * approval gate, Memory Consolidation's session was clean — but its prompt still
 * tells it to request approval before mutating, so it called
 * rhythm_request_approval with a security_action. createApprovalBinding threw
 * 409 conflict ('session has no external-content taint to approve'), the agent
 * took 8 consecutive 409s, and reported:
 *
 *     Captured: 0 … approval requests were rejected by the server.
 *
 * Which is the same zero-work outcome as the original deadlock, reached by a
 * different route. "You don't need approval" is not an error.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { ExternalContentSecurityService } from '../services/external_content_security_service';

const SDK = 'sdk-clean-1';
const service = new ExternalContentSecurityService();

const CONTEXT = {
  sdkSessionId: SDK,
  turnId: 'turn-1',
  agentName: 'librarian',
  toolCallId: 'call-1',
} as never;

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function session(id = 's1') {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id)
       VALUES (?, ?, 'librarian', 'idle', '/tmp', ?)`,
    )
    .run(id, id, SDK);
}

function taint(sessionId = 's1') {
  getDb()
    .prepare(
      `INSERT INTO agent_external_taint_state
         (session_id, sdk_session_id, taint_id, latest_event_id, tainted_turn_id,
          tainted_agent, source, updated_at)
       VALUES (?, ?, 'taint-1', 'event-1', 'turn-1', 'librarian', 'gmail.search', datetime('now'))`,
    )
    .run(sessionId, SDK);
}

describe('createApprovalBinding on a clean session', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('returns null (approval not required) instead of throwing', () => {
    session();
    expect(
      service.createApprovalBinding(CONTEXT, 'memory.remember', { text: 'a fact' }),
    ).toBeNull();
  });

  it('and consumeApproval independently allows the action, so null is correct', () => {
    session();
    expect(
      service.consumeApproval({
        context: CONTEXT,
        action: 'memory.remember',
        payload: { text: 'a fact' },
      }),
    ).toEqual({ allowed: true, consumed: false });
  });

  it('still returns a real binding when the session IS tainted', () => {
    session();
    taint();
    const binding = service.createApprovalBinding(CONTEXT, 'memory.remember', {
      text: 'a fact',
    });
    expect(binding).not.toBeNull();
    expect(binding!.securityAction).toBe('memory.remember');
    expect(binding!.taintId).toBe('taint-1');
    expect(binding!.boundAgent).toBe('librarian');
    expect(binding!.payloadDigest).toBeTruthy();
    // Still expiring, still bound — the tainted path is unchanged.
    expect(Date.parse(binding!.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('an unknown SDK session still fails closed', () => {
    // No session row at all — provenance cannot be established.
    expect(() =>
      service.createApprovalBinding(CONTEXT, 'memory.remember', { text: 'x' }),
    ).toThrow(/trusted SDK session is unknown/);
  });
});
