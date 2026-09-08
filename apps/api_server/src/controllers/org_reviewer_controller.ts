import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { verifyTrustedMcpCall, type VerifiedTrustedMcpCall } from '../security/trusted_mcp_call';
import {
  ORG_REVIEWER_READ_TOOL,
  ORG_REVIEWER_SUBMIT_TOOL,
  OrgReviewerService,
} from '../services/org_reviewer_service';

function trustedCallFromBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return (body as Record<string, unknown>).trustedCall;
}

async function authenticate(body: unknown, expectedTool: string): Promise<VerifiedTrustedMcpCall> {
  let verified: VerifiedTrustedMcpCall;
  try {
    verified = await verifyTrustedMcpCall(trustedCallFromBody(body), expectedTool);
  } catch {
    throw AppError.unauthorized('A current signed MCP reviewer call is required');
  }
  const keys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body as Record<string, unknown>)
    : [];
  if (keys.length !== 1 || keys[0] !== 'trustedCall') {
    throw AppError.badRequest('Reviewer endpoint body must contain only trustedCall');
  }
  return verified;
}

export class OrgReviewerController {
  constructor(private readonly service = new OrgReviewerService()) {}

  async context(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const verified = await authenticate(req.body, ORG_REVIEWER_READ_TOOL);
      const reviewer = await this.service.authorize(verified.context);
      res.json(await this.service.context(verified.arguments, reviewer));
    } catch (error) {
      next(error);
    }
  }

  async submit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const verified = await authenticate(req.body, ORG_REVIEWER_SUBMIT_TOOL);
      const reviewer = await this.service.authorize(verified.context);
      res.status(201).json(await this.service.submit(verified.arguments, reviewer));
    } catch (error) {
      next(error);
    }
  }
}
