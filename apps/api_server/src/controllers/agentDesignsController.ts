import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentDesignsRepository, publicAgentDesign } from '../repositories/agent_designs_repository';
import {
  generateLocalVideoPoster,
  resolveLocalArtifact,
  validateAgentDesignInput,
} from '../services/agent_design_artifacts';
import {
  mediaMimeForPath,
  registerGeneratedMediaFile,
} from '../services/media_artifact_store';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const repo = new AgentDesignsRepository();

/** A trimmed, non-empty display name of at most 200 characters. */
function requiredName(value: unknown, field: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 200) throw AppError.badRequest(`${field} must be 1-200 characters`);
  return name;
}

export class AgentDesignsController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const designs = await repo.listAllAsync();
      res.json(designs.map(publicAgentDesign));
    } catch (err) {
      next(err);
    }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const design = await repo.findByIdAsync(req.params.id);
      if (!design) throw AppError.notFound('AgentDesign');
      res.json(publicAgentDesign(design));
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      let input;
      try { input = validateAgentDesignInput(req.body as Record<string, unknown>); }
      catch (error) { throw AppError.badRequest(error instanceof Error ? error.message : 'Invalid artifact'); }

      const design = await repo.createAsync({
        title: input.title,
        provider: input.provider,
        artifactUrl: input.artifactUrl,
        projectUrl: input.projectUrl,
        canvaUrl: input.provider === 'canva' ? input.projectUrl : undefined,
        artifactType: input.artifactType,
        filePath: input.localPath,
        sessionId: input.sessionId,
      });

      // Finished local image/video designs join the durable media store when
      // their originating session supplies the project scope.
      if (input.localPath && input.sessionId) {
        const session = new AgentSessionsRepository().findById(input.sessionId);
        const mime = mediaMimeForPath(input.localPath);
        if (session?.projectId && mime) {
          await registerGeneratedMediaFile({
            filePath: input.localPath,
            project: session.projectId,
            session: session.id,
            mime,
          });
        }
      }

      res.status(201).json(publicAgentDesign(design));
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
        artifact = resolveLocalArtifact(design.filePath);
      } catch {
        throw AppError.notFound('AgentDesign artifact');
      }
      res.type(artifact.artifactType === 'jpg' ? 'jpeg' : artifact.artifactType);
      res.sendFile(artifact.path);
    } catch (err) {
      next(err);
    }
  }

  async thumbnail(req: Request, res: Response, next: NextFunction) {
    try {
      const design = await repo.findByIdAsync(req.params.id);
      if (!design?.filePath || design.artifactType !== 'mp4') {
        throw AppError.notFound('AgentDesign thumbnail');
      }
      try {
        const posterPath = await generateLocalVideoPoster(design.filePath);
        res.type('png');
        res.sendFile(posterPath);
      } catch {
        throw AppError.notFound('AgentDesign thumbnail');
      }
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

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: { title?: string; folderId?: string | null } = {};
      if (body.title !== undefined) patch.title = requiredName(body.title, 'title');
      if (body.folderId !== undefined) {
        if (body.folderId !== null && typeof body.folderId !== 'string') throw AppError.badRequest('folderId must be a string or null');
        if (body.folderId !== null && !(await repo.findFolderAsync(body.folderId))) throw AppError.badRequest('Unknown folderId');
        patch.folderId = body.folderId;
      }
      if (!(await repo.findByIdAsync(req.params.id))) throw AppError.notFound('AgentDesign');
      res.json(publicAgentDesign((await repo.updateAsync(req.params.id, patch))!));
    } catch (err) {
      next(err);
    }
  }

  async listFolders(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.listFoldersAsync());
    } catch (err) {
      next(err);
    }
  }

  async createFolder(req: Request, res: Response, next: NextFunction) {
    try {
      const name = requiredName((req.body as Record<string, unknown> | undefined)?.name, 'name');
      res.status(201).json(await repo.createFolderAsync(name));
    } catch (err) {
      next(err);
    }
  }

  async renameFolder(req: Request, res: Response, next: NextFunction) {
    try {
      const name = requiredName((req.body as Record<string, unknown> | undefined)?.name, 'name');
      const folder = await repo.renameFolderAsync(req.params.id, name);
      if (!folder) throw AppError.notFound('AgentDesignFolder');
      res.json(folder);
    } catch (err) {
      next(err);
    }
  }

  async removeFolder(req: Request, res: Response, next: NextFunction) {
    try {
      if (!(await repo.deleteFolderAsync(req.params.id))) throw AppError.notFound('AgentDesignFolder');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
