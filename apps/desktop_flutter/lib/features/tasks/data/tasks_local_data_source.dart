import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/task.dart';

class TasksLocalDataSource {
  TasksLocalDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<Task>> fetchAll() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    final tasks =
        list.map((j) => Task.fromJson(j as Map<String, dynamic>)).toList();
    return tasks;
  }

  Future<Task> create(
    String title, {
    String? notes,
    String? dueDate,
    int? ownerId,
    String? preferredAgent,
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'title': title,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        if (dueDate != null) 'dueDate': dueDate,
        if (ownerId != null) 'ownerId': ownerId,
        'preferredAgent': preferredAgent,
      }),
    );
    assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<Task> update(
    String id, {
    String? title,
    String? notes,
    String? dueDate,
    String? scheduledDate,
    String? status,
    int? ownerId,
    bool includeNotes = false,
    bool includeDueDate = false,
    bool includeScheduledDate = false,
    bool includeOwnerId = false,
    bool includePreferredAgent = false,
    String? preferredAgent,
  }) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/tasks/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (title != null) 'title': title,
        if (includeNotes || notes != null) 'notes': notes,
        if (includeDueDate || dueDate != null) 'dueDate': dueDate,
        if (includeScheduledDate || scheduledDate != null)
          'scheduledDate': scheduledDate,
        if (status != null) 'status': status,
        if (includeOwnerId) 'ownerId': ownerId,
        if (includePreferredAgent) 'preferredAgent': preferredAgent,
      }),
    );
    assertOk(response);
    return Task.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> addCollaborator(String taskId, int userId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks/$taskId/collaborators'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'userId': userId}),
    );
    assertOk(response);
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/tasks/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
