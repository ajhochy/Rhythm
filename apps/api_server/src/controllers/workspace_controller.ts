import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { WorkspaceRepository } from '../repositories/workspace_repository';

const repo = new WorkspaceRepository();

export class WorkspaceController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') throw AppError.badRequest('name is required');
      const existing = await repo.findForUserAsync(req.auth!.user.id);
      if (existing) throw AppError.badRequest('User already belongs to a workspace');
      const ws = await repo.createAsync({ name, createdBy: req.auth!.user.id });
      res.status(201).json(ws);
    } catch (err) {
      next(err);
    }
  }

  async join(req: Request, res: Response, next: NextFunction) {
    try {
      const { joinCode } = req.body as Record<string, unknown>;
      if (!joinCode || typeof joinCode !== 'string') throw AppError.badRequest('joinCode is required');
      const ws = await repo.joinByCodeAsync(joinCode.toUpperCase(), req.auth!.user.id);
      res.json(ws);
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws) throw AppError.notFound('Workspace');
      res.json(ws);
    } catch (err) {
      next(err);
    }
  }

  async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws) throw AppError.notFound('Workspace');
      const members = await repo.listMembersAsync(ws.id);
      res.json(members);
    } catch (err) {
      next(err);
    }
  }

  async updateMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws || ws.role !== 'admin') throw AppError.forbidden('Admin only');
      const { role } = req.body as Record<string, unknown>;
      if (role !== 'admin' && role !== 'staff') throw AppError.badRequest('role must be admin or staff');
      await repo.updateMemberRoleAsync(ws.id, Number(req.params.userId), role);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws || ws.role !== 'admin') throw AppError.forbidden('Admin only');
      await repo.removeMemberAsync(ws.id, Number(req.params.userId));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async regenerateJoinCode(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws || ws.role !== 'admin') throw AppError.forbidden('Admin only');
      const joinCode = await repo.regenerateJoinCodeAsync(ws.id);
      res.json({ joinCode });
    } catch (err) {
      next(err);
    }
  }
}
