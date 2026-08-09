import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import {
  ExternalContentSecurityService,
  parseSecurityAction,
  parseSecurityPayload,
  requireSecurityPayloadBoundToTrustedArguments,
} from '../services/external_content_security_service';
import { verifyTrustedMcpCall } from '../security/trusted_mcp_call';

const security = new ExternalContentSecurityService();
const EXTERNAL_CONTENT_SOURCES = new Set([
  'gmail.search',
  'gmail.message',
  'message-thread.list',
  'message-thread.task',
  'dashboard.message-preview',
  'calendar.events',
  'trigger.list',
  'scheduled-task.list',
  'task.list',
  'rhythm.list',
  'project-template.list',
  'project-instance.list',
  'facility.list',
  'memory.search',
  'memory.list',
  'research.job',
  'automation.list',
  'automation.get',
  'automation.preview',
  'automation-catalog.triggers',
  'automation-catalog.actions',
  'automation-catalog.providers',
  'agent-session.list',
  'agent-profile.permissions.list',
  'agent-profile.permissions.get',
  'feedback.pco-staffing',
  'feedback.email-sent',
  'feedback.task-complete',
  'pco.service-types',
  'pco.plans',
  'pco.plan-items',
  'pco.needed-positions',
  'live-artifact.list',
  'live-artifact.get',
]);

export const EXTERNAL_CONTENT_TOOLS = new Map<string, string>([
  ['gmail.search', 'rhythm_search_gmail'],
  ['gmail.message', 'rhythm_read_email'],
  ['message-thread.list', 'rhythm_list_message_threads'],
  ['message-thread.task', 'rhythm_get_task_thread'],
  ['dashboard.message-preview', 'rhythm_get_dashboard'],
  ['calendar.events', 'rhythm_list_calendar_events'],
  ['trigger.list', 'rhythm_list_pending_triggers'],
  ['scheduled-task.list', 'rhythm_list_scheduled_tasks'],
  ['task.list', 'rhythm_list_tasks'],
  ['rhythm.list', 'rhythm_list_rhythms'],
  ['project-template.list', 'rhythm_list_project_templates'],
  ['project-instance.list', 'rhythm_list_project_instances'],
  ['facility.list', 'rhythm_list_facilities'],
  ['memory.search', 'rhythm_search_memory'],
  ['memory.list', 'rhythm_list_memories'],
  ['research.job', 'rhythm_get_research_job'],
  ['automation.list', 'rhythm_list_automations'],
  ['automation.get', 'rhythm_get_automation'],
  ['automation.preview', 'rhythm_preview_automation'],
  ['automation-catalog.triggers', 'rhythm_list_automation_triggers'],
  ['automation-catalog.actions', 'rhythm_list_automation_actions'],
  ['automation-catalog.providers', 'rhythm_list_automation_providers'],
  ['agent-session.list', 'rhythm_list_sessions'],
  ['agent-profile.permissions.list', 'rhythm_list_agent_profile_permissions'],
  ['agent-profile.permissions.get', 'rhythm_get_agent_profile_permissions'],
  ['feedback.pco-staffing', 'rhythm_verify_pco_staffing'],
  ['feedback.email-sent', 'rhythm_verify_email_sent'],
  ['feedback.task-complete', 'rhythm_verify_task_complete'],
  ['pco.service-types', 'rhythm_pco_list_service_types'],
  ['pco.plans', 'rhythm_pco_list_plans'],
  ['pco.plan-items', 'rhythm_pco_get_plan_items'],
  ['pco.needed-positions', 'rhythm_pco_list_needed_positions'],
  ['live-artifact.list', 'rhythm_list_live_artifacts'],
  ['live-artifact.get', 'rhythm_get_live_artifact'],
]);

export const SECURITY_ACTION_TOOLS = new Map<string, string>([
  ['email.send', 'rhythm_send_email'],
  ['message.send', 'rhythm_send_message'],
  ['message-thread.create', 'rhythm_create_message_thread'],
  ['calendar.create', 'rhythm_create_calendar_event'],
  ['calendar.update', 'rhythm_update_calendar_event'],
  ['pco.plan-item.update', 'rhythm_pco_update_plan_item'],
  ['pco.person.assign', 'rhythm_pco_assign_person'],
  ['pco.scheduled-person.update', 'rhythm_pco_update_scheduled_person'],
  ['trigger.clear', 'rhythm_clear_pending_trigger'],
  ['task.create', 'rhythm_create_task'],
  ['task.update', 'rhythm_update_task'],
  ['task.complete', 'rhythm_complete_task'],
  ['task.delete', 'rhythm_delete_task'],
  ['rhythm.create', 'rhythm_create_rhythm'],
  ['rhythm.update', 'rhythm_update_rhythm'],
  ['project-instance.create', 'rhythm_create_project_instance'],
  ['facility-reservation.create', 'rhythm_create_reservation'],
  ['memory.remember', 'rhythm_remember_memory'],
  ['memory.forget', 'rhythm_forget_memory'],
  ['research.start', 'rhythm_start_research'],
  ['research.update', 'rhythm_update_research_job'],
  ['org-optimizer.run', 'rhythm_run_org_optimizer'],
  ['delegation.start', 'rhythm_delegate'],
  ['delegation.start-async', 'rhythm_delegate_async'],
  ['delegation.cancel', 'rhythm_delegation_cancel'],
  ['notification.send', 'rhythm_notify'],
  ['scheduled-task.create', 'rhythm_create_scheduled_task'],
  ['scheduled-task.cancel', 'rhythm_cancel_scheduled_task'],
  ['scheduled-task.trigger', 'rhythm_trigger_now'],
  ['memory.update', 'rhythm_update_memory'],
  ['memory.lifecycle', 'rhythm_verify_memory'],
  ['rhythm.delete', 'rhythm_delete_rhythm'],
  ['rhythm-step.create', 'rhythm_add_rhythm_step'],
  ['rhythm-step.delete', 'rhythm_delete_rhythm_step'],
  ['project-template.create', 'rhythm_create_project_template'],
  ['project-template-step.create', 'rhythm_add_project_step'],
  ['project-step.update', 'rhythm_update_project_step'],
  ['automation.create', 'rhythm_create_automation'],
  ['automation.update', 'rhythm_update_automation'],
  ['automation.delete', 'rhythm_delete_automation'],
  ['automation.resync', 'rhythm_resync_automation'],
  ['agent-profile.create', 'rhythm_create_agent_profile'],
  ['agent-profile.permissions.update', 'rhythm_update_agent_profile_permissions'],
  ['creative-capability.install', 'rhythm_install_creative_capability'],
  ['creative-artifact.record', 'rhythm_record_design'],
  ['org-optimizer.external-discovery', 'rhythm_run_external_discovery'],
  ['live-artifact.create', 'rhythm_create_live_artifact'],
  ['live-artifact.state.update', 'rhythm_update_live_artifact_state'],
  ['live-artifact.bundle.update', 'rhythm_update_live_artifact_bundle'],
]);

async function requireTrustedCall(
  value: unknown,
  expectedToolName: string,
  nonceScope: string,
) {
  try {
    return await verifyTrustedMcpCall(
      value,
      expectedToolName,
      Date.now(),
      nonceScope,
    );
  } catch (err) {
    // Naming the reason is the whole point of this catch. It used to swallow
    // the error, which made the #1094 dashboard 403 undiagnosable: the
    // operator saw a bare "403" and could not tell a missing envelope from a
    // replayed nonce, a stale proof, or a tool-name mismatch — the three have
    // completely different fixes.
    //
    // Every reason verifyTrustedMcpCall throws is a fixed, content-free
    // sentence ('trusted MCP call is missing', '… payload mismatch', '… is
    // expired', '… was already consumed', '… signature is invalid'). It
    // carries no external content, no arguments, no digest and no key
    // material, so it is safe to log and to return to the localhost caller.
    // The error handler logs every AppError message, so this is the
    // server-side log too.
    const reason =
      err instanceof Error && err.message !== ''
        ? err.message
        : 'unknown trusted-call verification failure';
    throw AppError.forbidden(
      `trusted Rhythm MCP caller is required for ${expectedToolName}: ${reason}`,
    );
  }
}

export class ExternalContentSecurityController {
  async taint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body ?? {};
      const source = typeof body.source === 'string' ? body.source.trim() : '';
      if (!EXTERNAL_CONTENT_SOURCES.has(source)) {
        throw AppError.badRequest('source is not an approved external-content ingress');
      }
      const expectedToolName = EXTERNAL_CONTENT_TOOLS.get(source);
      if (!expectedToolName) {
        throw AppError.forbidden('external-content source has no trusted MCP tool binding');
      }
      const trustedCall = await requireTrustedCall(
        body.trustedCall,
        expectedToolName,
        'external-content-taint',
      );
      if (typeof body.blocked !== 'boolean') {
        throw AppError.badRequest('blocked must be a boolean');
      }
      const contentDigest = typeof body.contentDigest === 'string' ? body.contentDigest : '';
      const result = security.markTainted({
        context: trustedCall.context,
        source,
        contentDigest,
        blocked: body.blocked,
        diagnostics: body.diagnostics,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async consume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body ?? {};
      const action = parseSecurityAction(body.action);
      const expectedToolName = SECURITY_ACTION_TOOLS.get(action);
      if (!expectedToolName) {
        throw AppError.forbidden('security action has no trusted MCP tool binding');
      }
      const trustedCall = await requireTrustedCall(
        body.trustedCall,
        expectedToolName,
        'approval-consume',
      );
      const payload = parseSecurityPayload(body.payload);
      requireSecurityPayloadBoundToTrustedArguments(
        action,
        trustedCall.arguments,
        payload,
      );
      const result = security.consumeApproval({
        context: trustedCall.context,
        approvalId:
          typeof body.approvalId === 'string' && body.approvalId !== ''
            ? body.approvalId
            : undefined,
        action,
        payload,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}
