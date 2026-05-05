import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/task.dart';

class TasksDataSource {
  TasksDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<Task>> fetchAll() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((j) => Task.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<Task> updateStatus(String id, String status) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/tasks/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'status': status}),
    );
    assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }
}
