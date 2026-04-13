import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../../../app/core/utils/json_parsing.dart';
import '../../tasks/models/task.dart';
import '../models/weekly_plan.dart';

class WeeklyPlanDataSource {
  WeeklyPlanDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<WeeklyPlan> fetchPlan(String weekLabel) async {
    final uri = Uri.parse('$_baseUrl/weekly-plan')
        .replace(queryParameters: {'week': weekLabel});
    final response = await http.get(uri, headers: AuthSessionStore.headers());
    assertOk(response);
    return WeeklyPlan.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> scheduleTask(String taskId, String date,
      {bool locked = false, int? scheduledOrder}) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/weekly-plan/tasks/$taskId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'scheduledDate': date,
        'locked': locked,
        if (scheduledOrder != null) 'scheduledOrder': scheduledOrder,
      }),
    );
    assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> updateTask(String taskId,
      {String? notes,
      String? status,
      String? dueDate,
      String? scheduledDate,
      int? scheduledOrder,
      String? sourceType}) async {
    final isProjectStep = sourceType == 'project_step';
    final response = await http.patch(
      Uri.parse(isProjectStep
          ? '$_baseUrl/project-instances/steps/$taskId'
          : '$_baseUrl/tasks/$taskId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (notes != null) 'notes': notes,
        if (status != null) 'status': status,
        if (dueDate != null) 'dueDate': dueDate,
        if (!isProjectStep && scheduledDate != null)
          'scheduledDate': scheduledDate,
        if (!isProjectStep && scheduledOrder != null)
          'scheduledOrder': scheduledOrder,
      }),
    );
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return isProjectStep
        ? Task(
            id: asString(body['id']) ?? '',
            title: asString(body['title']) ?? '',
            status: asString(body['status']) ?? 'open',
            createdAt: '',
            updatedAt: '',
            notes: asString(body['notes']),
            dueDate: asString(body['dueDate']),
            scheduledOrder: asInt(body['scheduledOrder']),
            sourceType: 'project_step',
            sourceName: asString(body['sourceName']),
          )
        : Task.fromJson(body);
  }

  Future<void> createTask(String title, {String? dueDate}) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'title': title,
        if (dueDate != null) 'dueDate': dueDate,
      }),
    );
    assertOk(response);
  }
}
