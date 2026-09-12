import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';
import {
  sanitizeTranscriptShare,
  transcriptShareReviewHash,
  TRANSCRIPT_SHARE_CATEGORIES,
  type TranscriptShareReview,
  deriveTranscriptShareReview,
} from '../services/transcript_share_sanitizer';

const repo = new SharedTranscriptsRepository();
const DEFAULT_EXPIRATION_MS = SharedTranscriptsRepository.defaultExpirationMs;

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
  /** Detached publication: provenance is not a remote attestation of local source. */
  async publish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body;
      const allowed = ['review', 'reviewHash', 'explicitlyIncludedItemIds', 'recipientUserIds', 'expiresAt'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
        throw AppError.badRequest('Invalid publication fields');
      }
      const review = validateReview(body.review);
      if (Object.keys(review).some(key => key !== 'items') || review.items.length === 0 || review.items.some(item =>
        Object.keys(item).some(key => !['id', 'category', 'content'].includes(key)) ||
        !Object.hasOwn(item, 'content') || !/^[A-Za-z0-9:_-]{1,200}$/.test(item.id))) {
        throw AppError.badRequest('Invalid snapshot items');
      }
      const reviewHash = body.reviewHash;
      if (typeof reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(reviewHash)) throw AppError.badRequest('A valid reviewed reviewHash is required');
      const recipients: unknown = body.recipientUserIds;
      if (!Array.isArray(recipients) || !recipients.length || recipients.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(recipients).size !== recipients.length) {
        throw AppError.badRequest('Unique named recipient IDs are required');
      }
      const inclusions: unknown = body.explicitlyIncludedItemIds;
      if (!Array.isArray(inclusions) || new Set(inclusions).size !== inclusions.length || inclusions.some(id => typeof id !== 'string' || !review.items.some(item => item.id === id))) {
        throw AppError.badRequest('Explicit inclusions must be unique selected item IDs');
      }
      const now = Date.now(); const maxExpiry = now + 30 * 86400000;
      const expires = body.expiresAt === undefined ? maxExpiry : typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
      if (!Number.isFinite(expires) || expires <= now || expires > maxExpiry) throw AppError.badRequest('Expiry must be within the next 30 days');
      const actorId = req.auth!.user.id;
      if (!await repo.usersExist(recipients)) throw AppError.badRequest('Every recipient must be a Rhythm user');
      if (!await repo.recipientsShareWorkspace(actorId, recipients)) throw AppError.forbidden('Transcript recipients must belong to the publisher workspace');
      // Re-derive recognizable sensitive shapes; a caller cannot label tool/file
      // content as an ordinary message to bypass default exclusion. Never downgrade
      // an explicitly sensitive category, and always run recursive redaction again.
      const classified = { items: review.items.map(item => {
        const content = item.content;
        const role = content && typeof content === 'object' && 'role' in content && content.role === 'system' ? 'system' : 'assistant';
        const derived = deriveTranscriptShareReview([{ id: item.id, role, rawText: '', parts: [content] }]).items[0];
        return { ...item, category: item.category === 'message' ? derived.category : item.category };
      }) };
      const snapshot = { ...sanitizeTranscriptShare(classified, inclusions), reviewHash };
      const share = await repo.create({ snapshot, ownerUserId: actorId, recipientUserIds: recipients, sourceSessionId: 'detached:v1', expiresAt: new Date(expires).toISOString() });
      res.status(201).json(share);
    } catch (error) { next(error); }
  }

  async review(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sourceOwnerUserId = await repo.sourceOwnerUserId(req.params.id);
      if (sourceOwnerUserId === undefined || (sourceOwnerUserId !== req.auth!.user.id && !isAdmin(req))) {
        throw AppError.notFound('Agent session');
      }
      const review = await repo.sourceTranscriptReview(req.params.id);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        sourceOwnerUserId,
        review,
        reviewHash: transcriptShareReviewHash(review),
        // Both previews use the publication sanitizer; clients only select items.
        snapshot: sanitizeTranscriptShare(review),
        inclusiveSnapshot: sanitizeTranscriptShare(review, review.items.map((item) => item.id)),
      });
    } catch (error) { next(error); }
  }

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
      const reviewHash: unknown = req.body?.reviewHash;
      if (typeof reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(reviewHash)) {
        throw AppError.badRequest('A valid reviewed reviewHash is required');
      }
      const explicitInclusions: string[] = Array.isArray(req.body?.explicitlyIncludedItemIds)
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

      const sourceReview = await repo.sourceTranscriptReview(sourceSessionId);
      if (transcriptShareReviewHash(sourceReview) !== reviewHash) {
        throw AppError.conflict('Transcript changed. Review again before sharing.');
      }
      const sourceIds = new Set(sourceReview.items.map((item) => item.id));
      const selectedIds = new Set(review.items.map((item) => item.id));
      if (review.items.some((item) => !sourceIds.has(item.id)) || explicitInclusions.some((id) => !selectedIds.has(id))) {
        throw AppError.badRequest('Selected items must belong to the reviewed transcript');
      }
      const share = await repo.create({
        snapshot: sanitizeTranscriptShare(
          {
            items: sourceReview.items
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
