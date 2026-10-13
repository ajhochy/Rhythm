import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AppError } from '../errors/app_error';
import { hermesNotifyService as service, notifyId } from '../services/hermes_notify_service';

export function createHermesNotifyRouter(): Router {
  const router = Router();
  router.use(requireAuth); // Never the agent-local optional-auth fallback.
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
    try { res.json({version:2,runId:notifyId(req.params.runId),events:service.listRun(req.auth!.user.id,req.params.runId,cursor(req.query.after))}); }
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
    try { res.json({ version: 1, events: service.list(req.auth!.user.id, cursor(req.query.after)) }); }
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
          if (!res.write(`id: ${event.cursor}\nevent: notification\ndata: ${JSON.stringify(event)}\n\n`)) {
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
