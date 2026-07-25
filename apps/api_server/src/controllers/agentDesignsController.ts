import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentDesignsRepository } from '../repositories/agent_designs_repository';
import { isArtifactType, isCanvaUrl, resolveLocalArtifact } from '../services/agent_design_artifacts';

const repo = new AgentDesignsRepository();

export class AgentDesignsController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const designs = await repo.listAllAsync();
      res.json(designs);
    } catch (err) {
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const design = await repo.findByIdAsync(req.params.id);
      if (!design) throw AppError.notFound('AgentDesign');
      res.json(design);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, canvaUrl, localPath, artifactType, thumbnailUrl, sessionId, userApprovedPath } =
        req.body as Record<string, unknown>;

      if (typeof canvaUrl === 'string' && !isCanvaUrl(canvaUrl)) {
        throw AppError.badRequest('Canva URL must be an HTTPS canva.com URL');
      }
      if (typeof thumbnailUrl === 'string' && !isCanvaUrl(thumbnailUrl)) {
        throw AppError.badRequest('Thumbnail URL must be an HTTPS canva.com URL');
      }
      if (typeof artifactType === 'string' && !isArtifactType(artifactType)) {
        throw AppError.badRequest('Unsupported artifact type');
      }
      if (typeof canvaUrl === 'string' && typeof localPath === 'string') {
        throw AppError.badRequest('Provide either a local artifact path or Canva URL');
      }
      let localArtifact: { path: string; artifactType: string } | undefined;
      if (typeof localPath === 'string') {
        try {
          localArtifact = resolveLocalArtifact(localPath, userApprovedPath === true);
        } catch (error) {
          throw AppError.badRequest(error instanceof Error ? error.message : 'Invalid local artifact');
        }
      }
      if (localArtifact && typeof artifactType === 'string' && artifactType.toLowerCase() !== localArtifact.artifactType) {
        throw AppError.badRequest('Artifact type does not match the local file');
      }

      const design = await repo.createAsync({
        title: typeof title === 'string' ? title : undefined,
        canvaUrl: typeof canvaUrl === 'string' ? canvaUrl : undefined,
        artifactType: localArtifact?.artifactType ?? (typeof artifactType === 'string' ? artifactType.toLowerCase() : undefined),
        filePath: localArtifact?.path,
        thumbnailUrl:
          typeof thumbnailUrl === 'string' ? thumbnailUrl : undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      });

      res.status(201).json(design);
    } catch (err) {
      next(err);
    }
  }

  async artifact(req: Request, res: Response, next: NextFunction) {
    try {
      const design = await repo.findByIdAsync(req.params.id);
      if (!design?.filePath) throw AppError.notFound('AgentDesign artifact');
      let artifact: { path: string; artifactType: string };
      try {
        artifact = resolveLocalArtifact(design.filePath, true);
      } catch {
        throw AppError.notFound('AgentDesign artifact');
      }
      res.type(artifact.artifactType === 'jpg' ? 'jpeg' : artifact.artifactType);
      res.sendFile(artifact.path);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = await repo.deleteAsync(req.params.id);
      if (!deleted) throw AppError.notFound('AgentDesign');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
