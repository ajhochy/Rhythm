import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_config.dart';

class AgentConfigsDataSource {
  AgentConfigsDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentConfig>> list() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-configs'),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentConfig.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AgentConfig> create(Map<String, dynamic> input) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-configs'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(input),
    );
    assertOk(response);
    return AgentConfig.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AgentConfig> update(String id, Map<String, dynamic> patch) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-configs/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(patch),
    );
    assertOk(response);
    return AgentConfig.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/agent-configs/$id'),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }
}
