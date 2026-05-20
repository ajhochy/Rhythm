import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_project.dart';
import '../models/project_branches.dart';

/// HTTP client for the embedded api_server's /projects endpoints.
///
/// Targets `AppConstants.agentLocalBaseUrl` (localhost:4001), never the
/// user-configured production server. Projects are local-only data tied
/// to the embedded api_server's SQLite store.
class AgentProjectsRemoteDataSource {
  AgentProjectsRemoteDataSource({http.Client? client})
      : _client = client ?? http.Client(),
        _baseUrl = AppConstants.agentLocalBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  Future<List<AgentProject>> list({bool includeArchived = false}) async {
    final uri = Uri.parse('$_baseUrl/projects').replace(
      queryParameters: includeArchived ? {'includeArchived': 'true'} : null,
    );
    final response = await _client.get(uri);
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentProject.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AgentProject> create({
    required String name,
    required String cwd,
    String? icon,
  }) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/projects'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({
        'name': name,
        'cwd': cwd,
        if (icon != null) 'icon': icon,
      }),
    );
    assertOk(response);
    return AgentProject.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AgentProject> update(
    String id, {
    String? name,
    String? cwd,
    String? icon,
    DateTime? archivedAt,
    bool clearArchivedAt = false,
  }) async {
    final payload = <String, dynamic>{};
    if (name != null) payload['name'] = name;
    if (cwd != null) payload['cwd'] = cwd;
    if (icon != null) payload['icon'] = icon;
    if (clearArchivedAt) {
      payload['archivedAt'] = null;
    } else if (archivedAt != null) {
      payload['archivedAt'] = archivedAt.toUtc().toIso8601String();
    }
    final response = await _client.patch(
      Uri.parse('$_baseUrl/projects/$id'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );
    assertOk(response);
    return AgentProject.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response = await _client.delete(Uri.parse('$_baseUrl/projects/$id'));
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  Future<AgentProject> refreshVcs(String id) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/projects/$id/refresh-vcs'),
    );
    assertOk(response);
    return AgentProject.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<ProjectBranches> listBranches(String id) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl/projects/$id/branches'),
    );
    assertOk(response);
    return ProjectBranches.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Checkout [branch] in the project's working tree.
  ///
  /// Returns the updated [AgentProject] on success.
  /// Throws an [AppError] (409) carrying the git stderr on conflict/failure.
  Future<AgentProject> checkout(
    String id, {
    required String branch,
    String stash = 'none',
    bool createBranch = false,
  }) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl/projects/$id/checkout'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({
        'branch': branch,
        'stash': stash,
        'createBranch': createBranch,
      }),
    );
    assertOk(response);
    return AgentProject.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
