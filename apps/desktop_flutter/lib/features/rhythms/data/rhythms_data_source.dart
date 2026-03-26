import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../../../features/tasks/models/recurring_task_rule.dart';

class RhythmsDataSource {
  final _base = Uri.parse('${AppConstants.apiBaseUrl}/recurring-rules');

  Future<List<RecurringTaskRule>> fetchAll() async {
    final response = await http.get(_base);
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((j) => RecurringTaskRule.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<RecurringTaskRule> create({
    required String title,
    required String frequency,
    int? dayOfWeek,
    int? dayOfMonth,
    int? month,
  }) async {
    final response = await http.post(
      _base,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'title': title,
        'frequency': frequency,
        if (dayOfWeek != null) 'dayOfWeek': dayOfWeek,
        if (dayOfMonth != null) 'dayOfMonth': dayOfMonth,
        if (month != null) 'month': month,
      }),
    );
    _assertOk(response);
    return RecurringTaskRule.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> delete(String id) async {
    final response = await http.delete(Uri.parse('${AppConstants.apiBaseUrl}/recurring-rules/$id'));
    _assertOk(response);
  }

  void _assertOk(http.Response response) {
    if (response.statusCode >= 400) {
      final body = jsonDecode(response.body) as Map<String, dynamic>?;
      final message = (body?['error'] as Map<String, dynamic>?)?['message'] as String? ?? 'Request failed';
      throw AppError(message);
    }
  }
}
