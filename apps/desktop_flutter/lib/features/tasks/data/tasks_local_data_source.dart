import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../models/task.dart';

class TasksLocalDataSource {
  final _base = Uri.parse('${AppConstants.apiBaseUrl}/tasks');

  Future<List<Task>> fetchAll() async {
    final response = await http.get(_base);
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((j) => Task.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<Task> create(String title, {String? dueDate}) async {
    final response = await http.post(
      _base,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'title': title, if (dueDate != null) 'dueDate': dueDate}),
    );
    _assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> update(String id, {String? title, String? dueDate, String? status}) async {
    final response = await http.patch(
      Uri.parse('${AppConstants.apiBaseUrl}/tasks/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (title != null) 'title': title,
        if (dueDate != null) 'dueDate': dueDate,
        if (status != null) 'status': status,
      }),
    );
    _assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> delete(String id) async {
    final response = await http.delete(Uri.parse('${AppConstants.apiBaseUrl}/tasks/$id'));
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
