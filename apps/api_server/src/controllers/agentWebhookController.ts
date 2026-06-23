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
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';
import { logger } from '../utils/logger';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';

const repo = new AgentWebhookEndpointsRepository();
const triggersRepo = new ClaudeTriggersRepository();

export class AgentWebhookController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const endpoints = await repo.listAsync();
      // Redact secret from listing
      res.json(endpoints.map((e) => ({ ...e, secret: '[redacted]' })));
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, eventTypes, targetScheduledTaskId, targetPrompt } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') throw AppError.badRequest('name is required');

      const endpoint = await repo.createAsync({
        name,
        eventTypesJson: Array.isArray(eventTypes) ? JSON.stringify(eventTypes) : '["*"]',
        targetScheduledTaskId: typeof targetScheduledTaskId === 'string' ? targetScheduledTaskId : undefined,
        targetPrompt: typeof targetPrompt === 'string' ? targetPrompt : undefined,
        createdByUserId: req.auth?.user.id,
      });

      // Return the secret only on creation (never again after this)
      res.status(201).json(endpoint);
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const endpoint = await repo.findByIdAsync(req.params.id);
      if (!endpoint) throw AppError.notFound('WebhookEndpoint');
      res.json({ ...endpoint, secret: '[redacted]' });
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = await repo.deleteAsync(req.params.id);
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

      // Parse event type from payload (optional convention)
      let payloadObj: Record<string, unknown> = {};
      try { payloadObj = typeof req.body === 'object' ? req.body : JSON.parse(rawBody); } catch { /* ignore */ }
      const eventType = (payloadObj.event ?? payloadObj.type ?? 'webhook') as string;

      // Check event type filter
      const allowedEvents = JSON.parse(endpoint.eventTypesJson) as string[];
      if (!allowedEvents.includes('*') && !allowedEvents.includes(eventType)) {
        res.status(200).json({ status: 'ignored', reason: 'event type not in allowlist' });
        return;
      }

      // Build prompt for the trigger
      const prompt = endpoint.targetPrompt
        ?? `Webhook event received: ${eventType}\n\nPayload:\n${JSON.stringify(payloadObj, null, 2)}`;

      // Insert pending trigger
      const now = new Date().toISOString();
      if (env.dbClient === 'postgres') {
        await getPostgresPool().query(
          `INSERT INTO pending_claude_triggers
             (task_id, triggered_by_user_id, scheduled_task_id, webhook_endpoint_id,
              prompt, created_at)
           VALUES (NULL, NULL, $1, $2, $3, $4)`,
          [endpoint.targetScheduledTaskId ?? null, id, prompt, now],
        );
      } else {
        getDb().prepare(`
          INSERT INTO pending_claude_triggers
            (task_id, triggered_by_user_id, scheduled_task_id, webhook_endpoint_id,
             prompt, created_at)
          VALUES (NULL, NULL, ?, ?, ?, ?)
        `).run(endpoint.targetScheduledTaskId ?? null, id, prompt, now);
      }

      await repo.recordTriggerAsync(id);

      logger.info(`[Webhook] Endpoint ${id} fired (event: ${eventType})`);
      res.json({ status: 'queued' });
    } catch (err) { next(err); }
  }
}
