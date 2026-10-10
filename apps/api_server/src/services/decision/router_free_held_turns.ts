import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { getDb, getPostgresPool } from '../../database/db';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { RouterGridAttemptsRepository } from './router_grid_attempts_repository';

/**
 * Free Mode held turns (D1/D3): the owner-scoped ORIGINAL input of a turn that Free Mode held before any
 * engine dispatch. Body-bearing on purpose and therefore separate from the body-free Free queue and the
 * attempts ledger; rows go with their session (ON DELETE CASCADE), like agent_session_messages.
 */
export type HeldTurnStatus = 'pending' | 'claimed' | 'dispatched' | 'superseded' | 'cancelled' | 'rejected' | 'recovery_required' | 'failed';
export type HeldTurnOrigin = 'desktop' | 'prompt_api' | 'mobile';
export interface HeldTurnOptions { modelOverride?: unknown; thinking?: unknown; fastMode?: boolean; agent?: string | null; parts?: unknown[] }
export interface HeldTurn {
  id: string; sessionId: string; ownerUserId: number | null; origin: HeldTurnOrigin; inputText: string; options: HeldTurnOptions;
  profileId: string | null; permissionMode: string | null; classificationSource: 'decisions' | 'rules' | null;
  status: HeldTurnStatus; reason: string | null; dispatchId: string | null; createdAt: string; updatedAt: string;
}
export type HeldTurnSummary = Omit<HeldTurn, 'inputText' | 'options'>;
export const HELD_CLAIM_STALE_MS = 5 * 60_000;

const pg = () => env.dbClient === 'postgres';
async function rows<T>(sql: string, params: unknown[]): Promise<T[]> {
  if (pg()) { let i = 0; return (await getPostgresPool().query(sql.replace(/\?/g, () => `$${++i}`), params as unknown[])).rows as T[]; }
  return getDb().prepare(sql).all(...params) as T[];
}
async function exec(sql: string, params: unknown[]): Promise<number> {
  if (pg()) { let i = 0; return (await getPostgresPool().query(sql.replace(/\?/g, () => `$${++i}`), params as unknown[])).rowCount ?? 0; }
  return getDb().prepare(sql).run(...params).changes;
}
type Row = Record<string, unknown>;
function toTurn(r: Row): HeldTurn {
  return { id: String(r.id), sessionId: String(r.session_id), ownerUserId: r.owner_user_id == null ? null : Number(r.owner_user_id),
    origin: r.origin as HeldTurnOrigin, inputText: String(r.input_text), options: JSON.parse(String(r.options_json)) as HeldTurnOptions,
    profileId: (r.profile_id as string | null) ?? null, permissionMode: (r.permission_mode as string | null) ?? null,
    classificationSource: (r.classification_source as HeldTurn['classificationSource']) ?? null, status: r.status as HeldTurnStatus,
    reason: (r.reason as string | null) ?? null, dispatchId: (r.dispatch_id as string | null) ?? null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}
const summary = ({ inputText: _t, options: _o, ...rest }: HeldTurn): HeldTurnSummary => rest;

export class HeldTurnsRepository {
  /** A newer held turn in the same session supersedes any older pending one (only the latest can drain). */
  async insert(t: Omit<HeldTurn, 'id' | 'status' | 'reason' | 'dispatchId' | 'createdAt' | 'updatedAt'>, now = new Date().toISOString()): Promise<HeldTurn> {
    await exec(`UPDATE agent_held_turns SET status='superseded', reason='newer_held_turn', updated_at=? WHERE session_id=? AND status='pending'`, [now, t.sessionId]);
    const id = randomUUID();
    await exec(`INSERT INTO agent_held_turns (id,session_id,owner_user_id,origin,input_text,options_json,profile_id,permission_mode,
      classification_source,status,reason,dispatch_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,?,?)`,
    [id, t.sessionId, t.ownerUserId, t.origin, t.inputText, JSON.stringify(t.options), t.profileId, t.permissionMode, t.classificationSource, now, now]);
    return (await this.get(id))!;
  }
  async get(id: string): Promise<HeldTurn | null> {
    const [r] = await rows<Row>('SELECT * FROM agent_held_turns WHERE id=?', [id]);
    return r ? toTurn(r) : null;
  }
  async latestPending(sessionId: string): Promise<HeldTurn | null> {
    const [r] = await rows<Row>(`SELECT * FROM agent_held_turns WHERE session_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1`, [sessionId]);
    return r ? toTurn(r) : null;
  }
  async list(sessionId: string): Promise<HeldTurnSummary[]> {
    return (await rows<Row>('SELECT * FROM agent_held_turns WHERE session_id=? ORDER BY created_at', [sessionId])).map(r => summary(toTurn(r)));
  }
  /** Atomic once-only claim: exactly one caller can move a turn out of pending. */
  async claim(id: string, now = new Date().toISOString()): Promise<boolean> {
    return (await exec(`UPDATE agent_held_turns SET status='claimed', updated_at=? WHERE id=? AND status='pending'`, [now, id])) === 1;
  }
  async finish(id: string, status: 'dispatched' | 'superseded' | 'rejected' | 'failed', reason: string | null, dispatchId: string | null = null): Promise<boolean> {
    return (await exec(`UPDATE agent_held_turns SET status=?, reason=?, dispatch_id=?, updated_at=? WHERE id=? AND status='claimed'`,
      [status, reason, dispatchId, new Date().toISOString(), id])) === 1;
  }
  async cancel(sessionId: string, id: string): Promise<boolean> {
    return (await exec(`UPDATE agent_held_turns SET status='cancelled', reason='user_cancelled', updated_at=? WHERE id=? AND session_id=? AND status='pending'`,
      [new Date().toISOString(), id, sessionId])) === 1;
  }
  /** Crash between claim and dispatch: surface for the user, never re-claim or re-send. */
  async surfaceStaleClaims(before: string): Promise<HeldTurn[]> {
    const stale = (await rows<Row>(`SELECT * FROM agent_held_turns WHERE status='claimed' AND updated_at < ?`, [before])).map(toTurn);
    const surfaced: HeldTurn[] = [];
    for (const t of stale) {
      if ((await exec(`UPDATE agent_held_turns SET status='recovery_required', reason='claim_not_confirmed', updated_at=? WHERE id=? AND status='claimed'`,
        [new Date().toISOString(), t.id])) === 1) surfaced.push(t);
    }
    return surfaced;
  }
  async dayflowMarked(sessionId: string): Promise<boolean> {
    const [r] = await rows<Row>('SELECT dayflow_context_nonreuse_code AS c, dayflow_context_nonreuse_at AS a FROM agent_sessions WHERE id=?', [sessionId]);
    return !!r && (r.c != null || r.a != null);
  }
  /** Any input or dispatch recorded after the hold means the conversation moved on. */
  async newerActivity(sessionId: string, since: string): Promise<boolean> {
    const [m] = await rows<Row>(`SELECT COUNT(*) AS n FROM agent_session_messages WHERE session_id=? AND role='input' AND created_at > ?`, [sessionId, since]);
    const [d] = await rows<Row>('SELECT COUNT(*) AS n FROM agent_turn_dispatches WHERE session_id=? AND created_at > ?', [sessionId, since]);
    return Number(m?.n ?? 0) + Number(d?.n ?? 0) > 0;
  }
  async dispatchSince(sessionId: string, since: string): Promise<string | null> {
    const [r] = await rows<Row>('SELECT id FROM agent_turn_dispatches WHERE session_id=? AND created_at >= ? ORDER BY created_at DESC LIMIT 1', [sessionId, since]);
    return r ? String(r.id) : null;
  }
}

/** D2 writer, called only on a Free hold (before dispatch). Snapshot of the authority the turn was held under. */
export async function recordHeldTurn(input: { sessionId: string; origin: HeldTurnOrigin; inputText: string; options: HeldTurnOptions }): Promise<HeldTurn | null> {
  const session = new AgentSessionsRepository().findById(input.sessionId);
  if (!session) return null;
  const classification = await new RouterGridAttemptsRepository().readFreeQueued(input.sessionId).catch(() => null);
  return new HeldTurnsRepository().insert({ sessionId: session.id, ownerUserId: session.ownerUserId ?? null, origin: input.origin,
    inputText: input.inputText, options: input.options, profileId: session.profileId ?? null, permissionMode: session.permissionMode ?? null,
    classificationSource: classification?.source ?? null });
}

export type DrainOutcome = { kind: 'none' } | { kind: 'lost_claim'; id: string } | { kind: 'dispatched'; id: string; dispatchId: string | null }
  | { kind: 'rejected' | 'superseded' | 'failed'; id: string; reason: string };
export interface DrainDeps {
  /** Existing dispatch entrypoint (handleInputFrame via the prompt-route socket shim); returns gateway error messages. */
  dispatch(turn: HeldTurn): Promise<string[]>;
  notify(sessionId: string, message: string): Promise<void>;
  remoteConsent(): boolean;
  holdMessage: string;
}

async function recheck(repo: HeldTurnsRepository, t: HeldTurn, deps: DrainDeps): Promise<string | null> {
  const s = new AgentSessionsRepository().findById(t.sessionId);
  if (!s || s.archivedAt || s.status === 'closed') return 'session_unavailable';
  if ((s.ownerUserId ?? null) !== t.ownerUserId) return 'owner_changed';
  if (s.modelMode !== 'auto') return 'auto_mode_off';
  if ((s.profileId ?? null) !== t.profileId || (s.permissionMode ?? null) !== t.permissionMode) return 'profile_or_permission_changed';
  if (await repo.dayflowMarked(s.id)) return 'dayflow_marker';
  if (await repo.newerActivity(s.id, t.createdAt)) return 'superseded';
  if (t.classificationSource === 'decisions' && !deps.remoteConsent()) return 'consent_revoked';
  if (t.origin === 'mobile' && (t.options.parts ?? []).some(p => (p as { type?: unknown })?.type !== 'text')) return 'attachments_need_device';
  return null;
}

/** D3: drain the latest pending held turn of one session exactly once through the existing dispatch path. */
/** rejectOnly: resolve a pending held turn whose queue entry was dropped (gone/foreign target); never dispatches. */
export async function drainHeldTurn(sessionId: string, deps: DrainDeps, repo = new HeldTurnsRepository(), rejectOnly?: string): Promise<DrainOutcome> {
  const t = await repo.latestPending(sessionId);
  if (!t) return { kind: 'none' };
  const claimedAt = new Date().toISOString();
  if (!(await repo.claim(t.id, claimedAt))) return { kind: 'lost_claim', id: t.id };
  const reason = (await recheck(repo, t, deps)) ?? rejectOnly ?? null;
  if (reason) {
    const kind = reason === 'superseded' ? 'superseded' : 'rejected';
    await repo.finish(t.id, kind, reason);
    await deps.notify(sessionId, `Your held request was not sent (${reason}). Send it again if you still need it.`).catch(() => undefined);
    return { kind, id: t.id, reason };
  }
  let errors: string[];
  try { errors = await deps.dispatch(t); } catch { errors = ['dispatch_threw']; }
  if (errors.length > 0) {
    // Never retried automatically. Held again = a new pending held turn was recorded by the hold path.
    const again = errors.includes(deps.holdMessage);
    await repo.finish(t.id, again ? 'superseded' : 'failed', again ? 'held_again' : 'dispatch_error');
    if (!again) await deps.notify(sessionId, 'Your held request could not be sent. Send it again if you still need it.').catch(() => undefined);
    return { kind: again ? 'superseded' : 'failed', id: t.id, reason: again ? 'held_again' : 'dispatch_error' };
  }
  const dispatchId = await repo.dispatchSince(sessionId, claimedAt);
  await repo.finish(t.id, 'dispatched', null, dispatchId);
  return { kind: 'dispatched', id: t.id, dispatchId };
}
