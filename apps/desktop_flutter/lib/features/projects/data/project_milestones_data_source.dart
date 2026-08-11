import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/project_instance.dart';

class ProjectMilestonesDataSource {
  ProjectMilestonesDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<ProjectMilestone> create(
    String instanceId, {
    required String title,
    String? dueDate,
    String? color,
    int? sortOrder,
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/project-instances/$instanceId/milestones'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'title': title,
        if (dueDate != null) 'dueDate': dueDate,
        if (color != null) 'color': color,
        if (sortOrder != null) 'sortOrder': sortOrder,
      }),
    );
    assertOk(response);
    return ProjectMilestone.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String instanceId, String milestoneId) async {
    final response = await http.delete(
      Uri.parse(
        '$_baseUrl/project-instances/$instanceId/milestones/$milestoneId',
      ),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<void> assignStep(String stepId, String? milestoneId) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/project-instances/steps/$stepId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'milestoneId': milestoneId}),
    );
    assertOk(response);
  }
}
