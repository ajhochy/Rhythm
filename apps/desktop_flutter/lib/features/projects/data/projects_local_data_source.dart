import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/project_template.dart';
import '../models/project_template_step.dart';

class ProjectsLocalDataSource {
  ProjectsLocalDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<ProjectTemplate>> fetchAll() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/project-templates'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => ProjectTemplate.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<ProjectTemplate> create(String name,
      {String? description, String? anchorType}) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/project-templates'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'name': name,
        if (description != null) 'description': description,
        if (anchorType != null) 'anchorType': anchorType,
      }),
    );
    assertOk(response);
    return ProjectTemplate.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProjectTemplateStep> addStep(
    String templateId, {
    required String title,
    required int offsetDays,
    String? offsetDescription,
    int? sortOrder,
    int? assigneeId,
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/project-templates/$templateId/steps'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        'title': title,
        'offsetDays': offsetDays,
        if (offsetDescription != null) 'offsetDescription': offsetDescription,
        if (sortOrder != null) 'sortOrder': sortOrder,
        'assigneeId': assigneeId,
      }),
    );
    assertOk(response);
    return ProjectTemplateStep.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProjectTemplate> update(String id,
      {String? name, String? description}) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/project-templates/$id'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (name != null) 'name': name,
        if (description != null) 'description': description,
      }),
    );
    assertOk(response);
    return ProjectTemplate.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProjectTemplateStep> updateStep(
    String templateId,
    String stepId, {
    String? title,
    int? offsetDays,
    String? offsetDescription,
    int? assigneeId,
  }) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/project-templates/$templateId/steps/$stepId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (title != null) 'title': title,
        if (offsetDays != null) 'offsetDays': offsetDays,
        if (offsetDescription != null) 'offsetDescription': offsetDescription,
        'assigneeId': assigneeId,
      }),
    );
    assertOk(response);
    return ProjectTemplateStep.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> deleteStep(String templateId, String stepId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/project-templates/$templateId/steps/$stepId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/project-templates/$id'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
