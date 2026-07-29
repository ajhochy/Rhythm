import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

class OpencodeMcpCapability {
  const OpencodeMcpCapability({
    required this.name,
    this.tools = const [],
    this.status,
  });

  final String name;
  final List<String> tools;
  final String? status;

  factory OpencodeMcpCapability.fromJson(Map<String, dynamic> json) {
    return OpencodeMcpCapability(
      name: json['name'] as String? ?? '',
      tools: (json['tools'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
      status: json['status'] as String?,
    );
  }
}

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
    return (await listCapabilities()).map((entry) => entry.name).toList();
  }

  Future<List<OpencodeMcpCapability>> listCapabilities() async {
    try {
      final response = await _client.get(Uri.parse('$_baseUrl/opencode/mcp'));
      if (response.statusCode != 200) return [];
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map((e) => OpencodeMcpCapability.fromJson(
                e as Map<String, dynamic>,
              ))
          .where((entry) => entry.name.isNotEmpty)
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// #922 — names of MCP servers the live engine currently reports as
  /// `needs_auth` (expired/missing OAuth — e.g. canva, notion). Used by the
  /// Agent Profile sheet to flag a profile as degraded when one of its
  /// allowed servers is unauthenticated, so a scheduled run doesn't silently
  /// depend on a dead server. Returns an empty set on any error (fail-open —
  /// this is a visibility hint, never something that blocks the picker).
  Future<Set<String>> listNeedsAuthNames() async {
    try {
      final response = await _client.get(Uri.parse('$_baseUrl/opencode/mcp'));
      if (response.statusCode != 200) return {};
      final list = jsonDecode(response.body) as List<dynamic>;
      return list
          .map((e) => e as Map<String, dynamic>)
          .where((e) => e['status'] == 'needs_auth')
          .map((e) => e['name'] as String?)
          .whereType<String>()
          .toSet();
    } catch (_) {
      return {};
    }
  }
}
