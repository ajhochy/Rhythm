import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { RecipeWorkflowRepository } from '../repositories/recipe_workflow_repository';
import { AppError } from '../errors/app_error';
import { opencodeEventHub, type GlobalEventEnvelope } from './opencode_event_hub';
import { logger } from '../utils/logger';

export type NotifyKind = 'progress' | 'completion' | 'error' | 'approval-request' | 'question';
export interface HermesNotification {
  version: 1; eventId: string; cursor: number; sessionId: string;
  hermesSessionId: string; workflowId: string; kind: NotifyKind; text: string;
  referenceId: string | null; state: 'pending' | 'accepted' | 'visible';
}
export type HermesRunNotification = Omit<HermesNotification, 'version'> & { version: 2; runId: string };
interface RunOrigin { run_id: string; owner_user_id: number; session_id: string; hermes_session_id: string; stage_execution_id: string; state: string }
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
  private retry: ReturnType<typeof setTimeout> | null = null;
  private sessions = new AgentSessionsRepository();
  private workflows = new RecipeWorkflowRepository();
  private authority(owner: number, sessionId: string, workflowId: string) {
    const session = this.sessions.findById(sessionId);
    if (!session || session.ownerUserId !== owner) return null;
    const run = this.workflows.getRun(workflowId);
    const binding = this.sessions.getWorkflowBinding(sessionId);
    if (!run) return binding ? null : { run: null }; // Opaque legacy correlation, not terminal authority.
    if (run.ownerUserId !== owner || binding?.workflowRunId !== run.id ||
      !['pending','running','blocked_approval','blocked_reconciliation','succeeded','failed',
        'budget_exhausted','workflow_disabled','cancelled'].includes(run.status)) return null;
    const member = this.workflows.listStageExecutions(run.id).some(s =>
      s.id === binding.workflowStageExecutionId &&
      (s.provisionalSessionId === sessionId || s.committedSessionId === sessionId));
    return member ? { run } : null;
  }
  private originAuthority(sessionId: string) {
    const origin = getDb().prepare('SELECT owner_user_id,workflow_id FROM hermes_notify_origins WHERE session_id=?')
      .get(sessionId) as { owner_user_id: number; workflow_id: string } | undefined;
    return origin ? this.authority(origin.owner_user_id, sessionId, origin.workflow_id) : null;
  }
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
      CREATE TABLE IF NOT EXISTS hermes_notify_run_origins (
        run_id TEXT PRIMARY KEY REFERENCES recipe_workflow_runs(id),
        owner_user_id INTEGER, session_id TEXT UNIQUE REFERENCES hermes_notify_origins(session_id),
        hermes_session_id TEXT, stage_execution_id TEXT, state TEXT NOT NULL CHECK(state IN ('quarantined','active'))
      );
      INSERT OR IGNORE INTO hermes_notify_run_origins(run_id,state)
        SELECT DISTINCT r.id,'quarantined' FROM recipe_workflow_runs r
        JOIN hermes_notify_origins o ON o.workflow_id=r.id;
    `);
    // Additive dev-schema compatibility: an incomplete prior metadata row has no inferred authority.
    const columns = getDb().prepare('PRAGMA table_info(hermes_notify_run_origins)').all() as { name: string }[];
    if (!columns.some(c => c.name === 'stage_execution_id')) getDb().exec('ALTER TABLE hermes_notify_run_origins ADD COLUMN stage_execution_id TEXT');
    getDb().exec("UPDATE hermes_notify_run_origins SET state='quarantined' WHERE state='active' AND stage_execution_id IS NULL");
  }
  private runOrigin(runId: string): RunOrigin | undefined {
    return getDb().prepare('SELECT * FROM hermes_notify_run_origins WHERE run_id=?').get(runId) as RunOrigin | undefined;
  }
  private runAuthority(owner: number, runId: string) {
    const origin = this.runOrigin(runId);
    const run = this.workflows.getRun(runId);
    if (!origin || origin.state !== 'active' || origin.owner_user_id !== owner || run?.ownerUserId !== owner ||
      !['pending','running','blocked_approval','blocked_reconciliation','succeeded','failed',
        'budget_exhausted','workflow_disabled','cancelled'].includes(run.status)) return null;
    const stored = getDb().prepare('SELECT * FROM hermes_notify_origins WHERE session_id=?').get(origin.session_id) as
      { owner_user_id: number; workflow_id: string; hermes_session_id: string } | undefined;
    if (!stored || stored.owner_user_id !== owner || stored.workflow_id !== runId || stored.hermes_session_id !== origin.hermes_session_id) return null;
    const stages = this.workflows.listStageExecutions(runId);
    if (!stages.some(s => s.id === origin.stage_execution_id) || stages.some(s =>
      (s.provisionalSessionId !== null && s.committedSessionId !== null && s.provisionalSessionId !== s.committedSessionId) ||
      [s.provisionalSessionId,s.committedSessionId].some(id => id !== null &&
        (!s.attemptId || this.sessions.getWorkflowBinding(id)?.workflowStageExecutionId !== s.id || !this.authority(owner,id,runId))))) return null;
    return { run, origin };
  }
  /** Explicit authenticated run-owner authorization, never a session-derived grant.
   * The current attempt proves registry membership; the immutable journal anchor does not grant authority.
   */
  bindRun(owner: number, runId: string, sessionId: string, hermesSessionId: string): void {
    notifyId(runId); notifyId(sessionId); notifyId(hermesSessionId);
    getDb().transaction(() => {
      if (!this.authority(owner, sessionId, runId)?.run) throw AppError.notFound('Workflow');
      const binding = this.sessions.getWorkflowBinding(sessionId);
      if (!this.workflows.listStageExecutions(runId).some(s => s.id === binding?.workflowStageExecutionId && s.attemptId)) throw AppError.notFound('Workflow');
      const existing = this.runOrigin(runId);
      if (existing?.state === 'active') {
        if (!this.runAuthority(owner, runId)) throw AppError.notFound('Workflow');
        if (existing.hermes_session_id !== hermesSessionId) throw AppError.conflict('Run origin is immutable');
        return; // A new legitimate attempt is not a new conversation or a session rebind.
      }
      const legacy = getDb().prepare('SELECT * FROM hermes_notify_origins WHERE workflow_id=?').all(runId) as
        { session_id: string; owner_user_id: number; hermes_session_id: string }[];
      if (legacy.length > 1) throw AppError.conflict('Ambiguous legacy run origin');
      let anchor = sessionId, anchorStage = binding!.workflowStageExecutionId;
      if (legacy.length) {
        const old = legacy[0], binding = this.sessions.getWorkflowBinding(old.session_id);
        if (old.owner_user_id !== owner || this.sessions.findById(old.session_id)?.ownerUserId !== owner ||
          binding?.workflowRunId !== runId || !this.workflows.listStageExecutions(runId).some(s => s.id === binding.workflowStageExecutionId)) {
          throw AppError.conflict('Legacy run origin quarantined');
        }
        if (old.hermes_session_id !== hermesSessionId) throw AppError.conflict('Run origin is immutable');
        anchor = old.session_id; // Explicit owner activation retains the exact legacy tuple and journal.
        anchorStage = binding!.workflowStageExecutionId;
      } else {
        this.bind(owner, sessionId, hermesSessionId, runId);
      }
      getDb().prepare(`INSERT INTO hermes_notify_run_origins(run_id,owner_user_id,session_id,hermes_session_id,stage_execution_id,state)
        VALUES (?,?,?,?,?,'active') ON CONFLICT(run_id) DO UPDATE SET
        owner_user_id=excluded.owner_user_id,session_id=excluded.session_id,hermes_session_id=excluded.hermes_session_id,
        stage_execution_id=excluded.stage_execution_id,state='active'
        WHERE hermes_notify_run_origins.state='quarantined'`).run(runId,owner,anchor,hermesSessionId,anchorStage);
    })();
    this.changes.emit('change');
  }
  listRun(owner: number, runId: string, after = 0): HermesRunNotification[] {
    const authority = this.runAuthority(owner, runId);
    if (!authority) throw AppError.notFound('Workflow');
    this.syncWorkflows(owner);
    return getDb().prepare(`SELECT 2 AS version,? AS runId,e.event_id AS eventId,e.cursor,o.session_id AS sessionId,
      o.hermes_session_id AS hermesSessionId,o.workflow_id AS workflowId,e.kind,e.text,e.reference_id AS referenceId,e.state
      FROM hermes_notify_events e JOIN hermes_notify_origins o ON o.session_id=e.session_id
      WHERE e.session_id=? AND e.state!='visible' AND e.cursor>? ORDER BY e.cursor LIMIT 100`)
      .all(runId,authority.origin.session_id,after) as HermesRunNotification[];
  }
  ackRun(owner: number, runId: string, eventId: string, state: 'accepted' | 'visible'): void {
    getDb().transaction(() => {
      const authority = this.runAuthority(owner, runId);
      if (!authority) throw AppError.notFound('Notification');
      const result = getDb().prepare(`UPDATE hermes_notify_events SET state=CASE WHEN state='visible' THEN state ELSE ? END
        WHERE event_id=? AND session_id=?`).run(state,eventId,authority.origin.session_id);
      if (!result.changes) throw AppError.notFound('Notification');
    })();
  }
  bind(owner: number, sessionId: string, hermesSessionId: string, workflowId: string): void {
    const session = this.sessions.findById(sessionId);
    if (!session || session.ownerUserId !== owner) throw AppError.notFound('AgentSession');
    const authority = this.authority(owner, sessionId, workflowId);
    if (!authority) throw AppError.notFound('Workflow');
    const { run } = authority;
    const db = getDb();
    db.transaction(() => {
      if (run && db.prepare('SELECT session_id FROM hermes_notify_origins WHERE workflow_id=? AND session_id!=?')
        .get(workflowId, sessionId)) throw AppError.conflict('Workflow origin is immutable');
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
    if (!this.originAuthority(sessionId)) return;
    if (getDb().prepare("SELECT 1 FROM hermes_notify_run_origins WHERE session_id=? AND state='active'").get(sessionId)) return;
    this.store(sessionId, source, kind, reference, text);
  }
  private store(sessionId: string, source: string, kind: NotifyKind, reference: string | null, text = labels[kind]): void {
    // Only server-generated labels and opaque references cross this trust boundary.
    const result = getDb().prepare(`INSERT OR IGNORE INTO hermes_notify_events(event_id,session_id,source_key,kind,text,reference_id)
      SELECT ?,session_id,?,?,?,? FROM hermes_notify_origins WHERE session_id=?`)
      .run(randomUUID(), createHash('sha256').update(source).digest('hex'), kind, text, reference, sessionId);
    if (result.changes) queueMicrotask(() => this.changes.emit('change'));
  }
  list(owner: number, after = 0): HermesNotification[] {
    this.syncWorkflows(owner);
    const events = getDb().prepare(`SELECT 1 AS version,e.event_id AS eventId,e.cursor,o.session_id AS sessionId,
      o.hermes_session_id AS hermesSessionId,o.workflow_id AS workflowId,e.kind,e.text,
      e.reference_id AS referenceId,e.state FROM hermes_notify_events e
      JOIN hermes_notify_origins o ON o.session_id=e.session_id
       JOIN agent_sessions s ON s.id=o.session_id
       WHERE o.owner_user_id=? AND s.owner_user_id=? AND e.state!='visible' AND e.cursor>?
       AND NOT EXISTS (SELECT 1 FROM hermes_notify_run_origins r WHERE r.session_id=o.session_id AND r.state='active')
      ORDER BY e.cursor LIMIT 100`).all(owner, owner, after) as HermesNotification[];
    return events.filter(e => this.runOrigin(e.workflowId)?.state !== 'active' && this.authority(owner, e.sessionId, e.workflowId));
  }
  // Delivery projection only: the existing registry owns lifecycle, attempts and joins.
  // ponytail: recover current durable state on SSE flush/replay, not a second run tracker.
  private syncWorkflows(owner: number): void {
    const origins = getDb().prepare(`SELECT session_id,workflow_id FROM hermes_notify_origins WHERE owner_user_id=?`)
      .all(owner) as { session_id: string; workflow_id: string }[];
    getDb().transaction(() => {
      for (const origin of origins) {
        const active = this.runOrigin(origin.workflow_id)?.state === 'active';
        const run = active ? this.runAuthority(owner, origin.workflow_id)?.run : this.authority(owner, origin.session_id, origin.workflow_id)?.run;
        if (!run) continue;
        const stages = this.workflows.listStageExecutions(run.id);
        const definitions = Array.isArray(run.definition?.stages) ? run.definition.stages : [];
        const kinds = new Map(definitions.flatMap(s => s?.kind === 'fanOut'
          ? [s, ...(Array.isArray(s.stages) ? s.stages : [])] : [s]).map(s => [s?.id, s?.kind]));
        const awaiting = stages.filter(s => !['succeeded','failed','cancelled'].includes(s.status)).length;
        const settled = stages.length - awaiting;
        // A terminal registry row with outstanding children is not an aggregate terminal.
        const terminal = ['succeeded','failed','budget_exhausted','workflow_disabled','cancelled'].includes(run.status);
        const success = run.status === 'succeeded' && !run.pendingApprovalId && !run.cancelledAt &&
          awaiting === 0 && stages.length > 0 &&
          stages.every(s => s.status === 'succeeded' && (kinds.get(s.stageId) === 'gate'
            ? s.outcome === 'pass'
            : ['agent','approval','fanOut'].includes(kinds.get(s.stageId) ?? '') &&
              (s.outcome === null || s.outcome === 'pass')));
        // Pending references are unresolved here, even if a contradictory row says succeeded.
        const status = run.pendingApprovalId ? 'blocked_approval' : terminal && (awaiting > 0 || (run.status === 'succeeded' && !success))
          ? 'awaiting_children' : run.status;
        const kind: NotifyKind = status === 'blocked_approval' ? 'approval-request' : success ? 'completion' :
          terminal && status !== 'awaiting_children' ? 'error' : 'progress';
        const reference = kind === 'approval-request' && run.pendingApprovalId ? notifyId(run.pendingApprovalId) : null;
        // Exclude usage, model output and timestamps: tokens never become progress events.
        const source = JSON.stringify(['workflow',run.id,run.status,status,run.pendingApprovalId,Boolean(run.cancelledAt),reference,
          stages.map(s => [s.id,s.stageId,kinds.get(s.stageId),s.status,s.attemptCount,s.attemptId,s.outcome])]);
        this.store(origin.session_id, source, kind, reference,
          `Rhythm workflow ${status}: ${settled} settled, ${awaiting} awaiting.`);
      }
    })();
  }
  ack(owner: number, eventId: string, state: 'accepted' | 'visible'): void {
    const origin = getDb().prepare(`SELECT o.session_id,o.workflow_id FROM hermes_notify_events e
      JOIN hermes_notify_origins o ON o.session_id=e.session_id WHERE e.event_id=? AND o.owner_user_id=?`)
      .get(eventId, owner) as { session_id: string; workflow_id: string } | undefined;
    if (!origin || this.runOrigin(origin.workflow_id)?.state === 'active' || !this.authority(owner, origin.session_id, origin.workflow_id)) throw AppError.notFound('Notification');
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
    const binding = this.sessions.getWorkflowBinding(session.id);
    const ownOrigin = getDb().prepare('SELECT workflow_id FROM hermes_notify_origins WHERE session_id=?').get(session.id) as
      { workflow_id: string } | undefined;
    if (ownOrigin && !this.originAuthority(session.id)) return;
    const linked = this.workflows.getRun(binding?.workflowRunId ?? ownOrigin?.workflow_id ?? '');
    if (linked) {
      // Route child signals to the immutable run origin, never to the latest parent.
      if (linked.ownerUserId === null || !this.authority(linked.ownerUserId, session.id, linked.id)) return;
      this.syncWorkflows(linked.ownerUserId);
      if (payload.type === 'question.asked' || payload.type === 'permission.asked' || payload.type === 'session.error') {
        const origins = getDb().prepare(`SELECT session_id FROM hermes_notify_origins WHERE workflow_id=? AND owner_user_id=?`)
          .all(linked.id, linked.ownerUserId) as { session_id: string }[];
        const reference = payload.type === 'session.error' ? null : notifyId(p.id);
        const kind: NotifyKind = payload.type === 'question.asked' ? 'question' :
          payload.type === 'permission.asked' ? 'approval-request' : 'error';
        for (const origin of origins) {
          const active = this.runOrigin(linked.id)?.state === 'active';
          if (active ? !this.runAuthority(linked.ownerUserId,linked.id) : !this.originAuthority(origin.session_id)) continue;
          this.store(origin.session_id,
            `${session.id}:${payload.type}:${reference ?? binding?.workflowStageExecutionId ?? linked.id}`, kind, reference);
        }
      }
      return; // In particular, session idle is NOT workflow completion.
    }
    if (binding) return; // Missing workflow registry never falls back to legacy activity.
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
        // An opaque correlation ID is not lifecycle authority; idle only means settled engine activity.
        this.append(session.id, `idle:${origin.turn}`, 'progress');
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
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const sub = opencodeEventHub.subscribe(512);
    this.subscription = sub;
    void (async () => {
      try {
        for await (const envelope of sub.stream) {
          if (this.subscription !== sub) break;
          try { getDb().transaction(() => this.ingest(envelope))(); } catch { logger.warn('[HermesNotify] notification persistence failed'); }
        }
      } finally {
        sub.close();
        if (this.subscription === sub) {
          this.subscription = null;
          // No per-token wakeups; reconnect only on bounded hub overflow/closure.
          this.retry = setTimeout(() => { this.retry = null; this.start(); }, 1000);
          this.retry.unref();
        }
      }
    })();
  }
  stop(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const sub = this.subscription;
    this.subscription = null;
    sub?.close();
  }
}
export const hermesNotifyService = new HermesNotifyService();
