import { Router } from 'express';
import { requireAuth, requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import { hermesNotifyService as service, notifyId, type HermesNotification, type HermesRunNotification } from '../services/hermes_notify_service';

const wireLabels = {
  progress: ['Rhythm session linked.', 'Rhythm session updated.'],
  completion: ['Rhythm session completed.'],
  error: ['Rhythm session reported an error.'],
  'approval-request': ['Rhythm session needs approval. Open the Rhythm card.'],
  question: ['Rhythm session has a question. Open the Rhythm session.'],
};

/** Pure delivery projection. Internal engine metadata is not public action authority. */
export function projectHermesNotification(event: HermesNotification | HermesRunNotification) {
  const fields = ['version','eventId','cursor','sessionId','hermesSessionId','workflowId','kind','text','referenceId','state',
    ...(event.version === 2 ? ['runId'] : [])];
  const invalid = () => { throw new AppError(500, 'INVALID_NOTIFICATION', 'Invalid notification envelope'); };
  if (![1,2].includes(event.version) || fields.some(k => !Object.hasOwn(event,k)) ||
    Object.keys(event).some(k => !fields.includes(k) && k !== 'engineRequestID')) invalid();
  for (const id of [event.eventId,event.sessionId,event.hermesSessionId,event.workflowId,
    ...(event.referenceId === null ? [] : [event.referenceId]),
    ...('runId' in event ? [event.runId] : [])]) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) invalid();
  }
  if (!Number.isSafeInteger(event.cursor) || event.cursor <= 0 || event.cursor >= 10 ** 15 ||
    !['pending','accepted','visible'].includes(event.state) || !Object.hasOwn(wireLabels,event.kind) ||
    (event.version === 2 && event.runId !== event.workflowId) ||
    (['question','approval-request'].includes(event.kind) && event.referenceId === null)) invalid();
  // Coding output remains progress, never verified success. Only these exact internal labels map.
  const text = event.kind === 'progress' && event.text === 'Rhythm returned output; verification pending.'
    ? 'Rhythm session updated.' : event.kind === 'completion' && event.text === 'Rhythm agent execution completed.'
      ? 'Rhythm session completed.' : event.text;
  if (!wireLabels[event.kind].includes(text)) {
    const workflow = typeof text === 'string' && /^Rhythm workflow (pending|running|blocked_approval|blocked_reconciliation|awaiting_children|succeeded|failed|budget_exhausted|workflow_disabled|cancelled): ([0-9]{1,9}) settled, ([0-9]{1,9}) awaiting\.$/.exec(text);
    if (!workflow) return null; // Withhold unknown prose; never substitute a generic label.
    const [,status,settled,awaiting] = workflow;
    const kind = status === 'succeeded' ? 'completion' : ['failed','budget_exhausted','workflow_disabled','cancelled'].includes(status)
      ? 'error' : status === 'blocked_approval' ? 'approval-request' : 'progress';
    if (event.kind !== kind || (['completion','error'].includes(kind) && Number(awaiting) !== 0) ||
      (status === 'succeeded' && Number(settled) === 0)) return null;
  }
  const { engineRequestID: _internal, ...wire } = event;
  return { ...wire, text };
}

const wireEvents = (events: (HermesNotification | HermesRunNotification)[]) =>
  events.flatMap(event => { const wire = projectHermesNotification(event); return wire ? [wire] : []; });

export function createHermesNotifyRouter(): Router {
  const router = Router();
  router.use(env.agentLocal ? requireLocalOrCloudAuth : requireAuth); // Bearer required in both modes.
  router.get('/identity', (req, res) => {
    res.json({ version: 1, ownerUserId: req.auth!.user.id });
  });
  router.use((req, _res, next) => {
    if (req.method === 'POST' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      next(AppError.badRequest('Notification body must be an object')); return;
    }
    next();
  });
  router.post('/origins', (req, res, next) => {
    try {
      if (Object.keys(req.body).some(k => !['sessionId','hermesSessionId','workflowId'].includes(k))) throw AppError.badRequest('Unknown origin field');
      service.bind(req.auth!.user.id, notifyId(req.body.sessionId), notifyId(req.body.hermesSessionId), notifyId(req.body.workflowId));
      res.status(201).json({ version: 1 });
    } catch (err) { next(err); }
  });
  router.post('/subscriptions', (req,res,next) => {
    try {
      if (Object.keys(req.body).some(k => !['sourceKind','sourceId','hermesSessionId','profile'].includes(k)) ||
        !['agent_session','workflow_run'].includes(req.body.sourceKind)) throw AppError.badRequest('Unknown subscription field/source kind');
      res.status(201).json(service.subscribe(req.auth!.user.id,req.body.sourceKind,notifyId(req.body.sourceId),notifyId(req.body.hermesSessionId),req.body.profile ?? 'default'));
    } catch(error){next(error);}
  });
  router.post('/subscriptions/disable', (req,res,next) => {
    try {
      if (Object.keys(req.body).some(k => !['sourceKind','sourceId'].includes(k)) ||
        !['agent_session','workflow_run'].includes(req.body.sourceKind)) throw AppError.badRequest('Unknown subscription field/source kind');
      res.json(service.unsubscribe(req.auth!.user.id,req.body.sourceKind,notifyId(req.body.sourceId)));
    } catch(error){next(error);}
  });
  const cursor = (value: unknown): number => {
    if (value === undefined) return 0;
    if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) throw AppError.badRequest('Invalid cursor');
    return Number(value);
  };
  // V2 is explicit run-owner authorization. V1 never inherits this history/ACK power.
  router.post('/runs/:runId/origin', (req, res, next) => {
    try {
      if (Object.keys(req.body).some(k => !['sessionId','hermesSessionId'].includes(k))) throw AppError.badRequest('Unknown origin field');
      service.bindRun(req.auth!.user.id,notifyId(req.params.runId),notifyId(req.body.sessionId),notifyId(req.body.hermesSessionId));
      res.status(201).json({version:2,runId:req.params.runId});
    } catch (err) { next(err); }
  });
  router.get('/runs/:runId/events', (req, res, next) => {
    try { res.json({version:2,runId:notifyId(req.params.runId),events:wireEvents(service.listRun(req.auth!.user.id,req.params.runId,cursor(req.query.after)))}); }
    catch (err) { next(err); }
  });
  router.post('/runs/:runId/ack', (req, res, next) => {
    try {
      if (Object.keys(req.body).some(k => !['eventId','state'].includes(k)) || !['accepted','visible'].includes(req.body.state)) throw AppError.badRequest('ACK state must be accepted or visible');
      service.ackRun(req.auth!.user.id,notifyId(req.params.runId),notifyId(req.body.eventId),req.body.state);
      res.json({version:2,runId:req.params.runId,state:req.body.state});
    } catch (err) { next(err); }
  });
  router.get('/events', (req, res, next) => {
    try { res.json({ version: 1, events: wireEvents(service.list(req.auth!.user.id, cursor(req.query.after))) }); }
    catch (err) { next(err); }
  });
  router.post('/ack', (req, res, next) => {
    try {
      if (Object.keys(req.body).some(k => !['eventId','state'].includes(k)) || !['accepted','visible'].includes(req.body.state)) throw AppError.badRequest('ACK state must be accepted or visible');
      service.ack(req.auth!.user.id, notifyId(req.body.eventId), req.body.state);
      res.json({ version: 1, state: req.body.state });
    } catch (err) { next(err); }
  });
  router.get('/stream', (req, res, next) => {
    let after: number;
    let runId: string | undefined;
    try {
      after = cursor(req.query.after ?? req.header('Last-Event-ID'));
      if (req.query.runId !== undefined) { runId=notifyId(req.query.runId); service.listRun(req.auth!.user.id,runId,after); }
    } catch (err) { next(err); return; }
    if (service.changes.listenerCount('change') >= 32) { next(new AppError(503, 'SUBSCRIBER_LIMIT', 'Notification subscriber limit')); return; }
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache, no-transform');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders();
    const cleanup = () => { clearInterval(heartbeat); service.changes.off('change', flush); };
    const flush = () => {
      try {
        for (const event of runId ? service.listRun(req.auth!.user.id,runId,after) : service.list(req.auth!.user.id, after)) {
          after = event.cursor;
          const wire = projectHermesNotification(event);
          if (!wire) continue;
          if (!res.write(`id: ${wire.cursor}\nevent: notification\ndata: ${JSON.stringify(wire)}\n\n`)) {
            cleanup(); res.end(); return; // Replay from durable inbox after slow-reader disconnect.
          }
        }
      } catch { cleanup(); res.end(); }
    };
    const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); flush(); }, 15_000);
    service.changes.on('change', flush);
    req.on('close', cleanup);
    flush();
  });
  return router;
}
