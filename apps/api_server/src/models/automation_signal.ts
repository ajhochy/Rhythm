import type { AutomationRuleSource } from './automation_rule';

export type AutomationSignalType =
  | 'task_due'
  | 'project_step_due'
  | 'plan_assembly'
  | 'plan_upcoming'
  | 'plan_published'
  | 'service_item_updated'
  | 'needed_position_open'
  | 'team_member_declined'
  | 'team_member_unconfirmed'
  | 'special_service_candidate'
  | 'calendar_event_seen'
  | 'calendar_event_today'
  | 'gmail_message_seen'
  | 'gmail_unread_message_seen'
  | 'gmail_message_from_sender';

export interface AutomationSignal {
  id: string;
  provider: AutomationRuleSource;
  signalType: AutomationSignalType;
  externalId: string;
  dedupeKey: string;
  occurredAt: string | null;
  syncedAt: string;
  sourceAccountId: string | null;
  sourceLabel: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationSignalDto {
  provider: AutomationRuleSource;
  signalType: AutomationSignalType;
  externalId: string;
  dedupeKey: string;
  occurredAt?: string | null;
  syncedAt: string;
  sourceAccountId?: string | null;
  sourceLabel?: string | null;
  payload: Record<string, unknown>;
}
