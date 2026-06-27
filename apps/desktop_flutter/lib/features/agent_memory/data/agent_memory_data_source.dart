import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_memory_entry.dart';

class AgentMemoryDataSource {
  AgentMemoryDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentMemoryEntry>> list() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-memory'),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentMemoryEntry.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<AgentMemoryEntry>> search(String q) async {
    final uri = Uri.parse('$_baseUrl/agent-memory/search').replace(
      queryParameters: {'q': q},
    );
    final response = await http.get(uri);
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentMemoryEntry.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AgentMemoryEntry> create(Map<String, dynamic> input) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-memory'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(input),
    );
    assertOk(response);
    return AgentMemoryEntry.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<void> delete(String id) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/agent-memory/$id'),
    );
    if (response.statusCode != 204) {
      assertOk(response);
    }
  }
}
