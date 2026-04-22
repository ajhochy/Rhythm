import { MessagesRepository } from '../repositories/messages_repository';
import { AutomationRulesRepository } from '../repositories/automation_rules_repository';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import type { AutomationSignal } from '../models/automation_signal';
import type { AutomationRule, Condition } from '../models/automation_rule';
import { ProjectGenerationService } from './project_generation_service';

interface EvaluationResult {
  matchedRules: number;
  executedActions: number;
  matchesByRuleId: Record<string, number>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => item != null);
}

function interpolate(template: string | null, signal: AutomationSignal): string {
  const fallback = template ?? '';
  const tokens = {
    provider: signal.provider,
    signalType: signal.signalType,
    title: asString(signal.payload.title) ?? '',
    subject: asString(signal.payload.subject) ?? '',
    sender: asString(signal.payload.fromEmail) ?? asString(signal.payload.fromName) ?? '',
    serviceType: asString(signal.payload.serviceTypeName) ?? '',
    position: asString(signal.payload.positionName) ?? '',
    team: asString(signal.payload.teamName) ?? '',
    date: asString(signal.payload.planDate) ?? asString(signal.payload.startDate) ?? '',
    snippet: asString(signal.payload.snippet) ?? '',
  };

  return fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key as keyof typeof tokens] ?? '');
}

function computeDateOffset(baseDate: string | null, daysOffset: number): string | null {
  if (!baseDate) return null;
  const normalized = baseDate.includes('T') ? baseDate.slice(0, 10) : baseDate;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return date.toISOString().slice(0, 10);
}

function scheduleToTargetDay(dateString: string | null, targetDay: number): string | null {
  if (!dateString) return null;
  const normalized = dateString.includes('T') ? dateString.slice(0, 10) : dateString;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  while (date.getUTCDay() !== targetDay) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function scheduleToWeekdayInSameWeek(dateString: string | null, targetDay: number): string | null {
  if (!dateString) return null;
  if (targetDay < 1 || targetDay > 7) return null;
  const normalized = dateString.includes('T') ? dateString.slice(0, 10) : dateString;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const currentIsoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + targetDay - currentIsoDay);
  return date.toISOString().slice(0, 10);
}

function taskSourceId(rule: AutomationRule, signal: AutomationSignal): string {
  if (signal.provider === 'gmail') {
    const threadId = asString(signal.payload.threadId);
    if (threadId != null) {
      return `${rule.id}:gmail-thread:${threadId}`;
    }
  }
  return `${rule.id}:${signal.dedupeKey}`;
}

export class AutomationEngineService {
  private readonly rulesRepo = new AutomationRulesRepository();
  private readonly tasksRepo = new TasksRepository();
  private readonly messagesRepo = new MessagesRepository();
  private readonly usersRepo = new UsersRepository();
  private readonly templatesRepo = new ProjectTemplatesRepository();
  private readonly projectGeneration = new ProjectGenerationService();

  async evaluateSignals(
    source: AutomationRule['source'],
    signals: AutomationSignal[],
  ): Promise<EvaluationResult> {
    const rules = await this.rulesRepo.findEnabledBySourceAsync(source);
    const matchesByRuleId: Record<string, number> = {};
    let matchedRules = 0;
    let executedActions = 0;

    for (const rule of rules) {
      const matchingSignals = signals.filter(
        (signal) => this.matchesRule(rule, signal) && this.evaluateConditions(rule.conditions, signal),
      );
      const preview = matchingSignals[0]?.payload ?? null;
      await this.rulesRepo.updateEvaluationAsync(rule.id, {
        lastEvaluatedAt: new Date().toISOString(),
        lastMatchedAt: matchingSignals[0] ? new Date().toISOString() : null,
        matchCountLastRun: matchingSignals.length,
        previewSample: preview,
      });

      if (matchingSignals.length === 0) continue;
      matchedRules += 1;
      matchesByRuleId[rule.id] = matchingSignals.length;

      for (const signal of matchingSignals) {
        if (await this.executeAction(rule, signal)) {
          executedActions += 1;
        }
      }
    }

    return { matchedRules, executedActions, matchesByRuleId };
  }

  private matchesRule(rule: AutomationRule, signal: AutomationSignal): boolean {
    const triggerKeys = asStringArray(rule.triggerConfig?.triggerKeys);
    if (triggerKeys.length > 0) {
      return triggerKeys.some((triggerKey) => this.matchesTriggerKey(triggerKey, rule, signal));
    }
    return this.matchesTriggerKey(rule.triggerKey, rule, signal);
  }

  private matchesTriggerKey(
    triggerKey: string,
    rule: AutomationRule,
    signal: AutomationSignal,
  ): boolean {
    switch (triggerKey) {
      case 'rhythm.task_due':
        return signal.signalType === 'task_due' && this.matchesDaysBeforeDue(rule, signal);
      case 'rhythm.project_step_due':
        return signal.signalType === 'project_step_due' && this.matchesDaysBeforeDue(rule, signal);
      case 'rhythm.plan_assembly':
        return signal.signalType === 'plan_assembly';
      case 'planning_center.plan_upcoming':
        return signal.signalType === 'plan_upcoming' && this.matchesPlanningCenterFilters(rule, signal);
      case 'planning_center.plan_published':
        return signal.signalType === 'plan_published' && this.matchesPlanningCenterFilters(rule, signal);
      case 'planning_center.service_item_updated':
        return signal.signalType === 'service_item_updated' && this.matchesPlanningCenterFilters(rule, signal);
      case 'planning_center.plan_person_declined':
        return signal.signalType === 'team_member_declined' && this.matchesPlanningCenterFilters(rule, signal);
      case 'planning_center.plan_person_unconfirmed':
        return signal.signalType === 'team_member_unconfirmed' && this.matchesPlanningCenterFilters(rule, signal);
      case 'planning_center.needed_position_open':
        return signal.signalType === 'needed_position_open' && this.matchesPlanningCenterFilters(rule, signal);
      case 'planning_center.special_service_candidate':
        return signal.signalType === 'special_service_candidate' && this.matchesPlanningCenterFilters(rule, signal);
      case 'google_calendar.event_matching_filter':
        return (
          (signal.signalType === 'calendar_event_seen' || signal.signalType === 'calendar_event_today') &&
          this.matchesCalendarFilters(rule, signal)
        );
      case 'google_calendar.all_day_event':
        return (
          (signal.signalType === 'calendar_event_seen' || signal.signalType === 'calendar_event_today') &&
          signal.payload.isAllDay === true &&
          this.matchesCalendarFilters(rule, signal)
        );
      case 'gmail.message_matching_filter':
        return (
          (signal.signalType === 'gmail_message_seen' || signal.signalType === 'gmail_message_from_sender') &&
          this.matchesGmailFilters(rule, signal, false)
        );
      case 'gmail.unread_message_matching_filter':
        return (
          (signal.signalType === 'gmail_unread_message_seen' || signal.signalType === 'gmail_message_from_sender') &&
          this.matchesGmailFilters(rule, signal, true)
        );
      default:
        return false;
    }
  }

  private matchesDaysBeforeDue(rule: AutomationRule, signal: AutomationSignal): boolean {
    const config = rule.triggerConfig ?? {};
    const daysBeforeDue = asNumber(config.daysBeforeDue);
    if (daysBeforeDue == null) return true;
    const daysUntilDue = asNumber(signal.payload.daysUntilDue);
    if (daysUntilDue == null) return true;
    return daysUntilDue <= daysBeforeDue;
  }

  private matchesPlanningCenterFilters(rule: AutomationRule, signal: AutomationSignal): boolean {
    const config = rule.triggerConfig ?? {};
    const leadDays = asNumber(config.leadDays);
    const signalLeadDays = asNumber(signal.payload.daysUntil);
    if (leadDays != null && signalLeadDays != null && signalLeadDays > leadDays) return false;
    const serviceType = asString(config.serviceType);
    if (serviceType != null && serviceType !== asString(signal.payload.serviceTypeName)) return false;
    const signalTeamId = asString(signal.payload.teamId);
    const teamIds = asStringArray(config.teamIds);
    if (teamIds.length > 0) {
      if (signalTeamId == null || !teamIds.includes(signalTeamId)) return false;
    }
    const teamId = asString(config.teamId);
    if (teamId != null && teamId !== signalTeamId) return false;
    const signalPositionName = asString(signal.payload.positionName)?.toLowerCase();
    const positionNames = asStringArray(config.positionNames).map((item) => item.toLowerCase());
    if (positionNames.length > 0) {
      if (signalPositionName == null || !positionNames.includes(signalPositionName)) return false;
    }
    const positionName = asString(config.positionName)?.toLowerCase();
    if (
      positionName != null &&
      positionName !== signalPositionName
    ) {
      return false;
    }
    return true;
  }

  private matchesCalendarFilters(rule: AutomationRule, signal: AutomationSignal): boolean {
    const config = rule.triggerConfig ?? {};
    const query = asString(config.textQuery)?.toLowerCase();
    if (query != null) {
      const haystack = [
        asString(signal.payload.title),
        asString(signal.payload.description),
        asString(signal.payload.location),
      ]
        .filter((value): value is string => value != null)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    const eventType = asString(config.eventType);
    if (eventType != null && eventType !== asString(signal.payload.eventType)) return false;

    if (config.allDayOnly == true && signal.payload.isAllDay !== true) return false;

    const dateWindowDays = asNumber(config.dateWindowDays);
    if (dateWindowDays != null) {
      const daysUntil = asNumber(signal.payload.daysUntilStart);
      if (daysUntil != null && daysUntil > dateWindowDays) return false;
    }

    return true;
  }

  private matchesGmailFilters(
    rule: AutomationRule,
    signal: AutomationSignal,
    unreadOnly: boolean,
  ): boolean {
    const config = rule.triggerConfig ?? {};
    if (unreadOnly && signal.payload.isUnread !== true) return false;

    const sender = asString(config.sender)?.toLowerCase();
    if (sender != null) {
      const fromEmail = asString(signal.payload.fromEmail)?.toLowerCase() ?? '';
      const fromName = asString(signal.payload.fromName)?.toLowerCase() ?? '';
      if (!fromEmail.includes(sender) && !fromName.includes(sender)) return false;
    }

    const subjectContains = asString(config.subjectContains)?.toLowerCase();
    if (subjectContains != null) {
      const subject = asString(signal.payload.subject)?.toLowerCase() ?? '';
      if (!subject.includes(subjectContains)) return false;
    }

    const label = asString(config.label)?.toUpperCase();
    if (label != null) {
      const labels = Array.isArray(signal.payload.labelIds)
        ? signal.payload.labelIds.map((item) => String(item).toUpperCase())
        : [];
      if (!labels.includes(label)) return false;
    }

    const hoursSinceReceived = asNumber(config.hoursSinceReceived);
    if (hoursSinceReceived != null) {
      const occurredAt = asString(signal.payload.receivedAt) ?? signal.occurredAt;
      if (occurredAt != null) {
        const ageHours = (Date.now() - new Date(occurredAt).getTime()) / (1000 * 60 * 60);
        if (ageHours > hoursSinceReceived) return false;
      }
    }

    return true;
  }

  private evaluateConditions(
    conditions: Condition[] | null | undefined,
    signal: AutomationSignal,
  ): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every((condition) => this.evaluateSingleCondition(signal.payload, condition));
  }

  private evaluateSingleCondition(
    payload: Record<string, unknown>,
    condition: Condition,
  ): boolean {
    const actual = payload[condition.field];
    const actualStr = typeof actual === 'string' ? actual.toLowerCase() : String(actual ?? '').toLowerCase();
    const expected = condition.value.toLowerCase();

    switch (condition.operator) {
      case 'equals':
        return actualStr === expected;
      case 'not_equals':
        return actualStr !== expected;
      case 'contains':
        return actualStr.includes(expected);
      case 'not_contains':
        return !actualStr.includes(expected);
      case 'greater_than': {
        const n = asNumber(actual);
        const threshold = asNumber(condition.value);
        return n != null && threshold != null && n > threshold;
      }
      case 'less_than': {
        const n = asNumber(actual);
        const threshold = asNumber(condition.value);
        return n != null && threshold != null && n < threshold;
      }
      default:
        return true;
    }
  }

  private async executeAction(
    rule: AutomationRule,
    signal: AutomationSignal,
  ): Promise<boolean> {
    switch (rule.actionType) {
      case 'create_task':
        await this.createTaskFromSignal(rule, signal, false);
        return true;
      case 'tag_task':
        await this.createTaskFromSignal(rule, signal, true);
        return true;
      case 'auto_schedule':
        await this.createTaskFromSignal(rule, signal, false, true);
        return true;
      case 'send_notification':
        return this.sendNotification(rule, signal);
      case 'create_project_from_template':
        return this.createProject(rule, signal);
      default:
        return false;
    }
  }

  private async createTaskFromSignal(
    rule: AutomationRule,
    signal: AutomationSignal,
    includeTag: boolean,
    autoSchedule = false,
  ): Promise<void> {
    const config = rule.actionConfig ?? {};
    const dueBase =
      asString(signal.payload.planDate) ??
      asString(signal.payload.startDate) ??
      asString(signal.payload.receivedAt) ??
      signal.occurredAt;
    const dueDate = computeDateOffset(dueBase, asNumber(config.dueDaysOffset) ?? 0);
    const title =
      interpolate(asString(config.titleTemplate), signal) ||
      asString(signal.payload.title) ||
      asString(signal.payload.subject) ||
      `${rule.name} follow-up`;
    let notes =
      interpolate(asString(config.notesTemplate), signal) ||
      asString(signal.payload.notes) ||
      asString(signal.payload.snippet) ||
      null;
    if (includeTag) {
      const tag = asString(config.tag);
      if (tag != null) {
        notes = notes ? `[${tag}] ${notes}` : `[${tag}]`;
      }
    }
    const scheduledDate = autoSchedule
      ? scheduleToTargetDay(dueDate, asNumber(config.targetDay) ?? 1)
      : scheduleToWeekdayInSameWeek(
          dueBase,
          asNumber(config.targetDayOfWeek) ?? -1,
        );

    await this.tasksRepo.upsertExternalTaskAsync({
      title,
      notes,
      dueDate,
      scheduledDate,
      sourceType: 'automation_rule',
      sourceId: taskSourceId(rule, signal),
      ownerId: rule.ownerId ?? null,
    });
  }

  private async sendNotification(
    rule: AutomationRule,
    signal: AutomationSignal,
  ): Promise<boolean> {
    if (rule.ownerId == null) return false;
    const bot = await this.usersRepo.findOrCreateSystemBotAsync();
    const config = rule.actionConfig ?? {};
    const message =
      interpolate(asString(config.messageTemplate), signal) ||
      `${rule.name} matched ${asString(signal.payload.title) ?? asString(signal.payload.subject) ?? signal.signalType}.`;
    await this.messagesRepo.sendDirectMessageAsync(bot.id, rule.ownerId, message);
    return true;
  }

  private async createProject(
    rule: AutomationRule,
    signal: AutomationSignal,
  ): Promise<boolean> {
    if (rule.ownerId == null) return false;
    const config = rule.actionConfig ?? {};
    const templateId = asString(config.templateId);
    const templateName = asString(config.templateName);
    const template = templateId
      ? await this.templatesRepo.findByIdAsync(
          templateId,
          rule.ownerId,
        )
      : templateName
        ? await this.templatesRepo.findByNameInsensitiveAsync(
            templateName,
            rule.ownerId,
          )
        : null;
    if (template == null) return false;

    const anchorDate =
      asString(signal.payload.planDate) ??
      asString(signal.payload.startDate) ??
      computeDateOffset(signal.occurredAt, 0);
    if (anchorDate == null) return false;

    const projectName =
      interpolate(asString(config.projectNameTemplate), signal) ||
      asString(signal.payload.title) ||
      rule.name;
    await this.projectGeneration.generateAsync(
      template.id,
      anchorDate,
      projectName,
      rule.ownerId,
    );
    return true;
  }
}
