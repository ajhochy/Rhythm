import { GmailService } from '../integrations/gmail/gmail_service';
import { GoogleCalendarService } from '../integrations/google_calendar/google_calendar_service';
import { PlanningCenterService } from '../integrations/planning_center/planning_center_service';
import type { CreateAutomationSignalDto } from '../models/automation_signal';
import { AppError } from '../errors/app_error';
import { AutomationRulesRepository } from '../repositories/automation_rules_repository';
import { AutomationSignalsRepository } from '../repositories/automation_signals_repository';
import { CalendarShadowEventsRepository } from '../repositories/calendar_shadow_events_repository';
import { GmailSignalsRepository } from '../repositories/gmail_signals_repository';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { IntegrationPreferencesRepository } from '../repositories/integration_preferences_repository';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';
import { AutomationEngineService } from './automation_engine_service';

function daysUntil(dateString: string): number {
  const start = new Date();
  const startOfTodayUtc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  const target = new Date(dateString).getTime();
  return Math.floor((target - startOfTodayUtc) / (1000 * 60 * 60 * 24));
}

export class IntegrationsService {
  private readonly accountsRepo = new IntegrationAccountsRepository();
  private readonly rulesRepo = new AutomationRulesRepository();
  private readonly signalsRepo = new AutomationSignalsRepository();
  private readonly shadowEventsRepo = new CalendarShadowEventsRepository();
  private readonly gmailSignalsRepo = new GmailSignalsRepository();
  private readonly preferencesRepo = new IntegrationPreferencesRepository();
  private readonly templateRepo = new ProjectTemplatesRepository();
  private readonly googleCalendar = new GoogleCalendarService();
  private readonly gmail = new GmailService();
  private readonly planningCenter = new PlanningCenterService();
  private readonly automationEngine = new AutomationEngineService();

  async syncGoogleCalendar() {
    const account = this.accountsRepo.findByProvider('google_calendar');
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Google Calendar is not connected');
    }

    try {
      const events = await this.googleCalendar.listUpcomingEvents(account);
      const synced = this.shadowEventsRepo.upsertMany(
        events.map((event) => ({
          provider: 'google_calendar' as const,
          ...event,
        })),
      );
      const syncedAt = new Date().toISOString();
      const automationSignals: CreateAutomationSignalDto[] = [];
      for (const event of events) {
        const startDate = event.startAt.includes('T')
          ? event.startAt.slice(0, 10)
          : event.startAt;
        const basePayload = {
          title: event.title,
          description: event.description,
          location: event.location,
          startDate,
          startAt: event.startAt,
          endAt: event.endAt,
          isAllDay: event.isAllDay,
          eventType: 'default',
          sourceName: event.sourceName,
          daysUntilStart: daysUntil(`${startDate}T00:00:00Z`),
        };
        automationSignals.push({
          provider: 'google_calendar',
          signalType: 'calendar_event_seen',
          externalId: event.externalId,
          dedupeKey: `google_calendar:seen:${event.externalId}`,
          occurredAt: event.startAt,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel: account.email ?? account.displayName ?? 'Google Calendar',
          payload: basePayload,
        });
        if (basePayload.daysUntilStart <= 0) {
          automationSignals.push({
            provider: 'google_calendar',
            signalType: 'calendar_event_today',
            externalId: event.externalId,
            dedupeKey: `google_calendar:today:${event.externalId}:${startDate}`,
            occurredAt: event.startAt,
            syncedAt,
            sourceAccountId: account.id,
            sourceLabel: account.email ?? account.displayName ?? 'Google Calendar',
            payload: basePayload,
          });
        }
      }
      this.signalsRepo.upsertMany(automationSignals);
      const evaluation = this.automationEngine.evaluateSignals(
        'google_calendar',
        this.signalsRepo.listRecent(automationSignals.length + 10).filter(
          (item) => item.provider === 'google_calendar' && item.syncedAt === syncedAt,
        ),
      );
      this.accountsRepo.markSynced('google_calendar');
      return {
        syncedCount: synced.length,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
      };
    } catch (err) {
      this.accountsRepo.markError(
        'google_calendar',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  async syncGmail() {
    const account = this.accountsRepo.findByProvider('gmail');
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Gmail is not connected');
    }

    try {
      const signals = await this.gmail.listRecentInboxSignals(account);
      this.gmailSignalsRepo.upsertMany(signals);
      const syncedAt = new Date().toISOString();
      const automationSignals: CreateAutomationSignalDto[] = signals.flatMap((signal) => {
        const payload = {
          fromName: signal.fromName,
          fromEmail: signal.fromEmail,
          subject: signal.subject,
          snippet: signal.snippet,
          receivedAt: signal.receivedAt,
          isUnread: signal.isUnread,
          threadId: signal.threadId,
          labelIds: signal.isUnread ? ['INBOX', 'UNREAD'] : ['INBOX'],
        };
        return [
          {
            provider: 'gmail' as const,
            signalType: 'gmail_message_seen' as const,
            externalId: signal.externalId,
            dedupeKey: `gmail:seen:${signal.externalId}`,
            occurredAt: signal.receivedAt,
            syncedAt,
            sourceAccountId: account.id,
            sourceLabel: account.email ?? account.displayName ?? 'Gmail',
            payload,
          },
          ...(signal.isUnread
            ? [
                {
                  provider: 'gmail' as const,
                  signalType: 'gmail_unread_message_seen' as const,
                  externalId: signal.externalId,
                  dedupeKey: `gmail:unread:${signal.externalId}`,
                  occurredAt: signal.receivedAt,
                  syncedAt,
                  sourceAccountId: account.id,
                  sourceLabel: account.email ?? account.displayName ?? 'Gmail',
                  payload,
                },
              ]
            : []),
          ...(signal.fromEmail
            ? [
                {
                  provider: 'gmail' as const,
                  signalType: 'gmail_message_from_sender' as const,
                  externalId: signal.externalId,
                  dedupeKey: `gmail:sender:${signal.externalId}:${signal.fromEmail.toLowerCase()}`,
                  occurredAt: signal.receivedAt,
                  syncedAt,
                  sourceAccountId: account.id,
                  sourceLabel: account.email ?? account.displayName ?? 'Gmail',
                  payload,
                },
              ]
            : []),
        ];
      });
      this.signalsRepo.upsertMany(automationSignals);
      const evaluation = this.automationEngine.evaluateSignals(
        'gmail',
        this.signalsRepo.listRecent(automationSignals.length + 10).filter(
          (item) => item.provider === 'gmail' && item.syncedAt === syncedAt,
        ),
      );
      this.accountsRepo.markSynced('gmail');
      return {
        syncedCount: signals.length,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
        signals: this.gmailSignalsRepo.listRecent(),
      };
    } catch (err) {
      this.accountsRepo.markError(
        'gmail',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  listRecentGmailSignals() {
    return this.gmailSignalsRepo.listRecent();
  }

  async syncPlanningCenter() {
    const account = this.accountsRepo.findByProvider('planning_center');
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Planning Center is not connected');
    }

    try {
      this.ensureDefaultRules();
      const preferences =
        this.preferencesRepo.getPlanningCenterTaskPreferences();
      const collected = await this.planningCenter.collectAutomationSignals(
        account,
        preferences,
      );
      const syncedAt = new Date().toISOString();
      const automationSignals: CreateAutomationSignalDto[] = [
        ...collected.upcomingPlans.map((plan) => ({
          provider: 'planning_center' as const,
          signalType: 'plan_upcoming' as const,
          externalId: plan.planId,
          dedupeKey: `planning_center:plan:${plan.planId}`,
          occurredAt: `${plan.planDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel: account.email ?? account.displayName ?? 'Planning Center',
          payload: {
            title: plan.title,
            serviceTypeName: plan.serviceTypeName,
            planDate: plan.planDate,
            daysUntil: plan.daysUntil,
          },
        })),
        ...collected.tasks.map((task) => ({
          provider: 'planning_center' as const,
          signalType: task.signalType,
          externalId: task.sourceId,
          dedupeKey: task.dedupeKey,
          occurredAt: `${task.planDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel: account.email ?? account.displayName ?? 'Planning Center',
          payload: {
            title: task.title,
            notes: task.notes,
            dueDate: task.dueDate,
            scheduledDate: task.scheduledDate,
            teamId: task.teamId,
            teamName: task.teamName,
            positionName: task.positionName,
            serviceTypeName: task.serviceTypeName,
            planId: task.planId,
            planTitle: task.planTitle,
            planDate: task.planDate,
            daysUntil: task.daysUntil,
          },
        })),
        ...collected.specialProjects.map((project) => ({
          provider: 'planning_center' as const,
          signalType: 'special_service_candidate' as const,
          externalId: project.planId,
          dedupeKey: `planning_center:special:${project.planId}`,
          occurredAt: `${project.anchorDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel: account.email ?? account.displayName ?? 'Planning Center',
          payload: {
            title: project.title,
            name: project.name,
            serviceTypeName: project.serviceTypeName,
            planId: project.planId,
            planDate: project.anchorDate,
            daysUntil: project.daysUntil,
          },
        })),
      ];
      this.signalsRepo.upsertMany(automationSignals);
      const evaluation = this.automationEngine.evaluateSignals(
        'planning_center',
        this.signalsRepo.listRecent(automationSignals.length + 10).filter(
          (item) =>
            item.provider === 'planning_center' && item.syncedAt === syncedAt,
        ),
      );

      this.accountsRepo.markSynced('planning_center');
      return {
        planCount: collected.planCount,
        taskSignalCount: collected.tasks.length,
        specialServiceEligibleCount: collected.specialProjects.length,
        specialServiceProjectTemplateFound:
          this.templateRepo.findByNameInsensitive(
            this.planningCenter.specialServiceTemplateName(),
          ) != null,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
      };
    } catch (err) {
      this.accountsRepo.markError(
        'planning_center',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  getPlanningCenterTaskPreferences() {
    return this.preferencesRepo.getPlanningCenterTaskPreferences();
  }

  savePlanningCenterTaskPreferences(preferences: {
    teamIds: string[];
    positionNames: string[];
  }) {
    return this.preferencesRepo.savePlanningCenterTaskPreferences(preferences);
  }

  async getPlanningCenterTaskOptions() {
    const account = this.accountsRepo.findByProvider('planning_center');
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Planning Center is not connected');
    }
    return this.planningCenter.collectTaskOptions(account);
  }

  private ensureDefaultRules(): void {
    const existing = this.rulesRepo.findAll();
    const ensure = (name: string, payload: Parameters<AutomationRulesRepository['create']>[0]) => {
      if (existing.some((rule) => rule.name === name && rule.ownerId == null)) return;
      this.rulesRepo.create(payload);
    };

    ensure('PCO declined volunteer', {
      name: 'PCO declined volunteer',
      source: 'planning_center',
      triggerKey: 'planning_center.plan_person_declined',
      actionType: 'create_task',
      triggerConfig: { leadDays: 21 },
      actionConfig: {
        titleTemplate: '{{title}}',
        notesTemplate: '{{serviceType}} {{position}} {{date}}',
      },
      ownerId: null,
    });
    ensure('PCO open needed position', {
      name: 'PCO open needed position',
      source: 'planning_center',
      triggerKey: 'planning_center.needed_position_open',
      actionType: 'create_task',
      triggerConfig: { leadDays: 21 },
      actionConfig: {
        titleTemplate: '{{title}}',
        notesTemplate: '{{serviceType}} {{position}} {{date}}',
      },
      ownerId: null,
    });
    ensure('PCO unconfirmed volunteer', {
      name: 'PCO unconfirmed volunteer',
      source: 'planning_center',
      triggerKey: 'planning_center.plan_person_unconfirmed',
      actionType: 'create_task',
      triggerConfig: { leadDays: 14 },
      actionConfig: {
        titleTemplate: '{{title}}',
        notesTemplate: '{{serviceType}} {{position}} {{date}}',
      },
      ownerId: null,
    });
    ensure('PCO special service project', {
      name: 'PCO special service project',
      source: 'planning_center',
      triggerKey: 'planning_center.special_service_candidate',
      actionType: 'create_project_from_template',
      triggerConfig: { leadDays: 30 },
      actionConfig: {
        templateName: this.planningCenter.specialServiceTemplateName(),
        projectNameTemplate: '{{title}}',
      },
      ownerId: null,
    });
  }
}
