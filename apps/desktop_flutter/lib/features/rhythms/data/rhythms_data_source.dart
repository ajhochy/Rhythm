import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_user.dart';
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../../../features/tasks/models/recurring_task_rule.dart';

class RhythmsDataSource {
  RhythmsDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<RecurringTaskRule>> fetchAll() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/recurring-rules'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => RecurringTaskRule.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<AuthUser>> fetchUsers() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/users'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AuthUser.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<RecurringTaskRule> create({
    required String title,
    required String frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    bool? sequential,
    List<RecurringTaskRuleStep>? steps,
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/recurring-rules'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'title': title,
        'frequency': frequency,
        if (dayOfWeek != null) 'dayOfWeek': dayOfWeek,
        if (dayOfMonth != null) 'dayOfMonth': dayOfMonth,
        if (month != null) 'month': month,
        if (sequential != null) 'sequential': sequential,
        if (steps != null) 'steps': steps.map((step) => step.toJson()).toList(),
      }),
    );
    assertOk(response);
    return RecurringTaskRule.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<RecurringTaskRule> update(
    String id, {
    String? title,
    String? frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
    bool? enabled,
    bool? sequential,
    List<RecurringTaskRuleStep>? steps,
  }) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/recurring-rules/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (title != null) 'title': title,
        if (frequency != null) 'frequency': frequency,
        if (dayOfWeek != null) 'dayOfWeek': dayOfWeek,
        if (dayOfMonth != null) 'dayOfMonth': dayOfMonth,
        if (month != null) 'month': month,
        if (enabled != null) 'enabled': enabled,
        if (sequential != null) 'sequential': sequential,
        if (steps != null) 'steps': steps.map((step) => step.toJson()).toList(),
      }),
    );
    assertOk(response);
    return RecurringTaskRule.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/recurring-rules/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<void> addCollaborator(String ruleId, int userId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/recurring-rules/$ruleId/collaborators'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'userId': userId}),
    );
    assertOk(response);
  }

  Future<void> removeCollaborator(String ruleId, int userId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/recurring-rules/$ruleId/collaborators/$userId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
