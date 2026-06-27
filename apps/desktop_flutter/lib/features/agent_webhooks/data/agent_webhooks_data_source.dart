import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_webhook_endpoint.dart';

class AgentWebhooksDataSource {
  AgentWebhooksDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentWebhookEndpoint>> list() async {
    final response = await http.get(Uri.parse('$_baseUrl/agent-webhooks'));
    assertOk(response);
    final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map(
          (e) => AgentWebhookEndpoint.fromJson(e as Map<String, dynamic>),
        )
        .toList();
  }

  Future<AgentWebhookEndpoint> create(Map<String, dynamic> input) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-webhooks'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(input),
    );
    assertOk(response);
    return AgentWebhookEndpoint.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/agent-webhooks/$id'),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }
}
