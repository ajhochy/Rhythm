import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../../tasks/models/task.dart';
import '../models/weekly_plan.dart';

class WeeklyPlanDataSource {
  WeeklyPlanDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<WeeklyPlan> fetchPlan(String weekLabel) async {
    final uri = Uri.parse('$_baseUrl/weekly-plan')
        .replace(queryParameters: {'week': weekLabel});
    final response = await http.get(uri);
    _assertOk(response);
    return WeeklyPlan.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> scheduleTask(String taskId, String date,
      {bool locked = false}) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/weekly-plan/tasks/$taskId'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'scheduledDate': date, 'locked': locked}),
    );
    _assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> updateTask(String taskId,
      {String? notes,
      String? status,
      String? dueDate,
      String? scheduledDate,
      String? sourceType}) async {
    final isProjectStep = sourceType == 'project_step';
    final response = await http.patch(
      Uri.parse(isProjectStep
          ? '$_baseUrl/project-instances/steps/$taskId'
          : '$_baseUrl/tasks/$taskId'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (notes != null) 'notes': notes,
        if (status != null) 'status': status,
        if (dueDate != null) 'dueDate': dueDate,
        if (!isProjectStep && scheduledDate != null)
          'scheduledDate': scheduledDate,
      }),
    );
    _assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return isProjectStep
        ? Task(
            id: body['id'] as String,
            title: body['title'] as String,
            status: body['status'] as String? ?? 'open',
            createdAt: '',
            updatedAt: '',
            notes: body['notes'] as String?,
            dueDate: body['dueDate'] as String?,
            sourceType: 'project_step',
            sourceName: body['sourceName'] as String?,
          )
        : Task.fromJson(body);
  }

  Future<void> createTask(String title, {String? dueDate}) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'title': title,
        if (dueDate != null) 'dueDate': dueDate,
      }),
    );
    _assertOk(response);
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
