export type AutomationTriggerType =
  | 'project_step_due'
  | 'task_due'
  | 'plan_assembly';

export type AutomationActionType =
  | 'auto_schedule'
  | 'send_notification'
  | 'tag_task';

export interface AutomationRule {
  id: string;
  name: string;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown> | null;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationRuleDto {
  name: string;
  triggerType: AutomationTriggerType;
  triggerConfig?: Record<string, unknown>;
  actionType: AutomationActionType;
  actionConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateAutomationRuleDto {
  name?: string;
  triggerType?: AutomationTriggerType;
  triggerConfig?: Record<string, unknown> | null;
  actionType?: AutomationActionType;
  actionConfig?: Record<string, unknown> | null;
  enabled?: boolean;
}
