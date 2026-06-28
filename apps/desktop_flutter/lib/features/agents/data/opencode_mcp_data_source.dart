import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

/// Read-only data source for the engine's live MCP server list, against the
/// LOCAL agent server, used by the Agent Profile MCP picker.
///
/// Always targets [AppConstants.agentLocalBaseUrl] (`http://localhost:4001`) —
/// NEVER the production server URL from ServerConfigService (see the
/// dual-endpoint architecture in CLAUDE.md). This is intentionally a thin
/// name-only reader: MCP server *management* lives in Settings, not here.
/// Mirrors [OpencodeSkillsDataSource].
class OpencodeMcpDataSource {
  OpencodeMcpDataSource({http.Client? client})
      : _baseUrl = AppConstants.agentLocalBaseUrl,
        _client = client ?? http.Client();

  final String _baseUrl;

  // Injectable so the list→picker flow can be exercised in widget tests.
  final http.Client _client;

  /// Lists the engine's live MCP server names from `GET /opencode/mcp`.
  ///
  /// Returns an empty list on any error so the picker shows an empty
  /// "no servers" state rather than crashing or falling back to a stale
  /// hardcoded list.
  Future<List<String>> listNames() async {
    try {
      final response = await _client.get(Uri.parse('$_baseUrl/opencode/mcp'));
      if (response.statusCode != 200) return [];
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map((e) => (e as Map<String, dynamic>)['name'] as String?)
          .whereType<String>()
          .toList();
    } catch (_) {
      return [];
    }
  }
}
