import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import {
  ExternalContentSecurityService,
  parseSecurityAction,
  parseSecurityPayload,
  parseTrustedSecurityContext,
} from '../services/external_content_security_service';

const security = new ExternalContentSecurityService();

export class ExternalContentSecurityController {
  taint(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = req.body ?? {};
      const source = typeof body.source === 'string' ? body.source.trim() : '';
      if (source !== 'gmail.search' && source !== 'gmail.message') {
        throw AppError.badRequest('source must be gmail.search or gmail.message');
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
