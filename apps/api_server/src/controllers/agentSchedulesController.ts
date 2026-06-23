import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { computeNextRun } from '../services/agentSchedulerService';

const repo = new AgentScheduledTasksRepository();

export class AgentSchedulesController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const tasks = await repo.listAllAsync();
      res.json(tasks);
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await repo.findByIdAsync(req.params.id);
      if (!task) throw AppError.notFound('AgentScheduledTask');
      res.json(task);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name, description, scheduleType, scheduledTime, scheduledDay,
        cronExpression, runAt, timezone, prompt, agentKind,
        allowedMcps, allowedSkills,
      } = req.body as Record<string, unknown>;

      if (!name || typeof name !== 'string') throw AppError.badRequest('name is required');
      if (!scheduleType || typeof scheduleType !== 'string') throw AppError.badRequest('scheduleType is required');
      if (!prompt || typeof prompt !== 'string') throw AppError.badRequest('prompt is required');

      // Validate schedule type
      const validTypes = ['daily', 'weekly', 'monthly', 'cron', 'once'];
      if (!validTypes.includes(scheduleType)) {
        throw AppError.badRequest(`scheduleType must be one of: ${validTypes.join(', ')}`);
      }

      const tz = (typeof timezone === 'string' ? timezone : undefined) ?? 'America/Los_Angeles';

      const nextRunAt = computeNextRun({
        scheduleType,
        scheduledTime: typeof scheduledTime === 'string' ? scheduledTime : null,
        scheduledDay: typeof scheduledDay === 'number' ? scheduledDay : null,
        cronExpression: typeof cronExpression === 'string' ? cronExpression : null,
        runAt: typeof runAt === 'string' ? runAt : null,
        timezone: tz,
      });

      const task = await repo.createAsync({
        name,
        description: typeof description === 'string' ? description : undefined,
        scheduleType,
        scheduledTime: typeof scheduledTime === 'string' ? scheduledTime : undefined,
        scheduledDay: typeof scheduledDay === 'number' ? scheduledDay : undefined,
        cronExpression: typeof cronExpression === 'string' ? cronExpression : undefined,
        runAt: typeof runAt === 'string' ? runAt : undefined,
        timezone: tz,
        nextRunAt: nextRunAt ?? undefined,
        prompt,
        agentKind: typeof agentKind === 'string' ? agentKind : 'opencode',
        allowedMcpsJson: allowedMcps != null ? JSON.stringify(allowedMcps) : undefined,
        allowedSkillsJson: allowedSkills != null ? JSON.stringify(allowedSkills) : undefined,
        createdByUserId: req.auth?.user.id,
      });

      res.status(201).json(task);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const existing = await repo.findByIdAsync(id);
      if (!existing) throw AppError.notFound('AgentScheduledTask');

      const patch = req.body as Record<string, unknown>;

      // If schedule-related fields changed, recompute next_run
      const scheduleChanged = ['scheduleType', 'scheduledTime', 'scheduledDay', 'cronExpression', 'runAt', 'timezone'].some(
        (k) => k in patch,
      );
      if (scheduleChanged) {
        const mergedType = (typeof patch.scheduleType === 'string' ? patch.scheduleType : existing.scheduleType);
        patch.nextRunAt = computeNextRun({
          scheduleType: mergedType,
          scheduledTime: typeof patch.scheduledTime === 'string' ? patch.scheduledTime : existing.scheduledTime,
          scheduledDay: typeof patch.scheduledDay === 'number' ? patch.scheduledDay : existing.scheduledDay,
          cronExpression: typeof patch.cronExpression === 'string' ? patch.cronExpression : existing.cronExpression,
          runAt: typeof patch.runAt === 'string' ? patch.runAt : existing.runAt,
          timezone: typeof patch.timezone === 'string' ? patch.timezone : existing.timezone,
        });
      }

      if ('allowedMcps' in patch) {
        patch.allowedMcpsJson = JSON.stringify(patch.allowedMcps);
        delete patch.allowedMcps;
      }
      if ('allowedSkills' in patch) {
        patch.allowedSkillsJson = JSON.stringify(patch.allowedSkills);
        delete patch.allowedSkills;
      }

      const updated = await repo.updateAsync(id, patch as Parameters<typeof repo.updateAsync>[1]);
      res.json(updated);
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const deleted = await repo.deleteAsync(req.params.id);
      if (!deleted) throw AppError.notFound('AgentScheduledTask');
      res.status(204).end();
    } catch (err) { next(err); }
  }

  /** Manually fire a scheduled task immediately (test/debug). */
  async triggerNow(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await repo.findByIdAsync(req.params.id);
      if (!task) throw AppError.notFound('AgentScheduledTask');

      // Force next_run_at to now so the scheduler picks it up in the next tick
      const nowIso = new Date().toISOString();
      await repo.updateAsync(task.id, { nextRunAt: nowIso } as Parameters<typeof repo.updateAsync>[1]);

      res.json({ message: 'Task queued for immediate execution' });
    } catch (err) { next(err); }
  }
}
