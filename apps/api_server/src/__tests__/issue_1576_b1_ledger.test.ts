import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import type { DispatchInput } from '../models/model_provenance';

const originalClient = env.dbClient;
let db: Database.Database;
function setup() {
  env.dbClient = 'sqlite';
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  db.prepare("INSERT INTO agent_sessions (id, agent_kind, cwd, name) VALUES ('s', 'build', '/', 'test')").run();
  return new ModelProvenanceRepository();
}
afterEach(() => {
  setDb(null);
  db?.close();
  env.dbClient = originalClient;
});

describe('#1576 B1 local dispatch ledger', () => {
  it('c1 fresh/upgrade/replay creates only an empty local dispatch table without historical fabrication', () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO agent_sessions (id, agent_kind, cwd, name) VALUES ('legacy', 'build', '/', 'legacy')").run();
    db.prepare("INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text) VALUES ('legacy','assistant','old','old')").run();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'agent_turn_dispatches'").get()).toEqual({ name: 'agent_turn_dispatches' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_turn_dispatches').get()).toEqual({ n: 0 });
    expect(db.pragma('foreign_key_list(agent_turn_dispatches)')).toEqual([{
      id: 0, seq: 0, table: 'agent_sessions', from: 'session_id', to: 'id', on_update: 'NO ACTION', on_delete: 'CASCADE', match: 'NONE',
    }]);
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_turn_dispatches').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_session_messages WHERE session_id = 'legacy'").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'agent_served_steps'").get()).toBeUndefined();
    expect((db.pragma('table_info(agent_sessions)') as { name: string }[]).map((column) => column.name)).not.toContain('served_model_id');
  });

  it('c2 roundtrips structured dispatch metadata, outcome and stable pagination without content', () => {
    const repo = setup();
    const first = repo.insert({ sessionId: 's', sdkSessionId: 'sdk-s', origin: 'ws_input', requestedSource: 'turn_override', requestedProviderId: 'openrouter', requestedModelId: 'openrouter/free', requestedTier: 'high', resolvedProviderId: 'openrouter', resolvedModelId: 'openrouter/free', resolvedTier: 'low', overrideApplied: true, downgraded: true, routeAuthed: false, finalProviderId: 'openrouter', finalModelId: 'openrouter/free', reasonCode: 'budget_downgrade' });
    const second = repo.insert({ sessionId: 's', sdkSessionId: 'sdk-s', origin: 'fallback_redispatch', requestedSource: 'fallback_chain', predecessorId: first.id });
    const expected = {
      id: first.id, sessionId: 's', sdkSessionId: 'sdk-s', sdkUserMessageId: null,
      origin: 'ws_input', requestedSource: 'turn_override', requestedProviderId: 'openrouter', requestedModelId: 'openrouter/free', requestedTier: 'high',
      resolvedProviderId: 'openrouter', resolvedModelId: 'openrouter/free', resolvedTier: 'low', overrideApplied: true, downgraded: true,
      routeAuthed: false, finalProviderId: 'openrouter', finalModelId: 'openrouter/free', reasonCode: 'budget_downgrade', predecessorId: null,
      outcome: 'pending', createdAt: first.createdAt, updatedAt: first.updatedAt,
    };
    expect(first).toEqual(expected);
    expect(db.prepare('SELECT * FROM agent_turn_dispatches WHERE id = ?').get(first.id)).toEqual({
      id: first.id, session_id: 's', sdk_session_id: 'sdk-s', sdk_user_message_id: null,
      origin: 'ws_input', requested_source: 'turn_override', requested_provider_id: 'openrouter', requested_model_id: 'openrouter/free', requested_tier: 'high',
      resolved_provider_id: 'openrouter', resolved_model_id: 'openrouter/free', resolved_tier: 'low', override_applied: 1, downgraded: 1,
      route_authed: 0, final_provider_id: 'openrouter', final_model_id: 'openrouter/free', reason_code: 'budget_downgrade', predecessor_id: null,
      outcome: 'pending', created_at: first.createdAt, updated_at: first.updatedAt,
    });
    expect(second).toEqual({ ...expected, id: second.id, origin: 'fallback_redispatch', requestedSource: 'fallback_chain',
      requestedProviderId: null, requestedModelId: null, requestedTier: null, resolvedProviderId: null, resolvedModelId: null, resolvedTier: null,
      overrideApplied: false, downgraded: false, routeAuthed: null, finalProviderId: null, finalModelId: null, reasonCode: null,
      predecessorId: first.id, createdAt: second.createdAt, updatedAt: second.updatedAt });
    expect(repo.list('s', { limit: 1 })).toEqual([expect.objectContaining({ id: first.id, requestedModelId: 'openrouter/free', resolvedTier: 'low', outcome: 'pending' })]);
    expect(repo.list('s', { afterId: first.id })).toEqual([expect.objectContaining({ id: second.id, predecessorId: first.id })]);
    const inverse = repo.insert({ sessionId: 's', origin: 'prompt_api', requestedSource: 'caller', overrideApplied: false, downgraded: false, routeAuthed: true });
    expect(repo.get(inverse.id)).toEqual(expect.objectContaining({ overrideApplied: false, downgraded: false, routeAuthed: true }));
    expect(db.prepare('SELECT override_applied, downgraded, route_authed FROM agent_turn_dispatches WHERE id = ?').get(inverse.id))
      .toEqual({ override_applied: 0, downgraded: 0, route_authed: 1 });
    expect(repo.setOutcome(first.id, 'accepted', 'sdk-user')).toBe(true);
    expect(repo.get(first.id)).toEqual(expect.objectContaining({ outcome: 'accepted', sdkUserMessageId: 'sdk-user', reasonCode: 'budget_downgrade' }));
    expect(repo.setOutcome(first.id, 'accepted', 'sdk-user')).toBe(true);
    expect(() => repo.setOutcome(first.id, 'pending')).toThrow();
    expect(repo.setOutcome(second.id, 'unknown')).toBe(true);
    expect(repo.linkUserMessage(second.id, 'sdk-late')).toBe(true);
    expect(repo.linkUserMessage(second.id, 'sdk-late')).toBe(true);
    expect(repo.linkUserMessage(second.id, 'sdk-different')).toBe(false);
    expect(repo.get(second.id)?.sdkUserMessageId).toBe('sdk-late');
    expect(repo.list('other')).toEqual([]);
  });

  it('c2 pages 205+ attempts in rowid order despite identical timestamps, without leaking sessions or accepting foreign cursors', () => {
    const repo = setup();
    db.prepare("INSERT INTO agent_sessions (id, agent_kind, cwd, name) VALUES ('other', 'build', '/', 'other')").run();
    const ids = Array.from({ length: 207 }, () => repo.insert({ sessionId: 's', origin: 'ws_input', requestedSource: 'session' }).id);
    const foreign = repo.insert({ sessionId: 'other', origin: 'ws_input', requestedSource: 'session' });
    db.prepare("UPDATE agent_turn_dispatches SET created_at = '2026-01-01T00:00:00.000Z'").run();
    expect(repo.list('s').map((row) => row.id)).toEqual(ids.slice(0, 100));
    expect(repo.list('s', { limit: 999 }).map((row) => row.id)).toEqual(ids.slice(0, 200));
    expect(repo.list('s', { limit: 0 }).map((row) => row.id)).toEqual(ids.slice(0, 1));
    expect(repo.list('s', { limit: -4 }).map((row) => row.id)).toEqual(ids.slice(0, 1));
    expect(repo.list('s', { limit: 1 }).map((row) => row.id)).toEqual(ids.slice(0, 1));
    expect(repo.list('s', { afterId: ids[99] }).map((row) => row.id)).toEqual(ids.slice(100, 200));
    expect(repo.list('s', { afterId: ids[199] }).map((row) => row.id)).toEqual(ids.slice(200));
    expect(repo.list('s', { afterId: ids[206] })).toEqual([]);
    expect(repo.list('s', { afterId: foreign.id })).toEqual([]);
    expect(repo.list('s', { afterId: 'missing' })).toEqual([]);
    expect(repo.list('other').map((row) => row.id)).toEqual([foreign.id]);
  });

  it('c1 upgrades a populated pre-ledger DB without inventing attempts', () => {
    const repo = setup();
    db.prepare("INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text) VALUES ('s','assistant','historical','historical')").run();
    db.exec('DROP TABLE agent_turn_dispatches');
    runMigrations(db);
    expect(repo.list('s')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_session_messages').get()).toEqual({ n: 1 });
  });

  it('c3 enforces FK on late writes and cascades hard delete and age purge while keeping messages on revert', () => {
    const repo = setup();
    const retained = repo.insert({ sessionId: 's', sdkSessionId: 'sdk-s', origin: 'ws_input', requestedSource: 'session' });
    db.prepare("INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text) VALUES ('s','user','x','x')").run();
    expect(new AgentSessionMessagesRepository().deleteBySession('s')).toBe(1);
    expect(repo.get(retained.id)?.id).toBe(retained.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_session_messages WHERE session_id = 's'").get()).toEqual({ n: 0 });
    new AgentSessionsRepository().deleteById('s');
    expect(repo.list('s')).toEqual([]);
    expect(() => repo.insert({ sessionId: 's', sdkSessionId: 'late', origin: 'ws_input', requestedSource: 'session' })).toThrow(/FOREIGN KEY/i);
    db.prepare("INSERT INTO agent_sessions (id, agent_kind, cwd, name, status, created_at) VALUES ('old','build','/','old','closed','2020-01-01')").run();
    repo.insert({ sessionId: 'old', sdkSessionId: 'sdk-old', origin: 'agent_runner', requestedSource: 'tier' });
    new AgentSessionsRepository().deleteOlderThan('2021-01-01');
    expect(repo.list('old')).toEqual([]);
  });

  it('c4 refuses unbounded or unsafe fields and invalid outcomes without mutation', () => {
    const repo = setup();
    // A non-string object coercing to a valid session ID must never write a row.
    expect(() => repo.insert({ sessionId: { toString: () => 's' } as unknown as string, sdkSessionId: 'sdk-s', origin: 'ws_input', requestedSource: 'session' })).toThrow(/Invalid dispatch metadata/);
    expect(repo.list('s')).toEqual([]);
    expect(() => repo.insert({ sessionId: 's', sdkSessionId: 'sdk-s', origin: 'ws_input', requestedSource: 'session', reasonCode: 'x'.repeat(300) })).toThrow();
    expect(() => repo.insert({ sessionId: 's', sdkSessionId: 'sdk-s', origin: 'ws_input', requestedSource: 'session', reasonCode: 'API key: secret' })).toThrow();
    expect(repo.list('s')).toEqual([]);
    const row = repo.insert({ sessionId: 's', sdkSessionId: 'sdk-s', origin: 'ws_input', requestedSource: 'session' });
    expect(() => repo.setOutcome(row.id, 'sent' as 'accepted')).toThrow();
    expect(repo.get(row.id)?.outcome).toBe('pending');
    expect(repo.setOutcome(row.id, 'rejected')).toBe(true);
    expect(repo.linkUserMessage(row.id, 'sdk-user')).toBe(false);
    expect(() => repo.insert({ sessionId: 's', sdkSessionId: 'sdk-s', origin: 'ws_input', requestedSource: 'session', requestedModelId: 'Bearer secret' })).toThrow();
  });

  it('c4 rejects invalid values in all 12 identifier fields and both enums without writes', () => {
    const repo = setup();
    const base: DispatchInput = { sessionId: 's', origin: 'ws_input', requestedSource: 'session' };
    const keys = ['sessionId', 'sdkSessionId', 'sdkUserMessageId', 'requestedProviderId', 'requestedModelId', 'requestedTier',
      'resolvedProviderId', 'resolvedModelId', 'resolvedTier', 'finalProviderId', 'finalModelId', 'predecessorId'] as const;
    for (const key of keys) {
      for (const invalid of ['', 'a'.repeat(201), 'a b', 'x\nsecret', 'Bearer token', { toString: () => 's' }]) {
        expect(() => repo.insert({ ...base, [key]: invalid } as DispatchInput), `${key}: ${String(invalid)}`).toThrow();
      }
    }
    for (const invalid of ['WS_INPUT', 'bogus', '', { toString: () => 'ws_input' }]) {
      expect(() => repo.insert({ ...base, origin: invalid } as DispatchInput)).toThrow();
    }
    for (const invalid of ['SESSION', 'bogus', '', { toString: () => 'session' }]) {
      expect(() => repo.insert({ ...base, requestedSource: invalid } as DispatchInput)).toThrow();
    }
    for (const code of ['', 'Bad_Code', 'x'.repeat(65), 'api key', 'x\nsecret']) {
      expect(() => repo.insert({ ...base, reasonCode: code } as DispatchInput)).toThrow();
    }
    expect(repo.list('s')).toEqual([]);
  });

  it('c4 accepts boundary-length identifier characters, reason codes, and each owned enum value', () => {
    const repo = setup();
    const keys = ['sdkSessionId', 'sdkUserMessageId', 'requestedProviderId', 'requestedModelId', 'requestedTier',
      'resolvedProviderId', 'resolvedModelId', 'resolvedTier', 'finalProviderId', 'finalModelId', 'predecessorId'] as const;
    const origins = ['ws_input', 'fallback_redispatch', 'agent_runner', 'delegation', 'delegation_completion', 'approval_continuation', 'prompt_api', 'unspecified'] as const;
    const sources = ['turn_override', 'session', 'agent_config', 'agent_default', 'tier', 'fallback_chain', 'caller'] as const;
    const chars = 'aZ09._:/@+-';
    for (const value of ['a', 'x'.repeat(200), chars]) {
      const input = Object.fromEntries(keys.map((key) => [key, value])) as Pick<DispatchInput, typeof keys[number]>;
      const row = repo.insert({ sessionId: 's', origin: 'ws_input', requestedSource: 'session', ...input });
      for (const key of keys) expect(row[key]).toBe(value);
    }
    for (const origin of origins) expect(repo.insert({ sessionId: 's', origin, requestedSource: 'session' }).origin).toBe(origin);
    for (const requestedSource of sources) expect(repo.insert({ sessionId: 's', origin: 'ws_input', requestedSource }).requestedSource).toBe(requestedSource);
    for (const code of ['a', 'budget_downgrade', `a${'z'.repeat(63)}`])
      expect(repo.insert({ sessionId: 's', origin: 'ws_input', requestedSource: 'session', reasonCode: code }).reasonCode).toBe(code);
    for (const outcome of ['accepted', 'rejected', 'unknown'] as const) {
      const row = repo.insert({ sessionId: 's', origin: 'ws_input', requestedSource: 'session' });
      expect(repo.get(row.id)?.outcome).toBe('pending');
      expect(repo.setOutcome(row.id, outcome)).toBe(true);
      expect(repo.get(row.id)?.outcome).toBe(outcome);
    }
  });

  it('c4 keeps prompt/credential extras out of the closed input type and raw storage', () => {
    const repo = setup();
    // @ts-expect-error prompt text is not a dispatch input
    const typed: DispatchInput = { sessionId: 's', origin: 'ws_input', requestedSource: 'session', prompt: 'secret' };
    const row = repo.insert({ ...typed, rawText: 'secret', apiKey: 'secret', providerError: 'secret' } as DispatchInput);
    for (const key of ['prompt', 'rawText', 'apiKey', 'providerError']) expect(row).not.toHaveProperty(key);
    expect(JSON.stringify(db.prepare('SELECT * FROM agent_turn_dispatches WHERE id = ?').get(row.id))).not.toContain('secret');
    const columns = (db.pragma('table_info(agent_turn_dispatches)') as { name: string }[]).map((column) => column.name);
    for (const key of ['prompt', 'raw_text', 'api_key', 'provider_error', 'content', 'body']) expect(columns).not.toContain(key);
  });

  it('c4 rejects malformed outcome and late links without changing the persisted row', () => {
    const repo = setup();
    const row = repo.insert({ sessionId: 's', origin: 'ws_input', requestedSource: 'session' });
    for (const invalid of ['pending', 'sent', 'ACCEPTED']) {
      expect(() => repo.setOutcome(row.id, invalid as 'accepted')).toThrow(/Invalid/);
      expect(repo.get(row.id)).toEqual(row);
    }
    for (const badId of ['', 'a'.repeat(201), 'secret key', { toString: () => 'valid' }]) {
      expect(() => repo.setOutcome(row.id, 'accepted', badId as string)).toThrow(/Invalid/);
      expect(() => repo.linkUserMessage(row.id, badId as string)).toThrow(/Invalid/);
      expect(repo.get(row.id)).toEqual(row);
    }
  });

  it('c4 rejects non-string outcome and link identifiers without changing the persisted row', () => {
    const repo = setup();
    const row = repo.insert({ sessionId: 's', origin: 'ws_input', requestedSource: 'session' });
    expect(() => repo.setOutcome(row.id, 'accepted', 123 as unknown as string)).toThrow(/Invalid dispatch outcome/);
    expect(() => repo.setOutcome(123 as unknown as string, 'accepted')).toThrow(/Invalid dispatch outcome/);
    expect(repo.get(row.id)).toEqual(row);
    expect(() => repo.linkUserMessage(123 as unknown as string, 'sdk-user')).toThrow(/Invalid SDK message id/);
    expect(repo.get(row.id)).toEqual(row);
    expect(() => repo.linkUserMessage(row.id, null as unknown as string)).toThrow(/Invalid SDK message id/);
    expect(repo.get(row.id)?.sdkUserMessageId).toBe(row.sdkUserMessageId);
  });

  it('c5 Postgres refuses unsupported reads and writes before accessing SQLite', () => {
    const repo = setup();
    const prepare = vi.spyOn(db, 'prepare');
    env.dbClient = 'postgres';
    expect(() => repo.list('s')).toThrow(/unsupported|unavailable/i);
    expect(() => repo.insert({ sessionId: 's', sdkSessionId: 'sdk', origin: 'ws_input', requestedSource: 'session' })).toThrow(/unsupported|unavailable/i);
    expect(() => repo.get('id')).toThrow(/unsupported|unavailable/i);
    expect(() => repo.setOutcome('id', 'rejected')).toThrow(/unsupported|unavailable/i);
    expect(() => repo.linkUserMessage('id', 'sdk-user')).toThrow(/unsupported|unavailable/i);
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
  });

  it('c5 explicitly excludes the local ledger from Postgres bootstrap and dual-engine parity ownership', () => {
    const bootstrap = readFileSync(join(__dirname, '../database/postgres_bootstrap.ts'), 'utf8');
    const parity = readFileSync(join(__dirname, 'skill_schema_parity.test.ts'), 'utf8');
    expect(bootstrap).not.toMatch(/CREATE TABLE IF NOT EXISTS agent_turn_dispatches\b/i);
    expect(parity).not.toMatch(/^\s*'agent_turn_dispatches',/m);
  });
});
