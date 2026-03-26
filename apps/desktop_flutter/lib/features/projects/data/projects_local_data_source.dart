import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/errors/app_error.dart';
import '../models/project_template.dart';
import '../models/project_template_step.dart';

class ProjectsLocalDataSource {
  final _base = Uri.parse('${AppConstants.apiBaseUrl}/project-templates');

  Future<List<ProjectTemplate>> fetchAll() async {
    final response = await http.get(_base);
    _assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => ProjectTemplate.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<ProjectTemplate> create(String name,
      {String? description, String? anchorType}) async {
    final response = await http.post(
      _base,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'name': name,
        if (description != null) 'description': description,
        if (anchorType != null) 'anchorType': anchorType,
      }),
    );
    _assertOk(response);
    return ProjectTemplate.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProjectTemplateStep> addStep(
    String templateId, {
    required String title,
    required int offsetDays,
    String? offsetDescription,
    int? sortOrder,
  }) async {
    final response = await http.post(
      Uri.parse(
          '${AppConstants.apiBaseUrl}/project-templates/$templateId/steps'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'title': title,
        'offsetDays': offsetDays,
        if (offsetDescription != null) 'offsetDescription': offsetDescription,
        if (sortOrder != null) 'sortOrder': sortOrder,
      }),
    );
    _assertOk(response);
    return ProjectTemplateStep.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProjectTemplate> update(String id,
      {String? name, String? description}) async {
    final response = await http.patch(
      Uri.parse('${AppConstants.apiBaseUrl}/project-templates/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (name != null) 'name': name,
        if (description != null) 'description': description,
      }),
    );
    _assertOk(response);
    return ProjectTemplate.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ProjectTemplateStep> updateStep(
    String templateId,
    String stepId, {
    String? title,
    int? offsetDays,
    String? offsetDescription,
  }) async {
    final response = await http.patch(
      Uri.parse(
          '${AppConstants.apiBaseUrl}/project-templates/$templateId/steps/$stepId'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (title != null) 'title': title,
        if (offsetDays != null) 'offsetDays': offsetDays,
        if (offsetDescription != null) 'offsetDescription': offsetDescription,
      }),
    );
    _assertOk(response);
    return ProjectTemplateStep.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> deleteStep(String templateId, String stepId) async {
    final response = await http.delete(
      Uri.parse(
          '${AppConstants.apiBaseUrl}/project-templates/$templateId/steps/$stepId'),
    );
    _assertOk(response);
  }

  Future<void> delete(String id) async {
    final response = await http
        .delete(Uri.parse('${AppConstants.apiBaseUrl}/project-templates/$id'));
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
