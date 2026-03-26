import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../models/gmail_signal.dart';
import '../models/integration_account.dart';
import '../models/planning_center_task_options.dart';
import '../models/planning_center_task_preferences.dart';

class IntegrationsDataSource {
  final _accountsBase =
      Uri.parse('${AppConstants.apiBaseUrl}/integrations/accounts');

  Future<List<IntegrationAccount>> fetchAccounts() async {
    final response = await http.get(_accountsBase);
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map(
            (item) => IntegrationAccount.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Uri googleBeginUri() =>
      Uri.parse('${AppConstants.apiBaseUrl}/auth/google/begin');

  Uri planningCenterBeginUri() =>
      Uri.parse('${AppConstants.apiBaseUrl}/auth/planning-center/begin');

  Future<void> syncGoogleCalendar() async {
    final response = await http.post(
      Uri.parse('${AppConstants.apiBaseUrl}/integrations/google-calendar/sync'),
    );
    _assertOk(response);
  }

  Future<List<GmailSignal>> fetchGmailSignals() async {
    final response = await http.get(
      Uri.parse('${AppConstants.apiBaseUrl}/integrations/gmail/signals'),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => GmailSignal.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> syncGmail() async {
    final response = await http.post(
      Uri.parse('${AppConstants.apiBaseUrl}/integrations/gmail/sync'),
    );
    _assertOk(response);
  }

  Future<void> syncPlanningCenter() async {
    final response = await http.post(
      Uri.parse('${AppConstants.apiBaseUrl}/integrations/planning-center/sync'),
    );
    _assertOk(response);
  }

  Future<PlanningCenterTaskPreferences>
      fetchPlanningCenterTaskPreferences() async {
    final response = await http.get(
      Uri.parse(
        '${AppConstants.apiBaseUrl}/integrations/planning-center/task-preferences',
      ),
    );
    _assertOk(response);
    return PlanningCenterTaskPreferences.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<PlanningCenterTaskOptions> fetchPlanningCenterTaskOptions() async {
    final response = await http.get(
      Uri.parse(
        '${AppConstants.apiBaseUrl}/integrations/planning-center/task-options',
      ),
    );
    _assertOk(response);
    return PlanningCenterTaskOptions.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<PlanningCenterTaskPreferences> savePlanningCenterTaskPreferences(
    PlanningCenterTaskPreferences preferences,
  ) async {
    final response = await http.put(
      Uri.parse(
        '${AppConstants.apiBaseUrl}/integrations/planning-center/task-preferences',
      ),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode(preferences.toJson()),
    );
    _assertOk(response);
    return PlanningCenterTaskPreferences.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  void _assertOk(http.Response response) {
    if (response.statusCode >= 400) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      final message =
          (body?['error'] as Map<String, dynamic>?)?['message'] as String? ??
              'Request failed';
      throw AppError(message);
    }
  }
}
