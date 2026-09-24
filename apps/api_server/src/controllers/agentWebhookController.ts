/**
 * Agent Webhook Controller
 *
 * Inbound webhook → trigger drain path.
 * SSRF protection: destination URL validation on registration (Odysseus pattern).
 * HMAC-SHA256 signature verification on each inbound request.
 *
 * Route:
 *   POST /agent-webhooks/:id/receive  — public, no auth, HMAC-verified
 *   GET/POST/DELETE /agent-webhooks   — authenticated CRUD
 */

import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { AppError } from '../errors/app_error';
import { AgentWebhookEndpointsRepository } from '../repositories/agent_webhook_endpoints_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';
import { logger } from '../utils/logger';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import { scanContextContent } from '../security/context_scanner';
import { untrustedContext } from '../security/untrusted_fence';

const repo = new AgentWebhookEndpointsRepository();
const triggersRepo = new ClaudeTriggersRepository();

function endpointResponse(
  req: Request,
  endpoint: Awaited<ReturnType<AgentWebhookEndpointsRepository['findByIdAsync']>> & {},
  includeSecret: boolean,
) {
  const primaryApiOrigin = req.app.locals.primaryApiOrigin;
  const host = req.get('host');
  const origin = typeof primaryApiOrigin === 'string' && primaryApiOrigin
    ? primaryApiOrigin
    : host
      ? `${req.protocol}://${host}`
      : '';
  const url = origin
    ? `${origin}/agent-webhooks/${encodeURIComponent(endpoint.id)}/receive`
    : `/agent-webhooks/${encodeURIComponent(endpoint.id)}/receive`;
  return {
    ...endpoint,
    url,
    secret: includeSecret ? endpoint.secret : '[redacted]',
  };
}

export class AgentWebhookController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const endpoints = req.mobileDevice
        ? await repo.listForOwnerAsync(req.mobileDevice.userId)
        : await repo.listAsync();
      // Redact secret from listing
      res.json(endpoints.map((endpoint) => endpointResponse(req, endpoint, false)));
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, eventTypes, targetScheduledTaskId, targetPrompt } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') throw AppError.badRequest('name is required');
      if (name.length > 120 || (targetPrompt !== undefined &&
        (typeof targetPrompt !== 'string' || targetPrompt.length > 4096)) ||
        (targetScheduledTaskId !== undefined &&
          (typeof targetScheduledTaskId !== 'string' || targetScheduledTaskId.length > 128)) ||
        (eventTypes !== undefined && (!Array.isArray(eventTypes) || eventTypes.length > 32 ||
          !eventTypes.every((event) => typeof event === 'string' && event.length > 0 && event.length <= 128)))) {
        throw AppError.badRequest('Invalid webhook configuration');
      }
      if (
        req.mobileDevice &&
        typeof targetScheduledTaskId === 'string' &&
        !(await new AgentScheduledTasksRepository().findByIdForOwnerAsync(
          targetScheduledTaskId,
          req.mobileDevice.userId,
        ))
      ) {
        throw AppError.notFound('AgentScheduledTask');
      }

      const endpoint = await repo.createAsync({
        name,
        eventTypesJson: Array.isArray(eventTypes) ? JSON.stringify(eventTypes) : '["*"]',
        targetScheduledTaskId: typeof targetScheduledTaskId === 'string' ? targetScheduledTaskId : undefined,
        targetPrompt: typeof targetPrompt === 'string' ? targetPrompt : undefined,
        createdByUserId: req.auth?.user.id,
      });

      // Return the secret only on creation (never again after this)
      res.status(201).json(endpointResponse(req, endpoint, true));
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const endpoint = req.mobileDevice
        ? await repo.findByIdForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.findByIdAsync(req.params.id);
      if (!endpoint) throw AppError.notFound('WebhookEndpoint');
      res.json(endpointResponse(req, endpoint, false));
    } catch (err) { next(err); }
  }

  async rotateSecret(req: Request, res: Response, next: NextFunction) {
    try {
      const endpoint = req.mobileDevice
        ? await repo.rotateSecretForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.rotateSecretAsync(req.params.id);
      if (!endpoint) throw AppError.notFound('WebhookEndpoint');
      res.json(endpointResponse(req, endpoint, true));
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = req.mobileDevice
        ? await repo.deleteForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.deleteAsync(req.params.id);
      if (!deleted) throw AppError.notFound('WebhookEndpoint');
      res.status(204).end();
    } catch (err) { next(err); }
  }

  /**
   * Receive an inbound webhook payload.
   * Verifies HMAC-SHA256 signature in X-Signature-SHA256 header.
   * On success, inserts a pending_claude_triggers row so the agent picks it up.
   *
   * This endpoint is deliberately unauthenticated (webhook callers don't have
   * Rhythm sessions). Security comes from the HMAC secret.
   */
  async receive(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const endpoint = await repo.findByIdAsync(id);
      if (!endpoint || !endpoint.enabled) {
        // Don't reveal whether the endpoint exists
        res.status(404).json({ error: 'Not found' });
        return;
      }

      // Verify HMAC signature
      const sigHeader = req.headers['x-signature-sha256'] as string | undefined
        ?? req.headers['x-hub-signature-256'] as string | undefined;

      if (!sigHeader) {
        logger.warn(`[Webhook] Missing signature for endpoint ${id}`);
        res.status(401).json({ error: 'Missing X-Signature-SHA256 header' });
        return;
      }

      const rawBody: string = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);

      const expected = 'sha256=' + crypto
        .createHmac('sha256', endpoint.secret)
        .update(rawBody)
        .digest('hex');

      // Constant-time comparison
      const sigBuf = Buffer.from(sigHeader.startsWith('sha256=') ? sigHeader : `sha256=${sigHeader}`);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        logger.warn(`[Webhook] Invalid signature for endpoint ${id}`);
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // ponytail: bound external text at the ingress; never promote it to instructions.
      if (Buffer.byteLength(rawBody, 'utf8') > 65536) throw AppError.badRequest('Webhook payload too large');
      let payloadObj: unknown;
      try { payloadObj = typeof req.body === 'object' ? req.body : JSON.parse(rawBody); } catch {
        throw AppError.badRequest('Invalid webhook JSON');
      }
      if (!payloadObj || typeof payloadObj !== 'object' || Array.isArray(payloadObj)) {
        throw AppError.badRequest('Invalid webhook payload');
      }
      const payload = payloadObj as Record<string, unknown>;
      const eventType = payload.event ?? payload.type ?? 'webhook';
      if (typeof eventType !== 'string' || !eventType || eventType.length > 128 ||
        ['summary', 'notePath'].some((key) => payload[key] !== undefined &&
          (typeof payload[key] !== 'string' || (payload[key] as string).length > 512))) {
        throw AppError.badRequest('Invalid webhook event context');
      }
      const notePath = payload.notePath;
      if (typeof notePath === 'string' && (!notePath || notePath.startsWith('/') ||
        notePath.includes('\\') || notePath.split('/').includes('..') || /[\x00-\x1f\x7f]/.test(notePath))) {
        throw AppError.badRequest('Invalid webhook note path');
      }

      // Check event type filter
      const allowedEvents = JSON.parse(endpoint.eventTypesJson) as string[];
      if (!allowedEvents.includes('*') && !allowedEvents.includes(eventType)) {
        res.status(200).json({ status: 'ignored', reason: 'event type not in allowlist' });
        return;
      }

      // Build prompt for the trigger
      const target = endpoint.targetScheduledTaskId
        ? await new AgentScheduledTasksRepository().findByIdAsync(endpoint.targetScheduledTaskId)
        : null;
      const instructions = endpoint.targetPrompt ?? target?.prompt ?? 'Review the webhook event.';
      // ponytail: scan decoded leaves and keys before JSON escaping hides commands.
      const externalJson = JSON.stringify({ event: eventType, payload });
      const text: string[] = [rawBody, externalJson];
      const pending: unknown[] = [payload];
      while (pending.length) {
        const value = pending.pop();
        if (Array.isArray(value)) pending.push(...value);
        else if (value && typeof value === 'object') {
          for (const [key, leaf] of Object.entries(value)) {
            text.push(key.replace(/\s+/g, ' '));
            pending.push(leaf);
          }
        } else if (typeof value === 'string') text.push(value.replace(/\s+/g, ' '));
      }
      const scan = scanContextContent(text.join('\n'), 'webhook event');
      const external = externalJson.replace(/</g, '\\u003c');
      const fenced = untrustedContext(scan.blocked ? scan.warning : external, 'webhook event');
      let placed = false;
      const templated = instructions.replace(/{{payload}}/g, () => {
        if (placed) return '';
        placed = true;
        return fenced;
      });
      const prompt = placed ? templated : `${instructions}\n\n${fenced}`;

      // Insert pending trigger
      const now = new Date().toISOString();
      if (env.dbClient === 'postgres') {
        await getPostgresPool().query(
          `INSERT INTO pending_claude_triggers
             (task_id, triggered_by_user_id, scheduled_task_id, webhook_endpoint_id,
              prompt, created_at)
           VALUES (NULL, $1, $2, $3, $4, $5)`,
          [
            endpoint.createdByUserId,
            endpoint.targetScheduledTaskId ?? null,
            id,
            prompt,
            now,
          ],
        );
      } else {
        getDb().prepare(`
          INSERT INTO pending_claude_triggers
            (task_id, triggered_by_user_id, scheduled_task_id, webhook_endpoint_id,
             prompt, created_at)
          VALUES (NULL, ?, ?, ?, ?, ?)
        `).run(
          endpoint.createdByUserId,
          endpoint.targetScheduledTaskId ?? null,
          id,
          prompt,
          now,
        );
      }

      await repo.recordTriggerAsync(id);

      logger.info(`[Webhook] Endpoint ${id} queued`);
      res.json({ status: 'queued' });
    } catch (err) { next(err); }
  }
}
