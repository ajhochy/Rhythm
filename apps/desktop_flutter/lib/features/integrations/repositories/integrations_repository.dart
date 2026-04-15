import '../data/integrations_data_source.dart';
import '../models/gmail_signal.dart';
import '../models/google_calendar_settings.dart';
import '../models/integration_account.dart';
import '../models/planning_center_task_options.dart';
import '../models/planning_center_task_preferences.dart';

class IntegrationsRepository {
  IntegrationsRepository(this._dataSource);

  final IntegrationsDataSource _dataSource;

  Future<List<IntegrationAccount>> getAccounts() => _dataSource.fetchAccounts();
  Future<GoogleCalendarSettings> getGoogleCalendarSettings() =>
      _dataSource.fetchGoogleCalendarSettings();
  Future<List<GmailSignal>> getGmailSignals() =>
      _dataSource.fetchGmailSignals();
  Future<PlanningCenterTaskPreferences> getPlanningCenterTaskPreferences() =>
      _dataSource.fetchPlanningCenterTaskPreferences();
  Future<PlanningCenterTaskOptions> getPlanningCenterTaskOptions() =>
      _dataSource.fetchPlanningCenterTaskOptions();

  Uri googleBeginUri() => _dataSource.googleBeginUri();
  Uri planningCenterBeginUri() => _dataSource.planningCenterBeginUri();

  Future<void> syncGoogleCalendar() => _dataSource.syncGoogleCalendar();
  Future<void> syncAll() => _dataSource.syncAll();
  Future<GoogleCalendarSettings> saveGoogleCalendarPreferences(
    List<String> selectedCalendarIds,
  ) => _dataSource.saveGoogleCalendarPreferences(selectedCalendarIds);
  Future<void> syncGmail() => _dataSource.syncGmail();
  Future<void> syncPlanningCenter() => _dataSource.syncPlanningCenter();
  Future<PlanningCenterTaskPreferences> savePlanningCenterTaskPreferences(
    PlanningCenterTaskPreferences preferences,
  ) => _dataSource.savePlanningCenterTaskPreferences(preferences);
}
