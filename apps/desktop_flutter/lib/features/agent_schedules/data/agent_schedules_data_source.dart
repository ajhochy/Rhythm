import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_scheduled_task.dart';

class AgentSchedulesDataSource {
  AgentSchedulesDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentScheduledTask>> list() async {
    final response = await http.get(Uri.parse('$_baseUrl/agent-schedules'));
    assertOk(response);
    final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map((e) => AgentScheduledTask.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<AgentScheduledTask> create(Map<String, dynamic> input) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-schedules'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(input),
    );
    assertOk(response);
    return AgentScheduledTask.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<AgentScheduledTask> update(
    String id,
    Map<String, dynamic> patch,
  ) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-schedules/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(patch),
    );
    assertOk(response);
    return AgentScheduledTask.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response =
        await http.delete(Uri.parse('$_baseUrl/agent-schedules/$id'));
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }

  Future<AgentScheduledTask> triggerNow(String id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-schedules/$id/trigger-now'),
      headers: {'Content-Type': 'application/json'},
    );
    assertOk(response);
    return AgentScheduledTask.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
