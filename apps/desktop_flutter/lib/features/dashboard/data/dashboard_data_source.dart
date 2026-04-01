import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../../tasks/models/task.dart';
import '../../tasks/models/recurring_task_rule.dart';

class DashboardDataSource {
  DashboardDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<Task>> fetchTasks() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((j) => Task.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<List<RecurringTaskRule>> fetchRecurringRules() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/recurring-rules'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => RecurringTaskRule.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<int> fetchProjectInstanceCount() async {
    final response = await http.get(Uri.parse('$_baseUrl/project-instances'));
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.length;
  }

  Future<int> fetchMessageThreadCount() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/message-threads'),
      headers: AuthSessionStore.headers(),
    );
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.length;
  }

  Future<Task> createTask(String title, {String? dueDate}) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'title': title,
        if (dueDate != null) 'dueDate': dueDate,
      }),
    );
    _assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> toggleTaskDone(String id, String currentStatus) async {
    final newStatus = currentStatus == 'done' ? 'open' : 'done';
    final response = await http.patch(
      Uri.parse('$_baseUrl/tasks/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'status': newStatus}),
    );
    _assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
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
