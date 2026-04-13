import { GmailService } from "../integrations/gmail/gmail_service";
import { GoogleCalendarService } from "../integrations/google_calendar/google_calendar_service";
import { PlanningCenterService } from "../integrations/planning_center/planning_center_service";
import type {
  GoogleCalendarOption,
  GoogleCalendarPreferences,
} from "../models/google_calendar_preferences";
import type { IntegrationAccount } from "../models/integration_account";
import type { CreateAutomationSignalDto } from "../models/automation_signal";
import { AppError } from "../errors/app_error";
import { AutomationRulesRepository } from "../repositories/automation_rules_repository";
import { AutomationSignalsRepository } from "../repositories/automation_signals_repository";
import { CalendarShadowEventsRepository } from "../repositories/calendar_shadow_events_repository";
import { GmailSignalsRepository } from "../repositories/gmail_signals_repository";
import { IntegrationAccountsRepository } from "../repositories/integration_accounts_repository";
import { IntegrationPreferencesRepository } from "../repositories/integration_preferences_repository";
import { ProjectTemplatesRepository } from "../repositories/project_templates_repository";
import { AutomationEngineService } from "./automation_engine_service";
import { GoogleOAuthService } from "./google_oauth_service";
import { PlanningCenterOAuthService } from "./planning_center_oauth_service";
import { RhythmSignalGeneratorService } from "./rhythm_signal_generator_service";

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
    const account = await this.ensureFreshAccount("google_calendar", userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest("Google Calendar is not connected");
    }

    try {
      const calendarOptions =
        await this.googleCalendar.listAccessibleCalendars(account);
      const preferences =
        await this.preferencesRepo.getGoogleCalendarPreferencesAsync(userId);
      const selectedCalendarIds = this.resolveSelectedGoogleCalendarIds(
        preferences,
        calendarOptions,
      );
      const calendarNames = new Map(
        calendarOptions.map((calendar) => [calendar.id, calendar.name]),
      );
      const events = (
        await this.googleCalendar.listUpcomingEvents(
          account,
          selectedCalendarIds,
        )
      ).map((event) => ({
        ...event,
        sourceName: calendarNames.get(event.calendarId) ?? event.sourceName,
      }));
      const synced = await this.shadowEventsRepo.replaceForOwnerAsync(
        userId,
        events.map((event) => ({
          provider: "google_calendar" as const,
          ...event,
        })),
      );
      const syncedAt = new Date().toISOString();
      const automationSignals: CreateAutomationSignalDto[] = [];
      for (const event of events) {
        const startDate = event.startAt.includes("T")
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
          eventType: "default",
          sourceName: event.sourceName,
          daysUntilStart: daysUntil(`${startDate}T00:00:00Z`),
        };
        automationSignals.push({
          provider: "google_calendar",
          signalType: "calendar_event_seen",
          externalId: event.externalId,
          dedupeKey: `google_calendar:seen:${event.externalId}`,
          occurredAt: event.startAt,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel:
            account.email ?? account.displayName ?? "Google Calendar",
          payload: basePayload,
        });
        if (basePayload.daysUntilStart <= 0) {
          automationSignals.push({
            provider: "google_calendar",
            signalType: "calendar_event_today",
            externalId: event.externalId,
            dedupeKey: `google_calendar:today:${event.externalId}:${startDate}`,
            occurredAt: event.startAt,
            syncedAt,
            sourceAccountId: account.id,
            sourceLabel:
              account.email ?? account.displayName ?? "Google Calendar",
            payload: basePayload,
          });
        }
      }
      const { changedSignals } =
        await this.signalsRepo.upsertManyDetailedAsync(automationSignals);
      const evaluation = await this.automationEngine.evaluateSignals(
        "google_calendar",
        changedSignals,
      );
      await this.accountsRepo.markSyncedAsync("google_calendar", userId);
      return {
        syncedCount: synced.length,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
      };
    } catch (err) {
      await this.accountsRepo.markErrorAsync(
        "google_calendar",
        userId,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  async syncGmail(userId: number) {
    const account = await this.ensureFreshAccount("gmail", userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest("Gmail is not connected");
    }

    try {
      const signals = await this.gmail.listRecentInboxSignals(account);
      await this.gmailSignalsRepo.replaceForOwnerAsync(
        userId,
        signals.map((signal) => ({
          ownerId: userId,
          ...signal,
        })),
      );
      const syncedAt = new Date().toISOString();
      const automationSignals: CreateAutomationSignalDto[] = signals.flatMap(
        (signal) => {
          const payload = {
            fromName: signal.fromName,
            fromEmail: signal.fromEmail,
            subject: signal.subject,
            snippet: signal.snippet,
            receivedAt: signal.receivedAt,
            isUnread: signal.isUnread,
            threadId: signal.threadId,
            labelIds: signal.labelIds,
          };
          return [
            {
              provider: "gmail" as const,
              signalType: "gmail_message_seen" as const,
              externalId: signal.externalId,
              dedupeKey: `gmail:seen:${signal.externalId}`,
              occurredAt: signal.receivedAt,
              syncedAt,
              sourceAccountId: account.id,
              sourceLabel: account.email ?? account.displayName ?? "Gmail",
              payload,
            },
            ...(signal.isUnread
              ? [
                  {
                    provider: "gmail" as const,
                    signalType: "gmail_unread_message_seen" as const,
                    externalId: signal.externalId,
                    dedupeKey: `gmail:unread:${signal.externalId}`,
                    occurredAt: signal.receivedAt,
                    syncedAt,
                    sourceAccountId: account.id,
                    sourceLabel:
                      account.email ?? account.displayName ?? "Gmail",
                    payload,
                  },
                ]
              : []),
            ...(signal.fromEmail
              ? [
                  {
                    provider: "gmail" as const,
                    signalType: "gmail_message_from_sender" as const,
                    externalId: signal.externalId,
                    dedupeKey: `gmail:sender:${signal.externalId}:${signal.fromEmail.toLowerCase()}`,
                    occurredAt: signal.receivedAt,
                    syncedAt,
                    sourceAccountId: account.id,
                    sourceLabel:
                      account.email ?? account.displayName ?? "Gmail",
                    payload,
                  },
                ]
              : []),
          ];
        },
      );
      const { changedSignals } =
        await this.signalsRepo.upsertManyDetailedAsync(automationSignals);
      const evaluation = await this.automationEngine.evaluateSignals(
        "gmail",
        changedSignals,
      );
      await this.accountsRepo.markSyncedAsync("gmail", userId);
      return {
        syncedCount: signals.length,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
        signals: await this.gmailSignalsRepo.listRecentAsync(userId),
      };
    } catch (err) {
      await this.accountsRepo.markErrorAsync(
        "gmail",
        userId,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  listRecentGmailSignals(userId: number) {
    return this.gmailSignalsRepo.listRecentAsync(userId);
  }

  async listGmailLabels(userId: number): Promise<string[]> {
    const account = await this.ensureFreshAccount('gmail', userId);
    if (!account || !account.accessToken) {
      return [];
    }
    return this.gmail.listLabels(account);
  }

  async syncPlanningCenter(userId: number) {
    const account = await this.ensureFreshAccount("planning_center", userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest("Planning Center is not connected");
    }

    try {
      await this.removeLegacyPlanningCenterDefaultRules();
      const preferences =
        await this.preferencesRepo.getPlanningCenterTaskPreferencesAsync(userId);
      const [collected, serviceTypeItems] = await Promise.all([
        this.planningCenter.collectAutomationSignals(account, preferences),
        this.planningCenter.collectServiceItemSignals(account),
      ]);
      const syncedAt = new Date().toISOString();
      const automationSignals: CreateAutomationSignalDto[] = [
        ...collected.upcomingPlans.map((plan) => ({
          provider: "planning_center" as const,
          signalType: "plan_upcoming" as const,
          externalId: plan.planId,
          dedupeKey: `planning_center:plan:${plan.planId}`,
          occurredAt: `${plan.planDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel:
            account.email ?? account.displayName ?? "Planning Center",
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
            provider: "planning_center" as const,
            signalType: "plan_published" as const,
            externalId: plan.planId,
            dedupeKey: `planning_center:published:${plan.planId}`,
            occurredAt: plan.publishedAt!,
            syncedAt,
            sourceAccountId: account.id,
            sourceLabel:
              account.email ?? account.displayName ?? "Planning Center",
            payload: {
              title: plan.title,
              serviceTypeName: plan.serviceTypeName,
              planDate: plan.planDate,
              daysUntil: plan.daysUntil,
              publishedAt: plan.publishedAt,
            },
          })),
        ...collected.tasks.map((task) => ({
          provider: "planning_center" as const,
          signalType: task.signalType,
          externalId: task.sourceId,
          dedupeKey: task.dedupeKey,
          occurredAt: `${task.planDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel:
            account.email ?? account.displayName ?? "Planning Center",
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
          provider: "planning_center" as const,
          signalType: "service_item_updated" as const,
          externalId: item.itemId,
          dedupeKey: `planning_center:service_item:${item.itemId}`,
          occurredAt: `${item.planDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel:
            account.email ?? account.displayName ?? "Planning Center",
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
          provider: "planning_center" as const,
          signalType: "special_service_candidate" as const,
          externalId: project.planId,
          dedupeKey: `planning_center:special:${project.planId}`,
          occurredAt: `${project.anchorDate}T00:00:00Z`,
          syncedAt,
          sourceAccountId: account.id,
          sourceLabel:
            account.email ?? account.displayName ?? "Planning Center",
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
      const { changedSignals } =
        await this.signalsRepo.upsertManyDetailedAsync(automationSignals);
      const evaluation = await this.automationEngine.evaluateSignals(
        "planning_center",
        changedSignals,
      );

      await this.accountsRepo.markSyncedAsync("planning_center", userId);
      return {
        planCount: collected.planCount,
        taskSignalCount: collected.tasks.length,
        specialServiceEligibleCount: collected.specialProjects.length,
        specialServiceProjectTemplateFound:
          (await this.templateRepo.findByNameInsensitiveAsync(
            this.planningCenter.specialServiceTemplateName(),
            userId,
          )) != null,
        generatedSignalCount: automationSignals.length,
        matchedRuleCount: evaluation.matchedRules,
        executedActionCount: evaluation.executedActions,
      };
    } catch (err) {
      await this.accountsRepo.markErrorAsync(
        "planning_center",
        userId,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  async syncAll(userId: number) {
    const results: Record<string, unknown> = {};
    const errors: Array<{ provider: string; message: string }> = [];
    const calendarAccount = await this.accountsRepo.findByProviderAsync(
      "google_calendar",
      userId,
    );
    const gmailAccount = await this.accountsRepo.findByProviderAsync("gmail", userId);
    const planningCenterAccount = await this.accountsRepo.findByProviderAsync(
      "planning_center",
      userId,
    );

    if (calendarAccount?.accessToken) {
      try {
        results.googleCalendar = await this.syncGoogleCalendar(userId);
      } catch (err) {
        errors.push({
          provider: "google_calendar",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (gmailAccount?.accessToken) {
      try {
        results.gmail = await this.syncGmail(userId);
      } catch (err) {
        errors.push({
          provider: "gmail",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (planningCenterAccount?.accessToken) {
      try {
        results.planningCenter = await this.syncPlanningCenter(userId);
      } catch (err) {
        errors.push({
          provider: "planning_center",
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
    const rule = await this.rulesRepo.findByIdAsync(ruleId, userId);
    switch (rule.source) {
      case "google_calendar":
        return {
          source: rule.source,
          result: await this.syncGoogleCalendar(userId),
        };
      case "gmail":
        return {
          source: rule.source,
          result: await this.syncGmail(userId),
        };
      case "planning_center":
        return {
          source: rule.source,
          result: await this.syncPlanningCenter(userId),
        };
      case "rhythm": {
        const rhythmSignals = [
          ...(await this.rhythmGenerator.generateTaskDueSignalsAsync()),
          ...(await this.rhythmGenerator.generateProjectStepDueSignalsAsync()),
        ];
        const { changedSignals } =
          await this.signalsRepo.upsertManyDetailedAsync(rhythmSignals);
        const evaluation = await this.automationEngine.evaluateSignals(
          "rhythm",
          changedSignals,
        );
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
    provider: "google_calendar" | "gmail" | "planning_center",
    userId: number,
  ): Promise<IntegrationAccount | null> {
    const account = await this.accountsRepo.findByProviderAsync(provider, userId);
    if (!account) return null;
    if (!this.shouldRefresh(account)) return account;

    if (provider === "planning_center") {
      return this.planningCenterOAuth.refreshAccessToken(account);
    }

    const refreshed = await this.googleOAuth.refreshAccessToken(account);
    if (provider === "google_calendar") return refreshed;
    return (await this.accountsRepo.findByProviderAsync(provider, userId)) ?? refreshed;
  }

  private shouldRefresh(account: IntegrationAccount): boolean {
    if (!account.refreshToken) return false;
    if (!account.expiresAt) return true;
    const expiresAtMs = Date.parse(account.expiresAt);
    if (Number.isNaN(expiresAtMs)) return true;
    return expiresAtMs <= Date.now() + 5 * 60 * 1000;
  }

  getPlanningCenterTaskPreferences(userId: number) {
    return this.preferencesRepo.getPlanningCenterTaskPreferencesAsync(userId);
  }

  savePlanningCenterTaskPreferences(
    userId: number,
    preferences: {
      teamIds: string[];
      positionNames: string[];
    },
  ) {
    return this.preferencesRepo.savePlanningCenterTaskPreferencesAsync(
      userId,
      preferences,
    );
  }

  async getPlanningCenterTaskOptions(userId: number) {
    const account = await this.accountsRepo.findByProviderAsync(
      "planning_center",
      userId,
    );
    if (!account || !account.accessToken) {
      throw AppError.badRequest("Planning Center is not connected");
    }
    return this.planningCenter.collectTaskOptions(account);
  }

  async getGoogleCalendarSettings(userId: number): Promise<{
    calendars: GoogleCalendarOption[];
    selectedCalendarIds: string[];
  }> {
    const account = await this.ensureFreshAccount("google_calendar", userId);
    if (!account || !account.accessToken) {
      throw AppError.badRequest("Google Calendar is not connected");
    }

    const calendars =
      await this.googleCalendar.listAccessibleCalendars(account);
    const preferences =
      await this.preferencesRepo.getGoogleCalendarPreferencesAsync(userId);
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
    return this.preferencesRepo.saveGoogleCalendarPreferencesAsync(
      userId,
      preferences,
    );
  }

  private resolveSelectedGoogleCalendarIds(
    preferences: GoogleCalendarPreferences | null,
    calendars: Array<Omit<GoogleCalendarOption, "isSelected">>,
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

  private async removeLegacyPlanningCenterDefaultRules(): Promise<void> {
    const legacyRules = (await this.rulesRepo.findAllAsync()).filter(
      (rule) =>
        rule.ownerId == null &&
        (
          (
            rule.name === "PCO declined volunteer" &&
            rule.source === "planning_center" &&
            rule.triggerKey === "planning_center.plan_person_declined" &&
            rule.actionType === "create_task"
          ) ||
          (
            rule.name === "PCO open needed position" &&
            rule.source === "planning_center" &&
            rule.triggerKey === "planning_center.needed_position_open" &&
            rule.actionType === "create_task"
          ) ||
          (
            rule.name === "PCO unconfirmed volunteer" &&
            rule.source === "planning_center" &&
            rule.triggerKey === "planning_center.plan_person_unconfirmed" &&
            rule.actionType === "create_task"
          ) ||
          (
            rule.name === "PCO special service project" &&
            rule.source === "planning_center" &&
            rule.triggerKey === "planning_center.special_service_candidate" &&
            rule.actionType === "create_project_from_template"
          )
        ),
    );

    for (const rule of legacyRules) {
      await this.rulesRepo.deleteAsync(rule.id);
    }
  }
}
