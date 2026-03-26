import 'package:flutter/foundation.dart';
import '../models/gmail_signal.dart';
import '../models/integration_account.dart';
import '../models/planning_center_task_options.dart';
import '../models/planning_center_task_preferences.dart';
import '../repositories/integrations_repository.dart';

enum IntegrationsStatus { idle, loading, error }

class IntegrationsController extends ChangeNotifier {
  IntegrationsController(this._repository);

  final IntegrationsRepository _repository;

  List<IntegrationAccount> _accounts = [];
  List<GmailSignal> _gmailSignals = [];
  PlanningCenterTaskPreferences _planningCenterTaskPreferences =
      PlanningCenterTaskPreferences(teamIds: [], positionNames: []);
  PlanningCenterTaskOptions _planningCenterTaskOptions =
      PlanningCenterTaskOptions(teams: [], positionsByTeamId: {});
  IntegrationsStatus _status = IntegrationsStatus.idle;
  String? _errorMessage;
  bool _syncingGoogleCalendar = false;
  bool _syncingGmail = false;
  bool _syncingPlanningCenter = false;
  bool _savingPlanningCenterTaskFilters = false;

  List<IntegrationAccount> get accounts => _accounts;
  List<GmailSignal> get gmailSignals => _gmailSignals;
  PlanningCenterTaskPreferences get planningCenterTaskPreferences =>
      _planningCenterTaskPreferences;
  PlanningCenterTaskOptions get planningCenterTaskOptions =>
      _planningCenterTaskOptions;
  IntegrationsStatus get status => _status;
  String? get errorMessage => _errorMessage;
  bool get syncingGoogleCalendar => _syncingGoogleCalendar;
  bool get syncingGmail => _syncingGmail;
  bool get syncingPlanningCenter => _syncingPlanningCenter;
  bool get savingPlanningCenterTaskFilters => _savingPlanningCenterTaskFilters;

  Future<void> load() async {
    _status = IntegrationsStatus.loading;
    _errorMessage = null;
    notifyListeners();

    try {
      _accounts = await _repository.getAccounts();
      _gmailSignals = await _repository.getGmailSignals();
      final pcoConnected = _accounts.any(
        (account) =>
            account.provider == 'planning_center' && account.connected,
      );
      if (pcoConnected) {
        _planningCenterTaskPreferences =
            await _repository.getPlanningCenterTaskPreferences();
        _planningCenterTaskOptions =
            await _repository.getPlanningCenterTaskOptions();
      } else {
        _planningCenterTaskPreferences =
            PlanningCenterTaskPreferences(teamIds: [], positionNames: []);
        _planningCenterTaskOptions =
            PlanningCenterTaskOptions(teams: [], positionsByTeamId: {});
      }
      _status = IntegrationsStatus.idle;
    } catch (e) {
      _status = IntegrationsStatus.error;
      _errorMessage = e.toString();
    }
    notifyListeners();
  }

  Uri googleBeginUri() => _repository.googleBeginUri();
  Uri planningCenterBeginUri() => _repository.planningCenterBeginUri();

  Future<void> syncGoogleCalendar() async {
    _syncingGoogleCalendar = true;
    _errorMessage = null;
    notifyListeners();
    try {
      await _repository.syncGoogleCalendar();
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = IntegrationsStatus.error;
      notifyListeners();
    } finally {
      _syncingGoogleCalendar = false;
      notifyListeners();
    }
  }

  Future<void> syncGmail() async {
    _syncingGmail = true;
    _errorMessage = null;
    notifyListeners();
    try {
      await _repository.syncGmail();
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = IntegrationsStatus.error;
      notifyListeners();
    } finally {
      _syncingGmail = false;
      notifyListeners();
    }
  }

  Future<void> syncPlanningCenter() async {
    _syncingPlanningCenter = true;
    _errorMessage = null;
    notifyListeners();
    try {
      await _repository.syncPlanningCenter();
      await load();
    } catch (e) {
      _errorMessage = e.toString();
      _status = IntegrationsStatus.error;
      notifyListeners();
    } finally {
      _syncingPlanningCenter = false;
      notifyListeners();
    }
  }

  Future<void> savePlanningCenterTaskPreferences(
    PlanningCenterTaskPreferences preferences,
  ) async {
    _savingPlanningCenterTaskFilters = true;
    _errorMessage = null;
    notifyListeners();
    try {
      _planningCenterTaskPreferences =
          await _repository.savePlanningCenterTaskPreferences(preferences);
      _status = IntegrationsStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = IntegrationsStatus.error;
    } finally {
      _savingPlanningCenterTaskFilters = false;
      notifyListeners();
    }
  }
}
