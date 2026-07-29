import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_research_job.dart';

class AgentResearchDataSource {
  AgentResearchDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentResearchJob>> list() async {
    final response = await http.get(Uri.parse('$_baseUrl/agent-research'));
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentResearchJob.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AgentResearchJob> get(String id) async {
    final response = await http.get(Uri.parse('$_baseUrl/agent-research/$id'));
    assertOk(response);
    return AgentResearchJob.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AgentResearchJob> create(Map<String, dynamic> input) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-research'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(input),
    );
    assertOk(response);
    return AgentResearchJob.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AgentResearchJob> retry(String id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-research/$id/retry'),
    );
    assertOk(response);
    return AgentResearchJob.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
