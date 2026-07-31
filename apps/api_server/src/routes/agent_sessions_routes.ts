import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  authenticateIfPresent,
  requireAuth,
} from '../middleware/auth_middleware';
import { AgentSessionsController } from '../controllers/agent_sessions_controller';
import { AppError } from '../errors/app_error';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { env } from '../config/env';
import { appEvents } from '../utils/app_events';
import type { AppEvent } from '../utils/app_events';

const controller = new AgentSessionsController();
const sessionsRepository = new AgentSessionsRepository();
export const agentSessionsRouter = Router();

agentSessionsRouter.use(
  env.agentLocal ? authenticateIfPresent : requireAuth,
);

function requireAgentSessionOwner(
  req: Request,
  _res: Response,
  next: NextFunction,
  id: string,
): void {
  const session = sessionsRepository.findById(id);
  if (
    req.auth &&
    session?.ownerUserId != null &&
    session.ownerUserId !== req.auth.user.id
  ) {
    next(AppError.notFound('AgentSession'));
    return;
  }
  next();
}

agentSessionsRouter.param('id', requireAgentSessionOwner);

/**
 * OPC-M4-4 — GET /agent-sessions/agents
 *
 * Route choice: registered on the agent_sessions router (not a separate file)
 * to keep all agent-session affordances under one router. This is a static
 * path and must be declared BEFORE the `/:id` wildcard so Express routes
 * `/agent-sessions/agents` here rather than treating "agents" as a session id.
 */
agentSessionsRouter.get('/agents', controller.listAgents.bind(controller));
agentSessionsRouter.post(
  '/agents/refresh',
  controller.refreshAgents.bind(controller),
);

/**
 * #747 — GET /agent-sessions/background-status
 *
 * Aggregates five background loop states (skill harvester, skill improver,
 * memory, scheduler, integrations sync) into a compact JSON payload for the
 * Flutter header activity indicator. Cheap poll — no per-session engine calls.
 * Must be declared BEFORE /:id wildcard.
 */
agentSessionsRouter.get('/background-status', controller.backgroundStatus.bind(controller));

agentSessionsRouter.get('/', controller.list.bind(controller));
agentSessionsRouter.get('/:id', controller.getOne.bind(controller));
agentSessionsRouter.post('/', controller.create.bind(controller));
agentSessionsRouter.patch('/:id', controller.update.bind(controller));
agentSessionsRouter.post('/:id/cancel', controller.cancel.bind(controller));
agentSessionsRouter.get('/:id/diff', controller.getDiff.bind(controller));
// OCU-19 (#1060) — file/find proxy scoped to the session directory
// (worktree dir when isolated). Path-traversal guarded; content capped ~2MB.
agentSessionsRouter.get('/:id/files/find-text', controller.findText.bind(controller));
agentSessionsRouter.get('/:id/files/find-files', controller.findFiles.bind(controller));
agentSessionsRouter.get('/:id/files/list', controller.listFiles.bind(controller));
agentSessionsRouter.get('/:id/files/content', controller.fileContent.bind(controller));
agentSessionsRouter.get('/:id/files/status', controller.fileStatus.bind(controller));
// OCU-22 (#1063) / OCU-23 (#1064) — VCS branch/status + branch-diff + raw patch.
agentSessionsRouter.get('/:id/vcs', controller.getVcs.bind(controller));
agentSessionsRouter.get('/:id/vcs/status', controller.getVcsStatus.bind(controller));
agentSessionsRouter.get('/:id/vcs/diff', controller.getVcsDiff.bind(controller));
agentSessionsRouter.get('/:id/vcs/diff/raw', controller.getVcsDiffRaw.bind(controller));
// OCU-24 (#1065) — session.shell quick-run. OCU-25 (#1066) — session.init.
agentSessionsRouter.post('/:id/shell', controller.shell.bind(controller));
agentSessionsRouter.post('/:id/init', controller.init.bind(controller));
agentSessionsRouter.post(
  '/:id/permission/:permissionId/:decision',
  controller.respondPermission.bind(controller),
);
// OCU-18 (#1059) — Changes-tab worktree actions, scoped by session id.
agentSessionsRouter.post('/:id/worktree/reset', controller.resetWorktree.bind(controller));
agentSessionsRouter.post('/:id/worktree/remove', controller.removeWorktree.bind(controller));
agentSessionsRouter.post(
  '/:id/question/:callId/:action',
  controller.respondQuestion.bind(controller),
);
agentSessionsRouter.delete('/:id', controller.remove.bind(controller));
agentSessionsRouter.delete('/:id/hard', controller.destroy.bind(controller));
agentSessionsRouter.get('/:id/messages', controller.listMessages.bind(controller));
agentSessionsRouter.post('/:id/resume', controller.resume.bind(controller));
agentSessionsRouter.post('/:id/revert', controller.revert.bind(controller));
agentSessionsRouter.post('/:id/unrevert', controller.unrevert.bind(controller));
agentSessionsRouter.post('/:id/summarize', controller.summarize.bind(controller));
agentSessionsRouter.get('/:id/todo', controller.getTodo.bind(controller));
agentSessionsRouter.get('/:id/memory-provenance', controller.getMemoryProvenance.bind(controller));
agentSessionsRouter.get('/:id/tool-surface', controller.getToolSurface.bind(controller));
agentSessionsRouter.get('/:id/children', controller.getChildren.bind(controller));
agentSessionsRouter.get('/:id/children/:childSdkId/messages', controller.getChildMessages.bind(controller));
agentSessionsRouter.post('/:id/fork', controller.fork.bind(controller));

/**
 * Feature J — SSE streaming for agent session output.
 *
 * GET /agent-sessions/:id/events
 *
 * Establishes a Server-Sent Events stream that replays live agent output,
 * status changes, and session lifecycle events for the given session ID.
 * Backed by the existing appEvents emitter (agent.session_output,
 * agent.session_status, agent.session_closed).
 *
 * Event types emitted to client:
 *   output   — { sessionId, data }          — raw text chunk from agent stdout
 *   status   — { sessionId, working, source } — agent working/idle state change
 *   closed   — { sessionId, resumable }     — session ended (natural or cancelled)
 *   heartbeat— {}                           — keepalive every 15 s
 *
 * The stream is automatically closed when the client disconnects or the
 * session emits 'agent.session_closed'. Max 50 concurrent SSE subscribers
 * per process (inherited from appEvents.maxListeners).
 */
agentSessionsRouter.get('/:id/events', (req, res) => {
  const { id: sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keepalive — prevents proxies and mobile clients from timing out
  const heartbeat = setInterval(() => send('heartbeat', {}), 15_000);

  const onOutput = (payload: AppEvent) => {
    if (payload.event !== 'agent.session_output') return;
    if (payload.sessionId !== sessionId) return;
    send('output', { sessionId: payload.sessionId, data: payload.data });
  };

  const onStatus = (payload: AppEvent) => {
    if (payload.event !== 'agent.session_status') return;
    if (payload.sessionId !== sessionId) return;
    send('status', { sessionId: payload.sessionId, working: payload.working, source: payload.source });
  };

  const onClosed = (payload: AppEvent) => {
    if (payload.event !== 'agent.session_closed') return;
    if (payload.sessionId !== sessionId) return;
    send('closed', { sessionId: payload.sessionId, resumable: payload.resumable });
    cleanup();
    res.end();
  };

  const cleanup = () => {
    clearInterval(heartbeat);
    appEvents.removeListener('agent.session_output', onOutput);
    appEvents.removeListener('agent.session_status', onStatus);
    appEvents.removeListener('agent.session_closed', onClosed);
  };

  appEvents.on('agent.session_output', onOutput);
  appEvents.on('agent.session_status', onStatus);
  appEvents.on('agent.session_closed', onClosed);

  // Emit a connected confirmation so the client knows the stream is live
  send('connected', { sessionId });

  req.on('close', cleanup);
});
