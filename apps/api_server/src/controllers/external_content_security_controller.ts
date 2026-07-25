import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import {
  ExternalContentSecurityService,
  parseSecurityAction,
  parseSecurityPayload,
  parseTrustedSecurityContext,
} from '../services/external_content_security_service';

const security = new ExternalContentSecurityService();
const EXTERNAL_CONTENT_SOURCES = new Set([
  'gmail.search',
  'gmail.message',
  'message-thread.list',
  'message-thread.task',
  'dashboard.message-preview',
  'calendar.events',
  'trigger.list',
  'task.list',
  'rhythm.list',
  'project-template.list',
  'project-instance.list',
  'facility.list',
  'memory.search',
  'memory.list',
  'research.job',
  'pco.service-types',
  'pco.plans',
  'pco.plan-items',
  'pco.needed-positions',
]);

export class ExternalContentSecurityController {
  taint(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = req.body ?? {};
      const source = typeof body.source === 'string' ? body.source.trim() : '';
      if (!EXTERNAL_CONTENT_SOURCES.has(source)) {
        throw AppError.badRequest('source is not an approved external-content ingress');
      }
      if (typeof body.blocked !== 'boolean') {
        throw AppError.badRequest('blocked must be a boolean');
      }
      const contentDigest = typeof body.contentDigest === 'string' ? body.contentDigest : '';
      const result = security.markTainted({
        context: parseTrustedSecurityContext(body.context),
        source,
        contentDigest,
        blocked: body.blocked,
        diagnostics: body.diagnostics,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  consume(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = req.body ?? {};
      const result = security.consumeApproval({
        context: parseTrustedSecurityContext(body.context),
        approvalId:
          typeof body.approvalId === 'string' && body.approvalId !== ''
            ? body.approvalId
            : undefined,
        action: parseSecurityAction(body.action),
        payload: parseSecurityPayload(body.payload),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}
