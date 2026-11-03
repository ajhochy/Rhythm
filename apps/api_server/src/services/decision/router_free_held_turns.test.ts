import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { drainHeldTurn, HeldTurnsRepository, recordHeldTurn, type DrainDeps } from './router_free_held_turns';

let db: Database.Database, prev: Database.Database | null, owner: number;
const sessions = new AgentSessionsRepository();
const held = new HeldTurnsRepository();
const HOLD = 'held-message';
function session() { return sessions.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'held', modelMode: 'auto', ownerUserId: owner }); }
function deps(overrides: Partial<DrainDeps> = {}): DrainDeps & { sent: string[]; notes: string[] } {
  const sent: string[] = [], notes: string[] = [];
  return { sent, notes, holdMessage: HOLD, remoteConsent: () => true,
    dispatch: vi.fn(async t => { sent.push(t.inputText); return []; }), notify: async (_s, m) => { notes.push(m); }, ...overrides };
}
const hold = (id: string, text = 'synthetic held text') => recordHeldTurn({ sessionId: id, origin: 'prompt_api', inputText: text, options: { fastMode: true } });
beforeEach(() => {
  db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
  owner = new UsersRepository().create({ name: 'Fake', email: 'fake@example.test' }).id;
});
afterEach(() => { setDb(prev); db.close(); });

describe('Free Mode held turns (D1-D3)', () => {
  it('migration is additive and idempotent; record snapshots authority; listing is body-free', async () => {
    runMigrations(db); runMigrations(db);
    const s = session(); const t = (await hold(s.id))!;
    expect(t).toMatchObject({ status: 'pending', ownerUserId: owner, origin: 'prompt_api', options: { fastMode: true }, permissionMode: s.permissionMode });
    expect(JSON.stringify(await held.list(s.id))).not.toContain('synthetic held text');
  });
  it('claim race: exactly one of concurrent claims and drains wins; a dispatched turn is never re-sent', async () => {
    const s = session(); const t = (await hold(s.id))!;
    expect((await Promise.all([held.claim(t.id), held.claim(t.id)])).filter(Boolean)).toHaveLength(1);
    const s2 = session(); await hold(s2.id, 'once only'); const d = deps();
    const outcomes = await Promise.all([drainHeldTurn(s2.id, d), drainHeldTurn(s2.id, d)]);
    expect(d.sent).toEqual(['once only']);
    // The loser either read the turn before the winner claimed it (lost_claim) or after (none); never a second send.
    expect(outcomes.map(o => o.kind).sort()).toEqual(['dispatched', 'lost_claim']);
    expect((await drainHeldTurn(s2.id, d)).kind).toBe('none'); expect(d.sent).toHaveLength(1);
  });
  it('newer held turn supersedes the older; only the latest drains', async () => {
    const s = session(); const first = (await hold(s.id, 'first'))!; await hold(s.id, 'second'); const d = deps();
    expect((await held.get(first.id))?.status).toBe('superseded');
    await drainHeldTurn(s.id, d); expect(d.sent).toEqual(['second']);
  });
  it.each([
    ['cancelled', async (id: string, t: string) => { expect(await held.cancel(id, t)).toBe(true); }, 'none', null],
    ['archived', async (id: string) => { sessions.setArchived(id, true); }, 'rejected', 'session_unavailable'],
    ['foreign owner', async (id: string) => { db.prepare('UPDATE agent_sessions SET owner_user_id=? WHERE id=?').run(new UsersRepository().create({ name: 'Other', email: 'o@example.test' }).id, id); }, 'rejected', 'owner_changed'],
    ['auto mode off', async (id: string) => { db.prepare("UPDATE agent_sessions SET model_mode='fixed' WHERE id=?").run(id); }, 'rejected', 'auto_mode_off'],
    ['permission changed', async (id: string) => { db.prepare("UPDATE agent_sessions SET permission_mode='plan' WHERE id=?").run(id); }, 'rejected', 'profile_or_permission_changed'],
    ['Dayflow marker', async (id: string) => { db.prepare("UPDATE agent_sessions SET dayflow_context_nonreuse_code='dayflow_receiving_context_changed', dayflow_context_nonreuse_at=? WHERE id=?").run(new Date().toISOString(), id); }, 'rejected', 'dayflow_marker'],
    ['newer input (partly executed / moved on)', async (id: string) => { db.prepare("INSERT INTO agent_session_messages(session_id, role, raw_text, stripped_text, created_at) VALUES (?, 'input', 'x', 'x', ?)").run(id, new Date(Date.now() + 1000).toISOString()); }, 'superseded', 'superseded'],
    ['newer dispatch', async (id: string) => { const now = new Date(Date.now() + 1000).toISOString(); db.prepare("INSERT INTO agent_turn_dispatches(id, session_id, origin, requested_source, created_at, updated_at) VALUES ('d1', ?, 'prompt_api', 'auto', ?, ?)").run(id, now, now); }, 'superseded', 'superseded'],
  ])('%s is never sent', async (_label, mutate, kind, reason) => {
    const s = session(); const t = (await hold(s.id))!; await mutate(s.id, t.id); const d = deps();
    const out = await drainHeldTurn(s.id, d);
    expect(out.kind).toBe(kind); if (reason) expect(out).toMatchObject({ reason });
    expect(d.sent).toEqual([]);
  });
  it('rejectOnly resolves a dropped entry without dispatching, even when rechecks pass', async () => {
    const s = session(); await hold(s.id); const d = deps();
    expect(await drainHeldTurn(s.id, d, held, 'descriptor_dropped')).toMatchObject({ kind: 'rejected', reason: 'descriptor_dropped' });
    expect(d.sent).toEqual([]);
  });
  it('remote-classified held turn is not sent after remote-data consent is revoked', async () => {
    const s = session(); const t = (await hold(s.id))!;
    db.prepare("UPDATE agent_held_turns SET classification_source='decisions' WHERE id=?").run(t.id);
    const d = deps({ remoteConsent: () => false });
    expect(await drainHeldTurn(s.id, d)).toMatchObject({ kind: 'rejected', reason: 'consent_revoked' }); expect(d.sent).toEqual([]);
  });
  it('mobile turn with file parts needs the device and is not re-presented', async () => {
    const s = session();
    await recordHeldTurn({ sessionId: s.id, origin: 'mobile', inputText: 'see file', options: { parts: [{ type: 'text', text: 'see file' }, { type: 'file', url: 'x' }] } });
    const d = deps(); expect(await drainHeldTurn(s.id, d)).toMatchObject({ kind: 'rejected', reason: 'attachments_need_device' }); expect(d.sent).toEqual([]);
  });
  it('crash between claim and dispatch fails closed: surfaced as recovery_required, never re-claimed or re-sent', async () => {
    const s = session(); const t = (await hold(s.id))!;
    expect(await held.claim(t.id, new Date(Date.now() - 10 * 60_000).toISOString())).toBe(true); // claimed, then "crashed"
    const surfaced = await held.surfaceStaleClaims(new Date(Date.now() - 5 * 60_000).toISOString());
    expect(surfaced.map(x => x.id)).toEqual([t.id]);
    expect((await held.get(t.id))?.status).toBe('recovery_required');
    const d = deps(); expect((await drainHeldTurn(s.id, d)).kind).toBe('none'); expect(d.sent).toEqual([]);
  });
  it('dispatch error is recorded and never retried; a re-hold supersedes the claimed turn', async () => {
    const s = session(); await hold(s.id);
    const d = deps({ dispatch: async () => ['engine refused'] });
    expect(await drainHeldTurn(s.id, d)).toMatchObject({ kind: 'failed', reason: 'dispatch_error' });
    expect((await drainHeldTurn(s.id, d)).kind).toBe('none');
    const s2 = session(); await hold(s2.id);
    expect(await drainHeldTurn(s2.id, deps({ dispatch: async () => [HOLD] }))).toMatchObject({ kind: 'superseded', reason: 'held_again' });
  });
  it('session hard-delete removes its held turns (same retention as messages)', async () => {
    const s = session(); await hold(s.id);
    db.prepare('PRAGMA foreign_keys=ON').run(); db.prepare('DELETE FROM agent_sessions WHERE id=?').run(s.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_held_turns').get()).toEqual({ n: 0 });
  });
});
