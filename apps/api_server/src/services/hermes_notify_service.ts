import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AppError } from '../errors/app_error';
import { opencodeEventHub, type GlobalEventEnvelope } from './opencode_event_hub';
import { logger } from '../utils/logger';

export type NotifyKind = 'progress' | 'completion' | 'error' | 'approval-request' | 'question';
export interface HermesNotification {
  version: 1; eventId: string; cursor: number; sessionId: string;
  hermesSessionId: string; workflowId: string; kind: NotifyKind; text: string;
  referenceId: string | null; state: 'pending' | 'accepted' | 'visible';
}
const labels: Record<NotifyKind, string> = {
  progress: 'Rhythm session updated.', completion: 'Rhythm session completed.',
  error: 'Rhythm session reported an error.', 'approval-request': 'Rhythm session needs approval. Open the Rhythm card.',
  question: 'Rhythm session has a question. Open the Rhythm session.',
};
export function notifyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw AppError.badRequest('Invalid notification identifier');
  }
  return value;
}

// Local engine data only. No Postgres bootstrap or approval tables are touched.
export class HermesNotifyService {
  readonly changes = new EventEmitter();
  private subscription: ReturnType<typeof opencodeEventHub.subscribe> | null = null;
  private sessions = new AgentSessionsRepository();
  initialize(): void {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS hermes_notify_origins (
        session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
        owner_user_id INTEGER NOT NULL, hermes_session_id TEXT NOT NULL, workflow_id TEXT NOT NULL,
        turn INTEGER NOT NULL DEFAULT 0, working INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS hermes_notify_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL REFERENCES hermes_notify_origins(session_id) ON DELETE CASCADE,
        source_key TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, reference_id TEXT,
        state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','visible')),
        UNIQUE(session_id, source_key)
      );
      CREATE INDEX IF NOT EXISTS hermes_notify_pending ON hermes_notify_events(state,cursor);
    `);
  }
  bind(owner: number, sessionId: string, hermesSessionId: string, workflowId: string): void {
    const session = this.sessions.findById(sessionId);
    if (!session || session.ownerUserId !== owner) throw AppError.notFound('AgentSession');
    const db = getDb();
    db.transaction(() => {
      const existing = db.prepare('SELECT * FROM hermes_notify_origins WHERE session_id=?').get(sessionId) as
        { owner_user_id: number; hermes_session_id: string; workflow_id: string } | undefined;
      if (existing && (existing.owner_user_id !== owner || existing.hermes_session_id !== hermesSessionId || existing.workflow_id !== workflowId)) {
        throw AppError.conflict('Origin is immutable');
      }
      db.prepare(`INSERT OR IGNORE INTO hermes_notify_origins(session_id,owner_user_id,hermes_session_id,workflow_id)
        VALUES (?,?,?,?)`).run(sessionId, owner, hermesSessionId, workflowId);
      this.append(sessionId, 'linked', 'progress', null, 'Rhythm session linked.');
    })();
    this.changes.emit('change');
  }
  append(sessionId: string, source: string, kind: NotifyKind, reference: string | null = null, text = labels[kind]): void {
    // Only server-generated labels and opaque references cross this trust boundary.
    const result = getDb().prepare(`INSERT OR IGNORE INTO hermes_notify_events(event_id,session_id,source_key,kind,text,reference_id)
      SELECT ?,session_id,?,?,?,? FROM hermes_notify_origins WHERE session_id=?`)
      .run(randomUUID(), createHash('sha256').update(source).digest('hex'), kind, text, reference, sessionId);
    if (result.changes) queueMicrotask(() => this.changes.emit('change'));
  }
  list(owner: number, after = 0): HermesNotification[] {
    return getDb().prepare(`SELECT 1 AS version,e.event_id AS eventId,e.cursor,o.session_id AS sessionId,
      o.hermes_session_id AS hermesSessionId,o.workflow_id AS workflowId,e.kind,e.text,
      e.reference_id AS referenceId,e.state FROM hermes_notify_events e
      JOIN hermes_notify_origins o ON o.session_id=e.session_id
      JOIN agent_sessions s ON s.id=o.session_id
      WHERE o.owner_user_id=? AND s.owner_user_id=? AND e.state!='visible' AND e.cursor>?
      ORDER BY e.cursor LIMIT 100`).all(owner, owner, after) as HermesNotification[];
  }
  ack(owner: number, eventId: string, state: 'accepted' | 'visible'): void {
    const result = getDb().prepare(`UPDATE hermes_notify_events SET state=CASE WHEN state='visible' THEN state ELSE ? END
      WHERE event_id=? AND session_id IN (SELECT o.session_id FROM hermes_notify_origins o
      JOIN agent_sessions s ON s.id=o.session_id WHERE o.owner_user_id=? AND s.owner_user_id=?)`)
      .run(state, eventId, owner, owner);
    if (!result.changes) throw AppError.notFound('Notification');
  }
  ingest(envelope: GlobalEventEnvelope): void {
    const payload = envelope.payload as { type?: string; properties?: Record<string, any> } | undefined;
    if (!payload?.type || !payload.properties) return;
    const p = payload.properties;
    const sdkId = p.sessionID ?? p.info?.id;
    if (typeof sdkId !== 'string') return;
    const session = this.sessions.findBySdkSessionId(sdkId);
    if (!session) return;
    const db = getDb();
    const origin = db.prepare('SELECT turn,working FROM hermes_notify_origins WHERE session_id=?').get(session.id) as
      { turn: number; working: number } | undefined;
    if (!origin) return;
    if (payload.type === 'session.status') {
      const working = p.status?.type === 'busy';
      if (working && !origin.working) {
        db.prepare('UPDATE hermes_notify_origins SET turn=turn+1,working=1 WHERE session_id=?').run(session.id);
        this.append(session.id, `busy:${origin.turn+1}`, 'progress');
      } else if (p.status?.type === 'idle' && origin.working) {
        db.prepare('UPDATE hermes_notify_origins SET working=0 WHERE session_id=?').run(session.id);
        this.append(session.id, `idle:${origin.turn}`, 'completion');
      }
    } else if (payload.type === 'session.updated') {
      this.append(session.id, `updated:${String(p.info?.title ?? '')}`, 'progress');
    } else if (payload.type === 'session.error') {
      this.append(session.id, `error:${origin.turn}:${JSON.stringify(p.error)}`, 'error');
    } else if (payload.type === 'question.asked' || payload.type === 'permission.asked') {
      const reference = notifyId(p.id);
      this.append(session.id, `${payload.type}:${reference}`, payload.type === 'question.asked' ? 'question' : 'approval-request', reference);
    }
  }
  start(): void {
    if (this.subscription) return;
    const sub = opencodeEventHub.subscribe(512);
    this.subscription = sub;
    void (async () => {
      try {
        for await (const envelope of sub.stream) {
          try { getDb().transaction(() => this.ingest(envelope))(); } catch { logger.warn('[HermesNotify] notification persistence failed'); }
        }
      } finally {
        sub.close(); this.subscription = null;
        // No per-token wakeups; reconnect only on bounded hub overflow/closure.
        const retry = setTimeout(() => this.start(), 1000); retry.unref();
      }
    })();
  }
}
export const hermesNotifyService = new HermesNotifyService();
