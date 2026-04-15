import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/task_collaborator.dart';

class CollaboratorsDataSource {
  CollaboratorsDataSource({String? baseUrl})
    : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<TaskCollaborator>> fetchForTask(String taskId) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/tasks/$taskId/collaborators'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => TaskCollaborator.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> addToTask(String taskId, int userId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks/$taskId/collaborators'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'userId': userId}),
    );
    assertOk(response);
  }

  Future<void> removeFromTask(String taskId, int userId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/tasks/$taskId/collaborators/$userId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<List<TaskCollaborator>> fetchForProject(
    String projectInstanceId,
  ) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/project-instances/$projectInstanceId/collaborators'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => TaskCollaborator.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> addToProject(String projectInstanceId, int userId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/project-instances/$projectInstanceId/collaborators'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'userId': userId}),
    );
    assertOk(response);
  }

  Future<void> removeFromProject(String projectInstanceId, int userId) async {
    final response = await http.delete(
      Uri.parse(
        '$_baseUrl/project-instances/$projectInstanceId/collaborators/$userId',
      ),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
