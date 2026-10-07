import type { NextFunction, Request, Response } from 'express';

import {
  parseCoordinatorConversationAddGoal,
  parseCoordinatorConversationContinuePlan,
  parseCoordinatorConversationHistory,
  parseCoordinatorConversationMessage,
  parseCoordinatorConversationOpen,
  parseCoordinatorConversationPreparePlan,
  parseCoordinatorConversationResolve,
  parseCoordinatorConversationSetup,
} from '../contracts/coordinator_conversation_contract';
import { AppError } from '../errors/app_error';
import type { AuthContext } from '../middleware/auth_middleware';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';

function actor(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthorized('Authentication required');
  return req.auth;
}

export function coordinatorConversationResponseStatus(kind: string): number {
  if (kind === 'created' || kind === 'setup_created') return 201;
  // Ambiguous current configured profiles are an expected closed setup state,
  // not an availability failure. The authenticated caller must choose one of
  // the server-provided opaque options and replay the same command key.
  if (kind === 'setup_profile_choice_required') return 200;
  if (['not_found'].includes(kind)) return 404;
  if (['schema_unavailable', 'context_unavailable', 'history_unavailable', 'model_integration_unavailable', 'planner_unavailable', 'continuation_adapter_unavailable', 'planning_authority_unavailable', 'setup_unavailable'].includes(kind)) return 503;
  if ([
    'revision_conflict', 'command_conflict', 'goal_limit', 'authority_conflict',
    'planning_not_authorized', 'planning_context_unavailable', 'planning_dependency_blocked',
    'planning_goal_not_found', 'planning_authority_required', 'planning_authority_conflict',
    'planning_dependency_hold', 'planning_terminal_hold', 'planning_already_linked',
    'planning_link_conflict', 'planning_dispatch_hold', 'foreground_uncertain',
  ].includes(kind)) return 409;
  if (kind === 'integrity_hold') return 409;
  return 200;
}

/**
 * Unmounted C1 HTTP surface. The router supplies existing local/cloud auth;
 * no route accepts a persisted continuation authority, model/provider choice,
 * raw context, SDK/session history, or a dispatch instruction from a browser.
 * `prepare-plan` accepts only a bounded user acknowledgement of total tokens;
 * the server derives and binds every model/session/workstream field.
 */
export class CoordinatorConversationsController {
  constructor(private readonly service: CoordinatorConversationService) {}

  open(req: Request, res: Response, next: NextFunction): void {
    try {
      const result = this.service.open(actor(req), parseCoordinatorConversationOpen(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  resolve(req: Request, res: Response, next: NextFunction): void {
    try {
      const result = this.service.resolvePrimary(actor(req), parseCoordinatorConversationResolve(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  async setup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.setupPrimary(actor(req), parseCoordinatorConversationSetup(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.status(actor(req), parseCoordinatorConversationOpen(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  async message(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.receiveMessage(actor(req), parseCoordinatorConversationMessage(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  history(req: Request, res: Response, next: NextFunction): void {
    try {
      const result = this.service.history(actor(req), parseCoordinatorConversationHistory(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  addGoal(req: Request, res: Response, next: NextFunction): void {
    try {
      const result = this.service.addGoal(actor(req), parseCoordinatorConversationAddGoal(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  async preparePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.preparePlan(actor(req), parseCoordinatorConversationPreparePlan(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }

  async continuePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.continuePlan(actor(req), parseCoordinatorConversationContinuePlan(req.body));
      res.status(coordinatorConversationResponseStatus(result.kind)).json(result);
    } catch (error) { next(error); }
  }
}
