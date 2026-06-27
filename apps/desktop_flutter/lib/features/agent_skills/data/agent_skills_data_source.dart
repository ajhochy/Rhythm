import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_skill.dart';
import '../models/agent_skill_version.dart';

/// HTTP access to the local agent server's `/agent-skills` CRUD routes.
///
/// Targets [AppConstants.agentLocalBaseUrl] (`:4001`) — NOT the configurable
/// production server URL. Agent traffic is always local (see CLAUDE.md
/// "Dual-Endpoint Architecture").
class AgentSkillsDataSource {
  AgentSkillsDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentSkill>> getSkills() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-skills'),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentSkill.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AgentSkill> updateSkill(String id, {required String status}) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-skills/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'status': status}),
    );
    assertOk(response);
    return AgentSkill.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> deleteSkill(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/agent-skills/$id'),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  /// P5-3: version history for a skill, newest version first.
  Future<List<AgentSkillVersion>> getVersions(String id) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-skills/$id/versions'),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentSkillVersion.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  /// P5-3: restore [versionNo] as the new current version. Returns the
  /// restored (live) skill.
  Future<AgentSkill> rollback(String id, int versionNo) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-skills/$id/rollback'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'versionNo': versionNo}),
    );
    assertOk(response);
    return AgentSkill.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
