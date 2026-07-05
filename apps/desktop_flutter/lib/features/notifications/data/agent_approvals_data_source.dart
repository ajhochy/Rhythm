import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../models/agent_approval.dart';

/// #895 — talks to the LOCAL agent server (:4001), same as every other
/// agent-execution-state endpoint (never serverConfigService.url).
abstract class AgentApprovalsDataSource {
  factory AgentApprovalsDataSource({String? baseUrl}) =
      _AgentApprovalsDataSourceImpl;

  Future<List<AgentApproval>> listPending();
  Future<void> decide(String id, {required bool approve});
}

class _AgentApprovalsDataSourceImpl implements AgentApprovalsDataSource {
  _AgentApprovalsDataSourceImpl({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  @override
  Future<List<AgentApproval>> listPending() async {
    final response =
        await http.get(Uri.parse('$_baseUrl/agent-approvals?status=pending'));
    if (response.statusCode != 200) {
      throw Exception('Failed to load agent approvals: ${response.statusCode}');
    }
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((e) => AgentApproval.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<void> decide(String id, {required bool approve}) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-approvals/$id'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'status': approve ? 'approved' : 'rejected'}),
    );
    if (response.statusCode != 200) {
      throw Exception(
          'Failed to decide agent approval: ${response.statusCode}');
    }
  }
}
