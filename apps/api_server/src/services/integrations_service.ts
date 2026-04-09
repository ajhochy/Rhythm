import { GmailService } from '../integrations/gmail/gmail_service';
import { GoogleCalendarService } from '../integrations/google_calendar/google_calendar_service';
import { PlanningCenterService } from '../integrations/planning_center/planning_center_service';
import type {
  GoogleCalendarOption,
  GoogleCalendarPreferences,
} from '../models/google_calendar_preferences';
import type { IntegrationAccount } from '../models/integration_account';
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
import { GoogleOAuthService } from './google_oauth_service';
import { PlanningCenterOAuthService } from './planning_center_oauth_service';
import { RhythmSignalGeneratorService } from './rhythm_signal_generator_service';

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
  private readonly googleOAuth = new GoogleOAuthService();
  private readonly planningCenterOAuth = new PlanningCenterOAuthService();
  private readonly rhythmGenerator = new RhythmSignalGeneratorService();

  async syncGoogleCalendar(userId: number) {
    const account = await this.ensureFreshAccount('google_calendar', userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Google Calendar is not connected');
    }

    try {
      const calendarOptions =
        await this.googleCalendar.listAccessibleCalendars(account);
      const preferences =
        this.preferencesRepo.getGoogleCalendarPreferences(userId);
      const selectedCalendarIds =
        this.resolveSelectedGoogleCalendarIds(preferences, calendarOptions);
      const calendarNames = new Map(
        calendarOptions.map((calendar) => [calendar.id, calendar.name]),
      );
      const events = (await this.googleCalendar.listUpcomingEvents(
        account,
        selectedCalendarIds,
      )).map((event) => ({
        ...event,
        sourceName: calendarNames.get(event.calendarId) ?? event.sourceName,
      }));
      const synced = this.shadowEventsRepo.replaceForOwner(
        userId,
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
      this.accountsRepo.markSynced('google_calendar', userId);
      return {
        syncedCount: synced.length,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
      };
    } catch (err) {
      this.accountsRepo.markError(
        'google_calendar',
        userId,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  async syncGmail(userId: number) {
    const account = await this.ensureFreshAccount('gmail', userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Gmail is not connected');
    }

    try {
      const signals = await this.gmail.listRecentInboxSignals(account);
      this.gmailSignalsRepo.replaceForOwner(
        userId,
        signals.map((signal) => ({
          ownerId: userId,
          ...signal,
        })),
      );
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
      this.accountsRepo.markSynced('gmail', userId);
      return {
        syncedCount: signals.length,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
        signals: this.gmailSignalsRepo.listRecent(userId),
      };
    } catch (err) {
      this.accountsRepo.markError(
        'gmail',
        userId,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  listRecentGmailSignals(userId: number) {
    return this.gmailSignalsRepo.listRecent(userId);
  }

  async syncPlanningCenter(userId: number) {
    const account = await this.ensureFreshAccount('planning_center', userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Planning Center is not connected');
    }

    try {
      this.ensureDefaultRules();
      const preferences =
        this.preferencesRepo.getPlanningCenterTaskPreferences(userId);
      const [collected, serviceTypeItems] = await Promise.all([
        this.planningCenter.collectAutomationSignals(account, preferences),
        this.planningCenter.collectServiceItemSignals(account),
      ]);
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
            publishedAt: plan.publishedAt,
          },
        })),
        ...collected.upcomingPlans
          .filter((plan) => plan.publishedAt != null)
          .map((plan) => ({
            provider: 'planning_center' as const,
            signalType: 'plan_published' as const,
            externalId: plan.planId,
            dedupeKey: `planning_center:published:${plan.planId}`,
            occurredAt: plan.publishedAt!,
            syncedAt,
            sourceAccountId: account.id,
            sourceLabel: account.email ?? account.displayName ?? 'Planning Center',
            payload: {
              title: plan.title,
              serviceTypeName: plan.serviceTypeName,
              planDate: plan.planDate,
              daysUntil: plan.daysUntil,
              publishedAt: plan.publishedAt,
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
        ...serviceTypeItems.map((item) => ({
          provider: 'planning_center' as const,
          signalType: 'service_item_updated' as const,
          externalId: item.itemId,
          dedupeKey: `planning_center:service_item:${item.itemId}`,
          occurredAt: `${item.planDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel: account.email ?? account.displayName ?? 'Planning Center',
          payload: {
            title: item.title,
            itemType: item.itemType,
            sequence: item.sequence,
            serviceTypeName: item.serviceTypeName,
            planId: item.planId,
            planDate: item.planDate,
            daysUntil: item.daysUntil,
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

      this.accountsRepo.markSynced('planning_center', userId);
      return {
        planCount: collected.planCount,
        taskSignalCount: collected.tasks.length,
        specialServiceEligibleCount: collected.specialProjects.length,
        specialServiceProjectTemplateFound:
          this.templateRepo.findByNameInsensitive(
            this.planningCenter.specialServiceTemplateName(),
            userId,
          ) != null,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
      };
    } catch (err) {
      this.accountsRepo.markError(
        'planning_center',
        userId,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  async syncAll(userId: number) {
    const results: Record<string, unknown> = {};
    const errors: Array<{ provider: string; message: string }> = [];
    const calendarAccount = this.accountsRepo.findByProvider('google_calendar', userId);
    const gmailAccount = this.accountsRepo.findByProvider('gmail', userId);
    const planningCenterAccount = this.accountsRepo.findByProvider('planning_center', userId);

    if (calendarAccount?.accessToken) {
      try {
        results.googleCalendar = await this.syncGoogleCalendar(userId);
      } catch (err) {
        errors.push({
          provider: 'google_calendar',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (gmailAccount?.accessToken) {
      try {
        results.gmail = await this.syncGmail(userId);
      } catch (err) {
        errors.push({
          provider: 'gmail',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (planningCenterAccount?.accessToken) {
      try {
        results.planningCenter = await this.syncPlanningCenter(userId);
      } catch (err) {
        errors.push({
          provider: 'planning_center',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ...results,
      errors,
    };
  }

  async resyncAutomationRule(ruleId: string, userId: number) {
    const rule = this.rulesRepo.findById(ruleId, userId);
    switch (rule.source) {
      case 'google_calendar':
        return {
          source: rule.source,
          result: await this.syncGoogleCalendar(userId),
        };
      case 'gmail':
        return {
          source: rule.source,
          result: await this.syncGmail(userId),
        };
      case 'planning_center':
        return {
          source: rule.source,
          result: await this.syncPlanningCenter(userId),
        };
      case 'rhythm': {
        const rhythmSignals = [
          ...this.rhythmGenerator.generateTaskDueSignals(),
          ...this.rhythmGenerator.generateProjectStepDueSignals(),
        ];
        const evaluation = this.automationEngine.evaluateSignals('rhythm', rhythmSignals);
        return {
          source: rule.source,
          generatedSignalCount: rhythmSignals.length,
          matchedRuleCount: evaluation.matchedRules,
          executedActionCount: evaluation.executedActions,
        };
      }
      default:
        return {
          source: rule.source,
          result: null,
        };
    }
  }

  private async ensureFreshAccount(
    provider: 'google_calendar' | 'gmail' | 'planning_center',
    userId: number,
  ): Promise<IntegrationAccount | null> {
    const account = this.accountsRepo.findByProvider(provider, userId);
    if (!account) return null;
    if (!this.shouldRefresh(account)) return account;

    if (provider === 'planning_center') {
      return this.planningCenterOAuth.refreshAccessToken(account);
    }

    const refreshed = await this.googleOAuth.refreshAccessToken(account);
    if (provider === 'google_calendar') return refreshed;
    return this.accountsRepo.findByProvider(provider, userId) ?? refreshed;
  }

  private shouldRefresh(account: IntegrationAccount): boolean {
    if (!account.refreshToken) return false;
    if (!account.expiresAt) return true;
    const expiresAtMs = Date.parse(account.expiresAt);
    if (Number.isNaN(expiresAtMs)) return true;
    return expiresAtMs <= Date.now() + 5 * 60 * 1000;
  }

  getPlanningCenterTaskPreferences(userId: number) {
    return this.preferencesRepo.getPlanningCenterTaskPreferences(userId);
  }

  savePlanningCenterTaskPreferences(userId: number, preferences: {
    teamIds: string[];
    positionNames: string[];
  }) {
    return this.preferencesRepo.savePlanningCenterTaskPreferences(
      userId,
      preferences,
    );
  }

  async getPlanningCenterTaskOptions(userId: number) {
    const account = this.accountsRepo.findByProvider('planning_center', userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Planning Center is not connected');
    }
    return this.planningCenter.collectTaskOptions(account);
  }

  async getGoogleCalendarSettings(userId: number): Promise<{
    calendars: GoogleCalendarOption[];
    selectedCalendarIds: string[];
  }> {
    const account = await this.ensureFreshAccount('google_calendar', userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest('Google Calendar is not connected');
    }

    const calendars = await this.googleCalendar.listAccessibleCalendars(account);
    const preferences = this.preferencesRepo.getGoogleCalendarPreferences(userId);
    const selectedCalendarIds = this.resolveSelectedGoogleCalendarIds(
      preferences,
      calendars,
    );

    return {
      calendars: calendars.map((calendar) => ({
        ...calendar,
        isSelected: selectedCalendarIds.includes(calendar.id),
      })),
      selectedCalendarIds,
    };
  }

  saveGoogleCalendarPreferences(
    userId: number,
    preferences: GoogleCalendarPreferences,
  ) {
    return this.preferencesRepo.saveGoogleCalendarPreferences(userId, preferences);
  }

  private resolveSelectedGoogleCalendarIds(
    preferences: GoogleCalendarPreferences | null,
    calendars: Array<Omit<GoogleCalendarOption, 'isSelected'>>,
  ): string[] {
    if (preferences == null) {
      return calendars.map((calendar) => calendar.id);
    }
    const availableIds = new Set(calendars.map((calendar) => calendar.id));
    const selected = preferences.selectedCalendarIds.filter((id) =>
      availableIds.has(id),
    );
    if (preferences.selectedCalendarIds.length == 0) {
      return [];
    }
    return selected;
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
