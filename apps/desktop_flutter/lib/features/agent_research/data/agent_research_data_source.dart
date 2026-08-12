import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_research_job.dart';
import '../models/research_project.dart';

class AgentResearchDataSource {
  AgentResearchDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentResearchJob>> list() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-research'),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentResearchJob.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AgentResearchJob> get(String id) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-research/$id'),
    );
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

  Future<List<ResearchProject>> listProjects() async {
    final response =
        await http.get(Uri.parse('$_baseUrl/agent-research/projects'));
    assertOk(response);
    return (jsonDecode(response.body) as List)
        .whereType<Map>()
        .map((value) =>
            ResearchProject.fromJson(Map<String, dynamic>.from(value)))
        .toList();
  }

  Future<ResearchProject> createProject(Map<String, dynamic> input) async {
    final response = await http.post(
        Uri.parse('$_baseUrl/agent-research/projects'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(input));
    assertOk(response);
    return ResearchProject.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ResearchProject> updateProject(
      String id, Map<String, dynamic> input) async {
    final response = await http.patch(
        Uri.parse('$_baseUrl/agent-research/projects/$id'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(input));
    assertOk(response);
    return ResearchProject.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ResearchProject> archiveProject(String id) async {
    final response = await http
        .post(Uri.parse('$_baseUrl/agent-research/projects/$id/archive'));
    assertOk(response);
    return ResearchProject.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<List<ResearchProjectRun>> listProjectRuns(String projectId) async {
    final response = await http
        .get(Uri.parse('$_baseUrl/agent-research/projects/$projectId/runs'));
    assertOk(response);
    return (jsonDecode(response.body) as List)
        .whereType<Map>()
        .map((value) =>
            ResearchProjectRun.fromJson(Map<String, dynamic>.from(value)))
        .toList();
  }

  Future<ResearchProjectRun> getProjectRun(
      String projectId, String runId) async {
    final response = await http.get(
        Uri.parse('$_baseUrl/agent-research/projects/$projectId/runs/$runId'));
    assertOk(response);
    return ResearchProjectRun.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ResearchProjectRun> startProjectRun(String projectId) async {
    final response = await http.post(
        Uri.parse('$_baseUrl/agent-research/projects/$projectId/runs'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'triggerType': 'manual'}));
    assertOk(response);
    return ResearchProjectRun.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<ResearchProjectRun> runAction(
      String projectId, String runId, String action) async {
    final response = await http.post(Uri.parse(
        '$_baseUrl/agent-research/projects/$projectId/runs/$runId/$action'));
    assertOk(response);
    return ResearchProjectRun.fromJson(
        jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> passAction(
      String projectId, String runId, String passId, String action) async {
    final response = await http.post(Uri.parse(
        '$_baseUrl/agent-research/projects/$projectId/runs/$runId/passes/$passId/$action'));
    assertOk(response);
  }

  Uri magazineUri(String projectId, String runId) => Uri.parse(
      '$_baseUrl/agent-research/projects/${Uri.encodeComponent(projectId)}/runs/${Uri.encodeComponent(runId)}/magazine');

  Uri exportUri(String projectId, String runId, String format) => Uri.parse(
          '$_baseUrl/agent-research/projects/${Uri.encodeComponent(projectId)}/runs/${Uri.encodeComponent(runId)}/export')
      .replace(queryParameters: {'format': format});

  Future<String> startDiscussion(
      String projectId, String runId, List<String> artifactIds) async {
    final response = await http.post(
        Uri.parse(
            '$_baseUrl/agent-research/projects/${Uri.encodeComponent(projectId)}/runs/${Uri.encodeComponent(runId)}/discussions'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'selectedArtifactIds': artifactIds}));
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['sessionId'] as String;
  }

  Future<List<ResearchCapabilityWarning>> researchCapabilities() async {
    final response =
        await http.get(Uri.parse('$_baseUrl/agent-configs/skill-wiring'));
    assertOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return (body['capabilityDiagnostics'] as List? ?? const [])
        .whereType<Map>()
        .map((value) => ResearchCapabilityWarning.fromJson(
            Map<String, dynamic>.from(value)))
        .toList();
  }
}
