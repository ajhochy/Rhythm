import { GmailService } from '../integrations/gmail/gmail_service';
import { GoogleCalendarService } from '../integrations/google_calendar/google_calendar_service';
import { PlanningCenterService } from '../integrations/planning_center/planning_center_service';
import { AppError } from '../errors/app_error';
import { CalendarShadowEventsRepository } from '../repositories/calendar_shadow_events_repository';
import { GmailSignalsRepository } from '../repositories/gmail_signals_repository';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { IntegrationPreferencesRepository } from '../repositories/integration_preferences_repository';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { ProjectGenerationService } from './project_generation_service';

export class IntegrationsService {
  private readonly accountsRepo = new IntegrationAccountsRepository();
  private readonly shadowEventsRepo = new CalendarShadowEventsRepository();
  private readonly gmailSignalsRepo = new GmailSignalsRepository();
  private readonly tasksRepo = new TasksRepository();
  private readonly preferencesRepo = new IntegrationPreferencesRepository();
  private readonly templateRepo = new ProjectTemplatesRepository();
  private readonly instanceRepo = new ProjectInstancesRepository();
  private readonly googleCalendar = new GoogleCalendarService();
  private readonly gmail = new GmailService();
  private readonly planningCenter = new PlanningCenterService();
  private readonly projectGeneration = new ProjectGenerationService();

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
      this.accountsRepo.markSynced('google_calendar');
      return { syncedCount: synced.length };
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
      this.accountsRepo.markSynced('gmail');
      return {
        syncedCount: signals.length,
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
      const preferences =
        this.preferencesRepo.getPlanningCenterTaskPreferences();
      const signals = await this.planningCenter.collectAutomationSignals(
        account,
        preferences,
      );
      const removedTaskCount =
        this.tasksRepo.deleteAllBySourceType('planning_center_signal');

      for (const task of signals.tasks) {
        this.tasksRepo.upsertExternalTask({
          title: task.title,
          notes: task.notes,
          dueDate: task.dueDate,
          scheduledDate: task.scheduledDate,
          sourceType: 'planning_center_signal',
          sourceId: task.sourceId,
        });
      }

      const template = this.templateRepo.findByNameInsensitive(
        this.planningCenter.specialServiceTemplateName(),
      );
      let startedProjectCount = 0;
      let eligibleSpecialServiceCount = signals.specialProjects.length;

      if (template) {
        for (const project of signals.specialProjects) {
          const existing = this.instanceRepo.findByTemplateAndAnchor(
            template.id,
            project.anchorDate,
            project.name,
          );
          if (existing) continue;
          this.projectGeneration.generate(
            template.id,
            project.anchorDate,
            project.name,
          );
          startedProjectCount += 1;
        }
      }

      this.accountsRepo.markSynced('planning_center');
      return {
        planCount: signals.planCount,
        taskSignalCount: signals.tasks.length,
        removedTaskCount,
        specialServiceEligibleCount: eligibleSpecialServiceCount,
        specialServiceProjectTemplateFound: template != null,
        startedProjectCount,
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
}
