export type AutomationActionType =
  | 'create_task'
  | 'create_project_from_template'
  | 'auto_schedule'
  | 'send_notification'
  | 'tag_task';

export type AutomationRuleSource =
  | 'rhythm'
  | 'planning_center'
  | 'google_calendar'
  | 'gmail';

export type AutomationTriggerKey =
  | 'rhythm.project_step_due'
  | 'rhythm.task_due'
  | 'rhythm.plan_assembly'
  | 'planning_center.plan_upcoming'
  | 'planning_center.plan_person_declined'
  | 'planning_center.plan_person_unconfirmed'
  | 'planning_center.needed_position_open'
  | 'planning_center.special_service_candidate'
  | 'google_calendar.event_matching_filter'
  | 'google_calendar.all_day_event'
  | 'gmail.message_matching_filter'
  | 'gmail.unread_message_matching_filter';

export interface AutomationRule {
  id: string;
  name: string;
  source: AutomationRuleSource;
  triggerKey: AutomationTriggerKey;
  triggerConfig: Record<string, unknown> | null;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown> | null;
  enabled: boolean;
  ownerId: number | null;
  sourceAccountId: string | null;
  lastEvaluatedAt: string | null;
  lastMatchedAt: string | null;
  matchCountLastRun: number;
  previewSample: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationRuleDto {
  name: string;
  source: AutomationRuleSource;
  triggerKey: AutomationTriggerKey;
  triggerConfig?: Record<string, unknown>;
  actionType: AutomationActionType;
  actionConfig?: Record<string, unknown>;
  enabled?: boolean;
  ownerId?: number | null;
  sourceAccountId?: string | null;
}

export interface UpdateAutomationRuleDto {
  name?: string;
  source?: AutomationRuleSource;
  triggerKey?: AutomationTriggerKey;
  triggerConfig?: Record<string, unknown> | null;
  actionType?: AutomationActionType;
  actionConfig?: Record<string, unknown> | null;
  enabled?: boolean;
  ownerId?: number | null;
  sourceAccountId?: string | null;
}
