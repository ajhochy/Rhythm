import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { computeNextRun } from '../services/agentSchedulerService';

const repo = new AgentScheduledTasksRepository();
const configsRepo = new AgentConfigsRepository();

/**
 * #1039 Cause A / #1088 — a scheduled task runs its bound profile as a
 * TOP-LEVEL agent (AgentRunner passes `agent: <profileId>` to opencode). A
 * profile that is not SCHEDULABLE is projected `mode: subagent`
 * (opencode_agent_writer) and opencode exposes subagents ONLY as delegation
 * targets — resolving one as a top-level `agent:` throws "Agent not found",
 * which used to surface as the silent "model produced no output" at run
 * time. Reject that binding here, at config time, with an actionable message
 * instead. CLI kinds either have no agent_configs row (getById returns null)
 * or exist only as preset rows (preset_id set) — presets are excluded from
 * .md projection entirely (opencode_agent_writer), so they can never be a
 * delegation-only subagent and the guard must not fire on them regardless of
 * schedulable/session_selectable (which for presets only controls picker
 * visibility). Never throws on lookup.
 *
 * #1088: `config.schedulable` is picker-INDEPENDENT (falls back to
 * `sessionSelectable` when no explicit override is stored — see
 * agent_configs_repository), so a hidden specialist explicitly marked
 * schedulable passes this guard even though it is not session-selectable,
 * while a genuinely delegation-only profile (schedulable resolves false,
 * whether by explicit override or by sessionSelectable fallback) is still
 * rejected exactly as before.
 */
function assertSchedulableProfile(configId: string | null | undefined): void {
  if (!configId || typeof configId !== 'string') return;
  const config = configsRepo.getById(configId);
  if (!config) return; // not a profile (CLI kind / built-in) — runnable
  if (config.locked === true) {
    throw AppError.badRequest(agentConfigExecutionBlockReason(config)!);
  }
  if (config.presetId) return; // CLI preset — runs via PTY runner, never a subagent
  if ((config.schedulable ?? config.sessionSelectable) === false) {
    throw AppError.badRequest(
      `"${config.label}" is a delegation-only subagent and can't be scheduled — ` +
        `make it schedulable (or session-selectable) in the agent designer to run it standalone.`,
    );
  }
}

export class AgentSchedulesController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const tasks = req.mobileDevice
        ? await repo.listForOwnerAsync(req.mobileDevice.userId)
        : await repo.listAllAsync();
      res.json(tasks);
    } catch (err) { next(err); }
  }

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const task = req.mobileDevice
        ? await repo.findByIdForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.findByIdAsync(req.params.id);
      if (!task) throw AppError.notFound('AgentScheduledTask');
      res.json(task);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name, description, scheduleType, scheduledTime, scheduledDay,
        cronExpression, runAt, timezone, prompt, agentKind, agentConfigId,
        allowedMcps, allowedSkills, modelProvider, modelId,
      } = req.body as Record<string, unknown>;

      if (!name || typeof name !== 'string') throw AppError.badRequest('name is required');
      if (!scheduleType || typeof scheduleType !== 'string') throw AppError.badRequest('scheduleType is required');
      if (!prompt || typeof prompt !== 'string') throw AppError.badRequest('prompt is required');

      // model-override — per-task model override. Both must be strings when present, and
      // they go together (a provider without a model id, or vice versa, can't
      // resolve a model). Omitting both means "inherit the profile model".
      if (modelProvider != null && typeof modelProvider !== 'string') throw AppError.badRequest('modelProvider must be a string');
      if (modelId != null && typeof modelId !== 'string') throw AppError.badRequest('modelId must be a string');
      if ((modelProvider == null) !== (modelId == null)) {
        throw AppError.badRequest('modelProvider and modelId must be set together');
      }

      // Validate schedule type
      const validTypes = ['daily', 'weekly', 'monthly', 'cron', 'once'];
      if (!validTypes.includes(scheduleType)) {
        throw AppError.badRequest(`scheduleType must be one of: ${validTypes.join(', ')}`);
      }

      // #1039: reject binding to a delegation-only (non-session-selectable)
      // profile before the row is created. Mirror the createAsync agentConfigId
      // fallback so the id we validate is the id that will actually be bound.
      assertSchedulableProfile(
        typeof agentConfigId === 'string'
          ? agentConfigId
          : typeof agentKind === 'string'
            ? agentKind
            : null,
      );

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
        agentKind: typeof agentKind === 'string' ? agentKind : (typeof agentConfigId === 'string' ? agentConfigId : 'opencode'),
        agentConfigId: typeof agentConfigId === 'string' ? agentConfigId : (typeof agentKind === 'string' ? agentKind : null),
        allowedMcpsJson: allowedMcps != null ? JSON.stringify(allowedMcps) : undefined,
        allowedSkillsJson: allowedSkills != null ? JSON.stringify(allowedSkills) : undefined,
        modelProvider: typeof modelProvider === 'string' ? modelProvider : undefined,
        modelId: typeof modelId === 'string' ? modelId : undefined,
        createdByUserId: req.auth?.user.id,
      });

      res.status(201).json(task);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const existing = req.mobileDevice
        ? await repo.findByIdForOwnerAsync(id, req.mobileDevice.userId)
        : await repo.findByIdAsync(id);
      if (!existing) throw AppError.notFound('AgentScheduledTask');

      const patch = req.body as Record<string, unknown>;

      // #1039: if this update re-binds the task to a different profile, re-run
      // the delegation-only guard against the new binding.
      if ('agentConfigId' in patch || 'agentKind' in patch) {
        const nextConfigId =
          typeof patch.agentConfigId === 'string'
            ? patch.agentConfigId
            : typeof patch.agentKind === 'string'
              ? patch.agentKind
              : (existing.agentConfigId ?? existing.agentKind);
        assertSchedulableProfile(nextConfigId);
      }

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

      const updated = req.mobileDevice
        ? await repo.updateForOwnerAsync(
            id,
            req.mobileDevice.userId,
            patch as Parameters<typeof repo.updateAsync>[1],
          )
        : await repo.updateAsync(
            id,
            patch as Parameters<typeof repo.updateAsync>[1],
          );
      if (!updated) throw AppError.notFound('AgentScheduledTask');
      res.json(updated);
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
      if (!deleted) throw AppError.notFound('AgentScheduledTask');
      res.status(204).end();
    } catch (err) { next(err); }
  }

  /** Manually fire a scheduled task immediately (test/debug). */
  async triggerNow(req: Request, res: Response, next: NextFunction) {
    try {
      const task = req.mobileDevice
        ? await repo.findByIdForOwnerAsync(
            req.params.id,
            req.mobileDevice.userId,
          )
        : await repo.findByIdAsync(req.params.id);
      if (!task) throw AppError.notFound('AgentScheduledTask');

      // Force next_run_at to now so the scheduler picks it up in the next tick,
      // and expose an honest queued state until the scheduler records running
      // or terminal status.
      const updated = await repo.queueNowAsync(task.id);

      // Return the full updated task, not just a message — the Flutter client
      // parses this response as an AgentScheduledTask to merge into its local
      // list. A message-only body used to silently parse into a garbage task
      // (empty id/name, 'daily'/'opencode' fallback defaults) that overwrote
      // the real triggered task in local state.
      res.json(updated ?? task);
    } catch (err) { next(err); }
  }
}
