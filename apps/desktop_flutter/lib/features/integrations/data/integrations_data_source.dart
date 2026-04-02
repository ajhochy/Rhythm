import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../models/gmail_signal.dart';
import '../models/integration_account.dart';
import '../models/planning_center_task_options.dart';
import '../models/planning_center_task_preferences.dart';

class IntegrationsDataSource {
  IntegrationsDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<IntegrationAccount>> fetchAccounts() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/integrations/accounts'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map(
            (item) => IntegrationAccount.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Uri googleBeginUri() => Uri.parse('$_baseUrl/auth/google/begin').replace(
        queryParameters: {
          if (AuthSessionStore.sessionToken != null)
            'sessionToken': AuthSessionStore.sessionToken!,
        },
      );

  Uri planningCenterBeginUri() =>
      Uri.parse('$_baseUrl/auth/planning-center/begin').replace(
        queryParameters: {
          if (AuthSessionStore.sessionToken != null)
            'sessionToken': AuthSessionStore.sessionToken!,
        },
      );

  Future<void> syncGoogleCalendar() async {
    final response = await http.post(
      Uri.parse('$_baseUrl/integrations/google-calendar/sync'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
  }

  Future<List<GmailSignal>> fetchGmailSignals() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/integrations/gmail/signals'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => GmailSignal.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> syncGmail() async {
    final response = await http.post(
      Uri.parse('$_baseUrl/integrations/gmail/sync'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
  }

  Future<void> syncPlanningCenter() async {
    final response = await http.post(
      Uri.parse('$_baseUrl/integrations/planning-center/sync'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
  }

  Future<PlanningCenterTaskPreferences>
      fetchPlanningCenterTaskPreferences() async {
    final response = await http.get(
      Uri.parse(
        '$_baseUrl/integrations/planning-center/task-preferences',
      ),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    return PlanningCenterTaskPreferences.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<PlanningCenterTaskOptions> fetchPlanningCenterTaskOptions() async {
    final response = await http.get(
      Uri.parse(
        '$_baseUrl/integrations/planning-center/task-options',
      ),
      headers: AuthSessionStore.headers(),
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
        '$_baseUrl/integrations/planning-center/task-preferences',
      ),
      headers: AuthSessionStore.headers(json: true),
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
