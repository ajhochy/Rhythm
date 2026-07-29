import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';
import {
  sanitizeTranscriptShare,
  TRANSCRIPT_SHARE_CATEGORIES,
  type TranscriptShareReview,
} from '../services/transcript_share_sanitizer';

const repo = new SharedTranscriptsRepository();
const DEFAULT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

function isAdmin(req: Request): boolean {
  return req.auth?.user.role === 'admin' || req.auth?.user.role === 'system';
}

function validateReview(value: unknown): TranscriptShareReview {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    throw AppError.badRequest('review.items is required');
  }
  const review = value as TranscriptShareReview;
  const ids = new Set<string>();
  for (const item of review.items) {
    if (
      !item || typeof item !== 'object' ||
      typeof item.id !== 'string' || item.id.length === 0 ||
      ids.has(item.id) ||
      !TRANSCRIPT_SHARE_CATEGORIES.includes(item.category)
    ) {
      throw AppError.badRequest('Every reviewed item needs a unique id and valid category');
    }
    ids.add(item.id);
  }
  return review;
}

function activeForRead(share: { revokedAt: string | null; expiresAt: string }): boolean {
  return share.revokedAt === null && new Date(share.expiresAt).getTime() > Date.now();
}

export class SharedTranscriptsController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = req.auth!.user;
      const sourceSessionId = req.params.id;
      const sourceOwnerId = await repo.sourceOwnerUserId(sourceSessionId);
      if (sourceOwnerId === undefined) throw AppError.notFound('Agent session');
      if (sourceOwnerId !== actor.id && !isAdmin(req)) {
        throw AppError.notFound('Agent session');
      }

      const recipientUserIds = Array.from(new Set(
        Array.isArray(req.body?.recipientUserIds)
          ? req.body.recipientUserIds.filter(Number.isInteger)
          : [],
      )) as number[];
      if (recipientUserIds.length === 0) {
        throw AppError.badRequest('At least one named recipient is required');
      }
      if (!await repo.usersExist(recipientUserIds)) {
        throw AppError.badRequest('Every recipient must be a Rhythm user');
      }
      if (
        sourceOwnerId == null ||
        !await repo.recipientsShareWorkspace(sourceOwnerId, recipientUserIds)
      ) {
        throw AppError.forbidden(
          'Transcript recipients must belong to the source owner workspace',
        );
      }

      const review = validateReview(req.body?.review);
      const explicitInclusions = Array.isArray(req.body?.explicitlyIncludedItemIds)
        ? req.body.explicitlyIncludedItemIds.filter(
          (id: unknown): id is string => typeof id === 'string',
        )
        : [];
      const expiresAt = typeof req.body?.expiresAt === 'string'
        ? new Date(req.body.expiresAt)
        : new Date(Date.now() + DEFAULT_EXPIRATION_MS);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw AppError.badRequest('expiresAt must be a future timestamp');
      }

      const share = await repo.create({
        snapshot: sanitizeTranscriptShare(
          {
            items: (await repo.sourceTranscriptReview(sourceSessionId)).items
              .filter((sourceItem) =>
                review.items.some((requested) => requested.id === sourceItem.id)),
          },
          explicitInclusions,
        ),
        ownerUserId: actor.id,
        recipientUserIds,
        sourceSessionId,
        expiresAt: expiresAt.toISOString(),
      });
      res.status(201).json(share);
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actorId = req.auth!.user.id;
      const candidates = await repo.listForUser(actorId);
      const visible = [];
      for (const candidate of candidates) {
        const share = await repo.findWithLiveSource(candidate.id);
        if (!share) continue;
        if (share.ownerUserId === actorId || activeForRead(share)) visible.push(share);
      }
      res.json(visible);
    } catch (error) {
      next(error);
    }
  }

  async getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actorId = req.auth!.user.id;
      const share = await repo.findWithLiveSource(req.params.id);
      if (
        !share ||
        !activeForRead(share) ||
        (share.ownerUserId !== actorId && !share.recipientUserIds.includes(actorId))
      ) {
        throw AppError.notFound('Shared transcript');
      }
      await repo.audit(share.id, actorId, 'view');
      const audit = share.ownerUserId === actorId
        ? await repo.listAudit(share.id)
        : undefined;
      res.json({ ...share, ...(audit ? { audit } : {}) });
    } catch (error) {
      next(error);
    }
  }

  async revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const share = await repo.findWithLiveSource(req.params.id);
      if (!share || (share.ownerUserId !== req.auth!.user.id && !isAdmin(req))) {
        throw AppError.notFound('Shared transcript');
      }
      if (!await repo.revoke(share.id, req.auth!.user.id)) {
        throw AppError.notFound('Shared transcript');
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
