/**
 * Delegation caller identity — the two reasons `rhythm_delegate_async` had never
 * once succeeded in production (measured 2026-08-05: 716 `task` calls, 7 sync
 * `rhythm_delegate`, 0 async).
 *
 * 1. The bearer. `/agent-delegation` was the ONLY agent route that refused the
 *    AGENT_LOCAL bypass, so it needed the token written into opencode.json by
 *    `POST /opencode/mcp/rhythm/ensure`. Nothing ever re-pushes that token. The
 *    configured one was absent from the local `sessions` table AND 403 on
 *    production — stale in both auth domains. Every other agent route kept working
 *    via the bypass, so nothing surfaced the breakage.
 *
 * 2. The session id. `callerSessionId` was a REQUIRED parameter the model had to
 *    supply, but nothing tells an agent its own Rhythm session id. Observed live: an
 *    agent passed `58d65ee9-…`, a UUID it had scraped out of its own cwd path,
 *    instead of its real session `ba0f6a7e-…`.
 *
 * Both now resolve from the session row / trusted security context instead.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { env } from '../config/env';
import {
  ownerOfSessionUnderAgentLocal,
  resolveCallerSessionId,
} from '../controllers/agent_delegation_controller';

const OWNER = 4242;

function seedOwner(): void {
  getDb()
    .prepare(
      `INSERT INTO users (id, name, email, role, created_at, updated_at,
                          is_facilities_manager, email_notifications_enabled, timezone)
       VALUES (?, 'Owner', 'owner@example.test', 'admin', '2026-08-05', '2026-08-05', 0, 0, 'UTC')`,
    )
    .run(OWNER);
}

function seedSession(input: { id: string; sdk: string; owner?: number | null }): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id, owner_user_id, category)
       VALUES (?, 'caller', 'secretary', 'idle', '/tmp', ?, ?, 'chat')`,
    )
    .run(input.id, input.sdk, input.owner === undefined ? OWNER : input.owner);
}

let originalAgentLocal: string | undefined;

beforeEach(() => {
  originalAgentLocal = process.env.AGENT_LOCAL;
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  seedOwner();
});

afterEach(() => {
  if (originalAgentLocal === undefined) delete process.env.AGENT_LOCAL;
  else process.env.AGENT_LOCAL = originalAgentLocal;
});

describe('delegation caller identity', () => {
  it('resolves the caller session from the ENGINE session id, ignoring a wrong model-supplied id', () => {
    seedSession({ id: 'real-session-1', sdk: 'ses_engine_1' });
    const repo = new AgentSessionsRepository();

    // What the engine sends (from the trusted security context).
    const resolved = repo.findBySdkSessionId('ses_engine_1');
    expect(resolved?.id).toBe('real-session-1');

    // What a model invents when asked for its own id — a UUID off its cwd path.
    expect(repo.findById('58d65ee9-2a31-4616-811b-19bde3593079')).toBeFalsy();
  });

  it('an unknown engine session id resolves to nothing rather than a wrong session', () => {
    seedSession({ id: 'real-session-2', sdk: 'ses_engine_2' });
    expect(new AgentSessionsRepository().findBySdkSessionId('ses_not_mapped')).toBeFalsy();
  });

  it('the caller session carries the owner used to authorize a bearer-less local call', () => {
    seedSession({ id: 'owned-session', sdk: 'ses_owned' });
    const row = new AgentSessionsRepository().findBySdkSessionId('ses_owned');
    expect(row?.ownerUserId).toBe(OWNER);
  });

  it('a session with no owner cannot authorize a bearer-less call', () => {
    // Must fall through to 401 rather than delegating as nobody.
    seedSession({ id: 'ownerless', sdk: 'ses_ownerless', owner: null });
    const row = new AgentSessionsRepository().findById('ownerless');
    expect(row).toBeTruthy();
    expect(typeof row?.ownerUserId === 'number').toBe(false);
  });

  it('off-loopback (AGENT_LOCAL unset) there is NO bearer-less identity', () => {
    // env.agentLocal is read once at module load, so this asserts the real
    // default for a hosted deployment: even a perfectly valid, owned caller
    // session yields no identity without a bearer.
    expect(env.agentLocal).toBe(false);
    seedSession({ id: 'owned-2', sdk: 'ses_owned_2' });
    expect(ownerOfSessionUnderAgentLocal('owned-2')).toBeUndefined();
  });

  it('resolveCallerSessionId prefers the engine id and ignores a bogus model id', () => {
    seedSession({ id: 'pref-1', sdk: 'ses_pref_1' });
    expect(
      resolveCallerSessionId({ callerSdkSessionId: 'ses_pref_1', callerSessionId: 'bogus-uuid' }),
    ).toBe('pref-1');
    // Programmatic callers (scheduler / AgentFlow) still pass it explicitly.
    expect(resolveCallerSessionId({ callerSessionId: 'explicit-1' })).toBe('explicit-1');
    // Nothing usable -> empty, so the service raises its own error.
    expect(resolveCallerSessionId({})).toBe('');
  });
});
