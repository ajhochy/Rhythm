import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../../tasks/models/task.dart';
import '../models/weekly_plan.dart';

class WeeklyPlanDataSource {
  final _base = Uri.parse('${AppConstants.apiBaseUrl}/weekly-plan');

  Future<WeeklyPlan> fetchPlan(String weekLabel) async {
    final uri = _base.replace(queryParameters: {'week': weekLabel});
    final response = await http.get(uri);
    _assertOk(response);
    return WeeklyPlan.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> scheduleTask(String taskId, String date,
      {bool locked = false}) async {
    final response = await http.patch(
      Uri.parse('${AppConstants.apiBaseUrl}/weekly-plan/tasks/$taskId'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'scheduledDate': date, 'locked': locked}),
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
