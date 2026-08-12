import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import {
  InvalidByteRangeError,
  MediaArtifactStore,
  parseByteRange,
} from '../services/media_artifact_store';

function requestedProject(req: Request): string {
  const project = req.mobileProject?.id ??
    req.header('X-Rhythm-Project') ?? req.header('X-Rhythm-Project-ID') ?? '';
  if (!project.trim()) throw AppError.badRequest('Project scope is required');
  return project.trim();
}

export class MediaArtifactsController {
  async serve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const store = new MediaArtifactStore();
      const artifact = await store.findProjectArtifact(req.params.id, requestedProject(req));
      if (!artifact) throw AppError.notFound('Media artifact');
      const userId = req.mobileDevice?.userId ?? req.auth?.user.id;
      if (userId === undefined || !store.canUserAccessArtifact(artifact, userId)) {
        throw AppError.notFound('Media artifact');
      }
      let range;
      try {
        range = parseByteRange(req.header('Range') ?? undefined, artifact.size);
      } catch (error) {
        if (!(error instanceof InvalidByteRangeError)) throw error;
        res.set('Content-Range', `bytes */${artifact.size}`);
        res.status(416).end();
        return;
      }
      res.set('Accept-Ranges', 'bytes');
      res.type(artifact.mime);
      res.set('Content-Length', String(range ? range.end - range.start + 1 : artifact.size));
      if (range) {
        res.set('Content-Range', `bytes ${range.start}-${range.end}/${artifact.size}`);
        res.status(206);
      }
      const stream = store.createByteStream(artifact, range);
      stream.on('error', next);
      stream.pipe(res);
    } catch (error) {
      next(error instanceof AppError ? error : AppError.internal());
    }
  }

  async pin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (typeof req.body?.pinned !== 'boolean') {
        throw AppError.badRequest('pinned must be a boolean');
      }
      const store = new MediaArtifactStore();
      const project = requestedProject(req);
      const artifact = await store.findProjectArtifact(req.params.id, project);
      const userId = req.mobileDevice?.userId ?? req.auth?.user.id;
      if (!artifact || userId === undefined || !store.canUserAccessArtifact(artifact, userId)) {
        throw AppError.notFound('Media artifact');
      }
      const updated = await store.setPinned(
        req.params.id,
        project,
        req.body.pinned,
      );
      if (!updated) throw AppError.notFound('Media artifact');
      res.json({ id: req.params.id, pinned: req.body.pinned });
    } catch (error) {
      next(error instanceof AppError ? error : AppError.internal());
    }
  }
}
