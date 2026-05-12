import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { TasksRepository } from '../repositories/tasks_repository';
import { NotificationsRepository } from '../repositories/notifications_repository';
import { NotificationService } from '../services/notification_service';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { ClaudeTriggersRepository } from '../repositories/claude_triggers_repository';
import { env } from '../config/env';
import { EmailService } from '../services/email_service';
import { UsersRepository } from '../repositories/users_repository';
import { emitAppEvent } from '../utils/app_events';
import type { FilterStatus, TaskFilter } from '../models/task_filter';

// Re-export so callers that previously imported from this module still work.
export type { TaskFilter };

const VALID_STATUSES = ['open', 'in_progress', 'waiting_for_reply', 'done'] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

/** Status values accepted by the filter param (superset of task statuses; 'all' means no filter). */
const VALID_FILTER_STATUSES = ['open', 'in_progress', 'waiting_for_reply', 'done', 'all'] as const;

/** Discriminated union returned by parseTaskFilters. */
type ParseResult =
  | { ok: true; filter: TaskFilter }
  | { ok: false; field: string; message: string };

/** Strict ISO date validation: must match YYYY-MM-DD and produce a valid Date. */
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

/**
 * Parse and validate query parameters for GET /tasks.
 * Returns a validated TaskFilter on success or a field-level error on failure.
 */
export function parseTaskFilters(query: Request['query'], userId: number): ParseResult {
  // --- status ---
  let status: FilterStatus = 'open'; // default preserves backward compatibility
  if (query.status !== undefined) {
    const raw = query.status as string;
    if (!VALID_FILTER_STATUSES.includes(raw as FilterStatus)) {
      return {
        ok: false,
        field: 'status',
        message: `status must be one of: ${VALID_FILTER_STATUSES.join(', ')}`,
      };
    }
    status = raw as FilterStatus;
  }

  // --- scheduled_before ---
  let scheduledBefore: string | undefined;
  if (query.scheduled_before !== undefined) {
    const raw = query.scheduled_before as string;
    if (!isValidIsoDate(raw)) {
      return {
        ok: false,
        field: 'scheduled_before',
        message: 'scheduled_before must be a valid date in YYYY-MM-DD format',
      };
    }
    scheduledBefore = raw;
  }

  // --- due_before ---
  let dueBefore: string | undefined;
  if (query.due_before !== undefined) {
    const raw = query.due_before as string;
    if (!isValidIsoDate(raw)) {
      return {
        ok: false,
        field: 'due_before',
        message: 'due_before must be a valid date in YYYY-MM-DD format',
      };
    }
    dueBefore = raw;
  }

  // --- overdue ---
  let overdue: boolean | undefined;
  if (query.overdue !== undefined) {
    const raw = query.overdue as string;
    if (raw !== 'true' && raw !== 'false') {
      return {
        ok: false,
        field: 'overdue',
        message: "overdue must be 'true' or 'false'",
      };
    }
    overdue = raw === 'true';
  }

  // --- search ---
  let search: string | undefined;
  if (query.search !== undefined) {
    search = query.search as string;
  }

  // Inject today's date so the repository never calls new Date() itself.
  const today = new Date().toISOString().slice(0, 10);

  return {
    ok: true,
    filter: { userId, status, scheduledBefore, dueBefore, overdue, search, today },
  };
}

const VALID_PREFERRED_AGENTS = ['claude-code', 'codex'] as const;
type ValidPreferredAgent = (typeof VALID_PREFERRED_AGENTS)[number];

function validatePreferredAgent(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !VALID_PREFERRED_AGENTS.includes(value as ValidPreferredAgent)) {
    throw AppError.badRequest(
      `preferredAgent must be one of: ${VALID_PREFERRED_AGENTS.join(', ')}, or null`,
    );
  }
  return value;
}

const repo = new TasksRepository();
const rulesRepo = new RecurringTaskRulesRepository();
const notifService = new NotificationService(new NotificationsRepository());
const claudeTriggersRepo = new ClaudeTriggersRepository();
const usersRepo = new UsersRepository();
const emailService = new EmailService(usersRepo);

export class TasksController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.auth!.user.id;
      const result = parseTaskFilters(req.query, userId);
      if (!result.ok) {
        res.status(400).json({
          error: 'validation',
          field: result.field,
          message: result.message,
        });
        return;
      }
      res.json(await repo.findByFilterAsync(result.filter));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await repo.findByIdAsync(req.params.id, req.auth!.user.id));
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, notes, dueDate, status, preferredAgent } = req.body as Record<string, unknown>;
      if (!title || typeof title !== 'string') {
        throw AppError.badRequest('title is required');
      }
      if (status !== undefined && !VALID_STATUSES.includes(status as ValidStatus)) {
        throw AppError.badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      const validatedPreferredAgent = validatePreferredAgent(preferredAgent);
      const task = await repo.createAsync({
        title,
        notes: (notes as string) ?? null,
        dueDate: (dueDate as string) ?? null,
        status: status as ValidStatus,
        ownerId: req.auth!.user.id,
        preferredAgent: validatedPreferredAgent,
      });
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = req.auth!.user.id;
      const data = req.body as Record<string, unknown>;

      if (data.status !== undefined && !VALID_STATUSES.includes(data.status as ValidStatus)) {
        throw AppError.badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
      }

      // Validate preferredAgent if provided; inject the validated value back so
      // the repository receives a clean string | null (not undefined).
      const patchData: Record<string, unknown> = { ...data };
      if ('preferredAgent' in data) {
        patchData.preferredAgent = validatePreferredAgent(data.preferredAgent);
      }

      const existing = await repo.findByIdAsync(req.params.id, actorId);
      const updated = await repo.updateAsync(
        req.params.id,
        patchData as Parameters<typeof repo.updateAsync>[1],
        actorId,
      );

      // Notify on assignment
      if (
        data.ownerId !== undefined &&
        updated.ownerId != null &&
        updated.ownerId !== existing.ownerId &&
        actorId != null
      ) {
        await notifService.notifyTaskAssignedAsync(
          updated.id,
          updated.title,
          updated.ownerId,
          actorId,
        );
        const actor = await usersRepo.findByIdAsync(actorId).catch(() => null);
        if (actor) {
          await emailService.sendTaskAssignedEmailAsync(
            updated.id,
            updated.title,
            actor.name,
            updated.ownerId,
            actorId,
          );
        }
      }

      // Notify collaborators on task completion
      if (
        data.status === 'done' &&
        existing.status !== 'done' &&
        actorId != null
      ) {
        const collaborators = await repo.listCollaboratorsAsync(updated.id);
        const collaboratorIds = collaborators.map((c) => c.userId);
        if (updated.ownerId != null && !collaboratorIds.includes(updated.ownerId)) {
          collaboratorIds.push(updated.ownerId);
        }
        if (collaboratorIds.length > 0) {
          await notifService.notifyStepCompletedAsync(
            'task',
            updated.id,
            updated.title,
            updated.title,
            collaboratorIds,
            actorId,
          );
        }

        // Sequential rhythm: unlock next step and notify its assignee
        await maybeUnlockNextSequentialStep(updated.sourceType, updated.sourceId, updated.dueDate);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = req.auth!.user.id;
      const task = await repo.findByIdAsync(req.params.id, actorId);
      if (task.ownerId !== actorId) {
        throw AppError.forbidden('Only the task owner can delete this task');
      }
      await repo.deleteAsync(req.params.id, actorId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async getCollaborators(req: Request, res: Response, next: NextFunction) {
    try {
      await repo.findByIdAsync(req.params.id, req.auth!.user.id);
      res.json(await repo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async addCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.body as Record<string, unknown>;
      if (!userId || typeof userId !== 'number') {
        throw AppError.badRequest('userId is required and must be a number');
      }
      const actorId = req.auth!.user.id;
      const task = await repo.findByIdAsync(req.params.id, actorId);
      if (task.ownerId !== actorId) {
        throw AppError.forbidden('Only the task owner can add collaborators');
      }
      await repo.addCollaboratorAsync(req.params.id, userId);
      await notifService.notifyCollaboratorAddedAsync(
        'task',
        req.params.id,
        task.title,
        userId,
        actorId,
      );
      const actor = await usersRepo.findByIdAsync(actorId).catch(() => null);
      if (actor) {
        await emailService.sendCollaboratorAddedEmailAsync(
          req.params.id,
          task.title,
          actor.name,
          userId,
          actorId,
        );
      }
      if (env.claudeUserId != null && userId === env.claudeUserId) {
        await claudeTriggersRepo.insertAsync(req.params.id, actorId);
        emitAppEvent({
          event: 'claude.trigger',
          taskId: req.params.id,
          taskTitle: task.title,
          triggeredByUserId: actorId,
        });
      }
      res.status(201).json(await repo.listCollaboratorsAsync(req.params.id));
    } catch (err) {
      next(err);
    }
  }

  async removeCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const collaboratorUserId = Number(req.params.userId);
      if (isNaN(collaboratorUserId)) {
        throw AppError.badRequest('Invalid userId');
      }
      const actorId = req.auth!.user.id;
      const task = await repo.findByIdAsync(req.params.id, actorId);
      if (task.ownerId !== actorId) {
        throw AppError.forbidden('Only the task owner can remove collaborators');
      }
      await repo.removeCollaboratorAsync(req.params.id, collaboratorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}

/**
 * When a sequential rhythm step task is completed, unlock the next step's
 * task for the same due date and notify its assignee.
 */
async function maybeUnlockNextSequentialStep(
  sourceType: string | null,
  sourceId: string | null,
  dueDate: string | null,
): Promise<void> {
  if (sourceType !== 'recurring_rule' || !sourceId || !dueDate) return;

  // Step tasks have sourceId in the form "ruleId:stepId"
  const colonIdx = sourceId.indexOf(':');
  if (colonIdx === -1) return;

  const ruleId = sourceId.slice(0, colonIdx);
  const stepId = sourceId.slice(colonIdx + 1);

  const rule = await rulesRepo.findByIdAsync(ruleId).catch(() => null);
  if (!rule || !rule.sequential) return;

  const completedStepIndex = rule.steps.findIndex((s) => s.id === stepId);
  if (completedStepIndex === -1 || completedStepIndex >= rule.steps.length - 1) return;

  const nextStep = rule.steps[completedStepIndex + 1];
  const nextSourceId = `${ruleId}:${nextStep.id}`;

  const nextTask = await repo.findBySourceAndDueDateAsync('recurring_rule', nextSourceId, dueDate);
  if (!nextTask || !nextTask.locked) return;

  await repo.updateAsync(nextTask.id, { locked: false });

  if (nextStep.assigneeId != null) {
    await notifService.notifyStepUnlockedAsync(
      ruleId,
      rule.title,
      nextStep.title,
      nextStep.assigneeId,
    );
  }
}
